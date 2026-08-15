import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { isThumbSize } from '@lukarn/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import {
  StorageNotConfiguredError,
  StorageNotConnectedError,
  StorageRevokedError,
  StorageUnavailableError,
} from '../storage/provider.js';
import { formatRange, parseRange, type ByteRange } from '../media/range.js';
import type { Variant } from '../media/renderer.js';
import { playableKey } from '../media/transcode.js';
import { requireAuth } from '../plugins/auth.js';

/**
 * Derivatives behave as immutable: the ETag includes the content fingerprint, so a
 * new file version produces a new ETag and forces a reload even at the same URL.
 */
const IMMUTABLE = 'private, max-age=31536000, immutable';

/**
 * The browser's private cache is keyed by cookie value and therefore by session.
 * Without this, two accounts used successively in the same profile — the living-room
 * computer — share entries: the second reopens from history a photo in an album they
 * were never allowed to view, without any request reaching `authorize()`.
 *
 * What this header does not solve, and no other could: someone whose album access is
 * revoked retains photos already loaded in their cache. They had those photos — data
 * already on their disk cannot be erased (D43).
 */
const VARY_COOKIE = 'Cookie';

const thumbQuery = z.object({ s: z.coerce.number().int().default(320) });

/**
 * Clamps a requested range to the file's actual bounds.
 *
 * `null` when it does not intersect the file: this becomes the 416 commonly caused
 * when the player changes videos while a request is in flight.
 */
function resolveRange(range: ByteRange, size: number): { start: number; end: number } | null {
  // Suffix range (`bytes=-500`): the final bytes, never more than the whole file.
  if (range.start === null) {
    const length = Math.min(range.end ?? 0, size);
    return length > 0 ? { start: size - length, end: size - 1 } : null;
  }
  if (range.start >= size) return null;
  return { start: range.start, end: Math.min(range.end ?? size - 1, size - 1) };
}

export function createMediaRoutes(context: AppContext): FastifyPluginAsync {
  /**
   * Access control for the entire media pipeline. The same file may be indexed in
   * several albums (nested folders): access is granted as soon as one of those albums
   * is visible to the user.
   *
   * A refusal returns 404 rather than 403 — the existence of media in an unauthorised
   * album must not be observable.
   */
  async function authorize(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const { mediaId } = request.params as { mediaId: string };
    const username = request.user!.username;

    const albums = context.media.albumsContaining(mediaId);
    const allowed = albums.some((albumId) => context.canSee(username, albumId));

    if (!allowed) {
      await reply.code(404).send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      return false;
    }
    return true;
  }

  async function serveRendered(
    request: FastifyRequest,
    reply: FastifyReply,
    variant: Variant,
  ): Promise<FastifyReply | undefined> {
    const { mediaId } = request.params as { mediaId: string };

    const meta = context.media.getFileMeta(mediaId);
    if (!meta) {
      return reply
        .code(404)
        .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
    }
    /**
     * A video has a thumbnail — the preview Drive produces from its first second
     * (D92) — but nothing larger: `full` and `hd` would enlarge an image only a few
     * hundred pixels wide, and files Drive could not read or has not yet processed
     * have no preview.
     */
    if (meta.kind === 'video') {
      if (variant.kind !== 'thumb') {
        return reply
          .code(415)
          .send({ error: 'unsupported', message: request.t('error.noFullscreenForVideo') });
      }
      if (!meta.hasThumbnail) {
        return reply
          .code(415)
          .send({ error: 'unsupported', message: request.t('error.noVideoPreview') });
      }
    }

    /**
     * The ETag distinguishes variants — otherwise `full` and `hd` would share the
     * same browser-cache entry and zoom would serve the low-resolution image again —
     * and content versions, because Drive keeps the same identifier when a file is
     * replaced by a new version.
     */
    const version = meta.md5 ?? 'v0';
    const etag = `"${mediaId}-${version}-${variant.kind === 'thumb' ? variant.size : variant.kind}"`;
    if (request.headers['if-none-match'] === etag) {
      return reply
        .code(304)
        .header('Cache-Control', IMMUTABLE)
        .header('Vary', VARY_COOKIE)
        .header('ETag', etag)
        .send();
    }

    const rendered = await context.renderer.render(
      context.storage.get(meta.connectionId),
      mediaId,
      variant,
      meta.md5,
      meta.kind === 'video' ? 'poster' : 'original',
    );
    return reply
      .header('Content-Type', rendered.contentType)
      .header('Cache-Control', IMMUTABLE)
      .header('Vary', VARY_COOKIE)
      .header('ETag', etag)
      .send(createReadStream(rendered.path));
  }

  return async (app) => {
    app.addHook('preHandler', requireAuth);
    app.addHook('preHandler', async (request, reply) => {
      await authorize(request, reply);
    });

    // Storage unavailable: an explicit message rather than an opaque 500 repeated for
    // every grid thumbnail. The two cases are distinguished so the administrator
    // knows whether to connect or reconnect.
    app.setErrorHandler(async (error, _request, reply) => {
      if (error instanceof StorageRevokedError) {
        return reply.code(503).send({ error: 'storage_revoked', message: error.message });
      }
      // Not connected and not configured land on the same code deliberately: from a
      // grid, both mean "this storage cannot serve anything, and /admin is where it is
      // fixed". The message says which of the two it is.
      if (error instanceof StorageNotConnectedError || error instanceof StorageNotConfiguredError) {
        return reply.code(503).send({ error: 'storage_disconnected', message: error.message });
      }
      // Timeout or rate limit: **transient**. The 503 and `Retry-After` tell the client
      // to return, whereas a default 500 would make it abandon the thumbnail until
      // the next page reload. No cache header is set because a failure must never be
      // retained.
      if (error instanceof StorageUnavailableError) {
        return reply
          .code(503)
          .header('Retry-After', String(error.retryAfterSeconds))
          .send({ error: 'storage_unavailable', message: error.message });
      }
      throw error;
    });

    app.get('/:mediaId/thumb', async (request, reply) => {
      const query = thumbQuery.safeParse(request.query);
      const size = query.success ? query.data.s : 320;
      if (!isThumbSize(size)) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.unsupportedThumbSize') });
      }
      return serveRendered(request, reply, { kind: 'thumb', size });
    });

    app.get('/:mediaId/full', async (request, reply) =>
      serveRendered(request, reply, { kind: 'full' }),
    );

    /**
     * High-resolution render requested only on first zoom. Capped at 4096 px, it
     * weighs a fraction of the original — a few hundred KB where a camera JPEG often
     * exceeds 9 MB — while showing the same on-screen detail.
     */
    app.get('/:mediaId/hd', async (request, reply) =>
      serveRendered(request, reply, { kind: 'hd' }),
    );

    /**
     * Transcoded version served from the disk store (D260809b).
     *
     * **404 when it is absent**, as agreed with the front end: preparation is
     * anticipatory and slow, so a video added ten minutes ago may not have one yet.
     * The front end presents this as "being prepared", with the Download button from
     * D79 — not an error.
     *
     * Unlike `/original`, the file is local, so ranges are resolved here rather than
     * relayed to Drive.
     */
    app.get('/:mediaId/playable', async (request, reply) => {
      const { mediaId } = request.params as { mediaId: string };
      const meta = context.media.getFileMeta(mediaId);
      if (!meta) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }

      const path = context.videoStore.hit(playableKey(mediaId, meta.md5));
      // The inventory may reference a file that is no longer present — concurrent
      // eviction or manual volume cleanup. `stat` settles this before headers are set,
      // whereas `createReadStream` would fail afterwards.
      const size = path
        ? await stat(path).then(
            (info) => info.size,
            () => null,
          )
        : null;
      if (path === null || size === null) {
        return reply
          .code(404)
          .send({ error: 'not_ready', message: request.t('error.videoNotReady') });
      }

      const etag = `"${mediaId}-${meta.md5 ?? 'v0'}-playable"`;
      if (request.headers['if-none-match'] === etag) {
        return reply
          .code(304)
          .header('Cache-Control', IMMUTABLE)
          .header('Vary', VARY_COOKIE)
          .header('ETag', etag)
          .send();
      }

      reply
        // Always H.264 MP4 regardless of the original container: this is what ffmpeg
        // just produced, and advertising `video/quicktime` would confuse a player
        // receiving exactly what it knows how to play.
        .header('Content-Type', 'video/mp4')
        .header('Accept-Ranges', 'bytes')
        .header('Cache-Control', IMMUTABLE)
        .header('Vary', VARY_COOKIE)
        .header('ETag', etag);

      const asked = parseRange(request.headers.range);
      if (!asked) {
        return reply.header('Content-Length', String(size)).send(createReadStream(path));
      }

      const range = resolveRange(asked, size);
      if (!range) {
        return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      }

      return reply
        .code(206)
        .header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
        .header('Content-Length', String(range.end - range.start + 1))
        .send(createReadStream(path, { start: range.start, end: range.end }));
    });

    /**
     * Original, unmodified file. Used for downloads (`?download=1`) and video playback —
     * in both cases content streams from Drive without passing through the disk cache,
     * which is not intended to host originals tens of megabytes in size.
     */
    app.get('/:mediaId/original', async (request, reply) => {
      const { mediaId } = request.params as { mediaId: string };
      const meta = context.media.getFileMeta(mediaId);
      if (!meta) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }

      const wantsDownload = (request.query as { download?: string }).download === '1';
      const range = parseRange(request.headers.range);
      // Which storage holds this file comes from its album, resolved once per request:
      // one instance now serves a photo from a Drive and the next from a bucket.
      const storage = context.storage.get(meta.connectionId);
      // Through `guard`, like every other read: a revoked authorisation must become the
      // 503 the error handler below already knows how to phrase, not a bare 500.
      const upstream = await storage.guard(() =>
        storage.fetch(mediaId, range ? formatRange(range) : undefined),
      );

      /**
       * Unsatisfiable range: the player requested an offset beyond the file's end,
       * which commonly happens when changing videos while a request is in flight.
       * The response is relayed as-is — its `Content-Range` carries the actual file
       * size, telling the player where to restart where a 500 would teach it nothing.
       */
      if (upstream.status === 416) {
        const contentRange = upstream.headers.get('content-range');
        reply.code(416).header('Accept-Ranges', 'bytes');
        if (contentRange) reply.header('Content-Range', contentRange);
        return reply.send();
      }

      if (!upstream.body) {
        return reply
          .code(502)
          .send({ error: 'bad_gateway', message: request.t('error.emptyFromStorage') });
      }

      reply
        .code(upstream.status === 206 ? 206 : 200)
        .header('Content-Type', meta.mimeType)
        // Required for the browser to allow seeking within the video.
        .header('Accept-Ranges', 'bytes')
        .header('Cache-Control', IMMUTABLE)
        .header('Vary', VARY_COOKIE);

      // Content-Length / Content-Range come from Drive: copying them verbatim ensures
      // they describe the relayed body exactly.
      for (const header of ['content-length', 'content-range'] as const) {
        const value = upstream.headers.get(header);
        if (value) reply.header(header, value);
      }

      if (wantsDownload) {
        reply.header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
        );
      }

      return reply.send(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]));
    });
  };
}
