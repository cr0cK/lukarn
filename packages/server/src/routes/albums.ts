import { DEFAULT_SORT_ORDER, type Album, type ItemsPage } from '@gdv/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { requireAuth } from '../plugins/auth.js';
import { buildAlbum } from '../repo.js';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const querySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  // Un sens de tri inconnu est refusé plutôt que ramené au défaut : un client
  // qui se trompe de valeur doit l'apprendre, pas recevoir silencieusement
  // l'album à l'envers de ce qu'il affiche.
  order: z.enum(['desc', 'asc']).default(DEFAULT_SORT_ORDER),
});

export function createAlbumRoutes(context: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth);

    app.get('/', async (request, reply) => {
      const username = request.user!.username;
      const albums: Album[] = context
        .albumsFor(username)
        .map((album) => buildAlbum(album, context.media, context.syncState));
      return reply.send(albums);
    });

    app.get('/:albumId', async (request, reply) => {
      const { albumId } = request.params as { albumId: string };
      const album = context.findAlbum(albumId);

      // Un album interdit et un album inexistant renvoient la même chose :
      // la liste des albums d'autrui ne doit pas être devinable.
      if (!album || !context.canSee(request.user!.username, albumId)) {
        return reply.code(404).send({ error: 'not_found', message: 'Album introuvable' });
      }
      return reply.send(buildAlbum(album, context.media, context.syncState));
    });

    app.get('/:albumId/items', async (request, reply) => {
      const { albumId } = request.params as { albumId: string };
      if (!context.findAlbum(albumId) || !context.canSee(request.user!.username, albumId)) {
        return reply.code(404).send({ error: 'not_found', message: 'Album introuvable' });
      }

      const query = querySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: 'bad_request', message: 'Paramètres invalides' });
      }

      const page: ItemsPage = context.media.listItems(
        albumId,
        query.data.limit,
        query.data.cursor ?? null,
        query.data.order,
      );
      return reply.send(page);
    });

    app.get('/:albumId/items/:mediaId', async (request, reply) => {
      const { albumId, mediaId } = request.params as { albumId: string; mediaId: string };
      if (!context.findAlbum(albumId) || !context.canSee(request.user!.username, albumId)) {
        return reply.code(404).send({ error: 'not_found', message: 'Album introuvable' });
      }

      const detail = context.media.getDetail(albumId, mediaId);
      if (!detail) {
        return reply.code(404).send({ error: 'not_found', message: 'Média introuvable' });
      }
      return reply.send(detail);
    });
  };
}
