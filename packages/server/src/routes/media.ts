import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { isThumbSize } from '@gdv/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { DriveNotConnectedError, DriveRevokedError } from '../drive/service.js';
import { formatRange, parseRange } from '../media/range.js';
import type { Variant } from '../media/renderer.js';
import { requireAuth } from '../plugins/auth.js';

/**
 * Les dérivés se comportent comme immuables : l'ETag intègre l'empreinte du
 * contenu, si bien qu'une nouvelle version du fichier produit un nouvel ETag et
 * force le rechargement, même à URL identique.
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

    /**
     * L'ETag distingue les variantes — sans quoi `full` et `hd` partageraient
     * la même entrée de cache navigateur et le zoom resservirait l'image basse
     * résolution — et la version du contenu, puisque Drive garde le même
     * identifiant quand un fichier est remplacé par une nouvelle version.
     */
    const version = meta.md5 ?? 'v0';
    const etag = `"${mediaId}-${version}-${variant.kind === 'thumb' ? variant.size : variant.kind}"`;
    if (request.headers['if-none-match'] === etag) {
      return reply.code(304).header('Cache-Control', IMMUTABLE).header('ETag', etag).send();
    }

    const rendered = await context.renderer.render(mediaId, variant, meta.md5);
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

    // Drive indisponible : message explicite plutôt qu'un 500 opaque répété sur
    // chaque vignette de la grille. Les deux cas sont distingués pour que
    // l'administrateur sache s'il doit connecter ou reconnecter.
    app.setErrorHandler(async (error, _request, reply) => {
      if (error instanceof DriveRevokedError) {
        return reply.code(503).send({ error: 'drive_revoked', message: error.message });
      }
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
     * Rendu haute résolution, demandé uniquement au premier zoom. Plafonné à
     * 4096 px, il pèse une fraction de l'original — quelques centaines de Ko
     * là où un JPEG d'appareil dépasse souvent 9 Mo — tout en montrant les
     * mêmes détails à l'écran.
     */
    app.get('/:mediaId/hd', async (request, reply) =>
      serveRendered(request, reply, { kind: 'hd' }),
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
