import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { isThumbSize } from '@nonni/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import {
  DriveNotConnectedError,
  DriveRevokedError,
  DriveUnavailableError,
} from '../drive/service.js';
import { formatRange, parseRange, type ByteRange } from '../media/range.js';
import type { Variant } from '../media/renderer.js';
import { playableKey } from '../media/transcode.js';
import { requireAuth } from '../plugins/auth.js';

/**
 * Les dérivés se comportent comme immuables : l'ETag intègre l'empreinte du
 * contenu, si bien qu'une nouvelle version du fichier produit un nouvel ETag et
 * force le rechargement, même à URL identique.
 */
const IMMUTABLE = 'private, max-age=31536000, immutable';

/**
 * Le cache privé du navigateur est indexé par la valeur du cookie, donc par la
 * session. Sans cela, deux comptes qui se succèdent dans le même profil —
 * l'ordinateur du salon — partagent les mêmes entrées : le second rouvre depuis
 * l'historique une photo d'un album qu'il n'a jamais eu le droit de voir, sans
 * qu'aucune requête n'atteigne `authorize()`.
 *
 * Ce que cet en-tête ne règle pas, et qu'aucun autre ne réglerait : celui à qui
 * on retire un album garde dans son cache les photos qu'il avait déjà chargées.
 * Il les a eues — on n'efface pas ce qui est déjà sur son disque (D43).
 */
const VARY_COOKIE = 'Cookie';

const thumbQuery = z.object({ s: z.coerce.number().int().default(320) });

/**
 * Ramène une plage demandée aux bornes réelles du fichier.
 *
 * `null` quand elle n'a aucune intersection avec lui : c'est le 416, que le
 * lecteur provoque couramment en changeant de vidéo pendant qu'une requête est
 * en vol.
 */
function resolveRange(range: ByteRange, size: number): { start: number; end: number } | null {
  // Plage suffixe (`bytes=-500`) : les derniers octets, jamais plus que le
  // fichier entier.
  if (range.start === null) {
    const length = Math.min(range.end ?? 0, size);
    return length > 0 ? { start: size - length, end: size - 1 } : null;
  }
  if (range.start >= size) return null;
  return { start: range.start, end: Math.min(range.end ?? size - 1, size - 1) };
}

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
      await reply.code(404).send({ error: 'not_found', message: 'Media not found' });
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
      return reply.code(404).send({ error: 'not_found', message: 'Media not found' });
    }
    /**
     * Une vidéo a une vignette — l'aperçu que Drive produit de sa première
     * seconde (D92) —, mais rien de plus : `full` et `hd` agrandiraient une
     * image de quelques centaines de pixels, et l'aperçu manque sur les
     * fichiers que Drive n'a pas su lire ou pas encore traités.
     */
    if (meta.kind === 'video') {
      if (variant.kind !== 'thumb') {
        return reply
          .code(415)
          .send({ error: 'unsupported', message: 'No fullscreen render for a video' });
      }
      if (!meta.hasThumbnail) {
        return reply
          .code(415)
          .send({ error: 'unsupported', message: 'No preview available for this video' });
      }
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
      return reply
        .code(304)
        .header('Cache-Control', IMMUTABLE)
        .header('Vary', VARY_COOKIE)
        .header('ETag', etag)
        .send();
    }

    const rendered = await context.renderer.render(
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
      // Délai dépassé ou débit limité : **transitoire**. Le 503 et le
      // `Retry-After` disent au client de revenir, là où le 500 par défaut lui
      // ferait abandonner la vignette jusqu'au prochain rechargement de page.
      // Aucun en-tête de cache n'est posé : un échec ne doit jamais être gardé.
      if (error instanceof DriveUnavailableError) {
        return reply
          .code(503)
          .header('Retry-After', String(error.retryAfterSeconds))
          .send({ error: 'drive_unavailable', message: error.message });
      }
      throw error;
    });

    app.get('/:mediaId/thumb', async (request, reply) => {
      const query = thumbQuery.safeParse(request.query);
      const size = query.success ? query.data.s : 320;
      if (!isThumbSize(size)) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'Unsupported thumbnail size' });
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
     * Version transcodée, servie depuis le magasin disque (D260809b).
     *
     * **404 quand elle n'est pas là**, et c'est le contrat avec le front : la
     * préparation est anticipée et lente, une vidéo arrivée il y a dix minutes
     * n'a pas encore la sienne. Le front en fait « en préparation », avec le
     * bouton Télécharger de D79 — pas une erreur.
     *
     * Le fichier est local, contrairement à `/original` : les plages sont donc
     * résolues ici plutôt que relayées à Drive.
     */
    app.get('/:mediaId/playable', async (request, reply) => {
      const { mediaId } = request.params as { mediaId: string };
      const meta = context.media.getFileMeta(mediaId);
      if (!meta) {
        return reply.code(404).send({ error: 'not_found', message: 'Media not found' });
      }

      const path = context.videoStore.hit(playableKey(mediaId, meta.md5));
      // L'inventaire peut désigner un fichier qui n'est plus là — éviction
      // concurrente, ménage manuel sur le volume : `stat` tranche avant que les
      // en-têtes soient posés, là où `createReadStream` échouerait après.
      const size = path
        ? await stat(path).then(
            (info) => info.size,
            () => null,
          )
        : null;
      if (path === null || size === null) {
        return reply
          .code(404)
          .send({ error: 'not_ready', message: 'Playable version not prepared yet' });
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
        // Toujours du MP4 H.264, quel que soit le conteneur d'origine : c'est ce
        // que ffmpeg vient de produire, et annoncer `video/quicktime` ferait
        // douter un lecteur qui reçoit pourtant exactement ce qu'il sait lire.
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
     * Fichier d'origine, non transformé. Sert au téléchargement (`?download=1`)
     * et à la lecture vidéo — dans les deux cas le contenu transite depuis
     * Drive sans passer par le cache disque, qui n'a pas vocation à héberger
     * des originaux de plusieurs dizaines de Mo.
     */
    app.get('/:mediaId/original', async (request, reply) => {
      const { mediaId } = request.params as { mediaId: string };
      const meta = context.media.getFileMeta(mediaId);
      if (!meta) {
        return reply.code(404).send({ error: 'not_found', message: 'Media not found' });
      }

      const wantsDownload = (request.query as { download?: string }).download === '1';
      const range = parseRange(request.headers.range);
      const upstream = await context.drive.fetchFile(
        mediaId,
        range ? formatRange(range) : undefined,
      );

      /**
       * Plage insatisfaisable : le lecteur a demandé un offset au-delà de la
       * fin du fichier, ce qui arrive couramment en changeant de vidéo pendant
       * qu'une requête est en vol. La réponse est relayée telle quelle — son
       * `Content-Range` porte la taille réelle du fichier, ce qui dit au
       * lecteur où recommencer là où un 500 ne lui apprendrait rien.
       */
      if (upstream.status === 416) {
        const contentRange = upstream.headers.get('content-range');
        reply.code(416).header('Accept-Ranges', 'bytes');
        if (contentRange) reply.header('Content-Range', contentRange);
        return reply.send();
      }

      if (!upstream.body) {
        return reply.code(502).send({ error: 'bad_gateway', message: 'Empty response from Drive' });
      }

      reply
        .code(upstream.status === 206 ? 206 : 200)
        .header('Content-Type', meta.mimeType)
        // Indispensable pour que le navigateur autorise le seek dans la vidéo.
        .header('Accept-Ranges', 'bytes')
        .header('Cache-Control', IMMUTABLE)
        .header('Vary', VARY_COOKIE);

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
