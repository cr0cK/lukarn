import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { isThumbSize } from '@gdv/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { DriveNotConnectedError } from '../drive/service.js';
import { formatRange, parseRange } from '../media/range.js';
import type { Variant } from '../media/renderer.js';
import { requireAuth } from '../plugins/auth.js';

/**
 * Les dérivés sont immuables : l'id Drive change dès que le fichier est
 * remplacé, donc l'URL désigne toujours le même octet-pour-octet.
 */
const IMMUTABLE = 'private, max-age=31536000, immutable';

const thumbQuery = z.object({ s: z.coerce.number().int().default(320) });

export function createMediaRoutes(context: AppContext): FastifyPluginAsync {
  /**
   * Contrôle d'accès de tout le pipeline média. Un même fichier Drive peut
   * être indexé dans plusieurs albums (dossiers imbriqués) : l'accès est
   * accordé dès qu'un de ces albums est visible par l'utilisateur.
   *
   * En cas de refus, la réponse est un 404 et non un 403 — l'existence d'un
   * média dans un album non autorisé ne doit pas être observable.
   */
  async function authorize(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const { mediaId } = request.params as { mediaId: string };
    const username = request.user!.username;

    const albums = context.media.albumsContaining(mediaId);
    const allowed = albums.some((albumId) => context.canSee(username, albumId));

    if (!allowed) {
      await reply.code(404).send({ error: 'not_found', message: 'Média introuvable' });
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
      return reply.code(404).send({ error: 'not_found', message: 'Média introuvable' });
    }
    if (meta.kind !== 'photo') {
      return reply
        .code(415)
        .send({ error: 'unsupported', message: 'Rendu image indisponible pour une vidéo' });
    }

    const etag = `"${mediaId}-${variant.kind === 'thumb' ? variant.size : 'full'}"`;
    if (request.headers['if-none-match'] === etag) {
      return reply.code(304).header('Cache-Control', IMMUTABLE).header('ETag', etag).send();
    }

    const rendered = await context.renderer.render(mediaId, variant);
    return reply
      .header('Content-Type', rendered.contentType)
      .header('Cache-Control', IMMUTABLE)
      .header('ETag', etag)
      .send(createReadStream(rendered.path));
  }

  return async (app) => {
    app.addHook('preHandler', requireAuth);
    app.addHook('preHandler', async (request, reply) => {
      await authorize(request, reply);
    });

    // Drive non connecté : message explicite plutôt qu'un 500 opaque répété
    // sur chaque vignette de la grille.
    app.setErrorHandler(async (error, _request, reply) => {
      if (error instanceof DriveNotConnectedError) {
        return reply.code(503).send({ error: 'drive_disconnected', message: error.message });
      }
      throw error;
    });

    app.get('/:mediaId/thumb', async (request, reply) => {
      const query = thumbQuery.safeParse(request.query);
      const size = query.success ? query.data.s : 320;
      if (!isThumbSize(size)) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'Taille de vignette non supportée' });
      }
      return serveRendered(request, reply, { kind: 'thumb', size });
    });

    app.get('/:mediaId/full', async (request, reply) =>
      serveRendered(request, reply, { kind: 'full' }),
    );

    /**
     * Fichier d'origine, non transformé. Sert au téléchargement (`?download=1`)
     * et à la lecture vidéo — dans les deux cas le contenu transite depuis
     * Drive sans passer par le cache disque, qui n'a pas vocation à héberger
     * des originaux de plusieurs dizaines de Mo.
     */
    app.get('/:mediaId/original', async (request, reply) => {
      const { mediaId } = request.params as { mediaId: string };
      const meta = context.media.getFileMeta(mediaId);
      if (!meta) {
        return reply.code(404).send({ error: 'not_found', message: 'Média introuvable' });
      }

      const wantsDownload = (request.query as { download?: string }).download === '1';
      const range = parseRange(request.headers.range);
      const upstream = await context.drive.fetchFile(
        mediaId,
        range ? formatRange(range) : undefined,
      );

      if (!upstream.body) {
        return reply.code(502).send({ error: 'bad_gateway', message: 'Réponse Drive vide' });
      }

      reply
        .code(upstream.status === 206 ? 206 : 200)
        .header('Content-Type', meta.mimeType)
        // Indispensable pour que le navigateur autorise le seek dans la vidéo.
        .header('Accept-Ranges', 'bytes')
        .header('Cache-Control', IMMUTABLE);

      // Content-Length / Content-Range viennent de Drive : les recopier tels
      // quels garantit qu'ils décrivent exactement le corps relayé.
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
