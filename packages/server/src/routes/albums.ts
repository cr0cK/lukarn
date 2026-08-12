import {
  DEFAULT_SORT_ORDER,
  type Album,
  type AlbumDay,
  type ItemsPage,
  type MediaDetail,
} from '@lukarn/shared';
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
  // An unknown sort order is rejected rather than reduced to the default: a client
  // supplying the wrong value must learn about it, not silently receive the album in
  // the opposite order from what it displays.
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

      // A forbidden album and a non-existent album return the same response so nobody
      // can infer another person's album list.
      if (!album || !context.canSee(request.user!.username, albumId)) {
        return reply.code(404).send({ error: 'not_found', message: 'Album not found' });
      }
      return reply.send(buildAlbum(album, context.media, context.syncState));
    });

    /**
     * The album's annotated days — note, manually entered place and places inferred
     * from EXIF. Only days with something to show are returned: one row per album day
     * would only enlarge the response.
     *
     * This is a read route and therefore belongs to the gallery, where the grid
     * displays the data. Writes live under `/api/admin` (D50).
     */
    app.get('/:albumId/days', async (request, reply) => {
      const { albumId } = request.params as { albumId: string };
      if (!context.findAlbum(albumId) || !context.canSee(request.user!.username, albumId)) {
        return reply.code(404).send({ error: 'not_found', message: 'Album not found' });
      }

      const days: AlbumDay[] = context.days.list(albumId);
      return reply.send(days);
    });

    app.get('/:albumId/items', async (request, reply) => {
      const { albumId } = request.params as { albumId: string };
      if (!context.findAlbum(albumId) || !context.canSee(request.user!.username, albumId)) {
        return reply.code(404).send({ error: 'not_found', message: 'Album not found' });
      }

      const query = querySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: 'bad_request', message: 'Invalid parameters' });
      }

      // Opening an album subscribes to its new items (D41): this is a much better
      // signal of interest than a checkbox nobody selects. Only on the first page —
      // subsequent pages are the same action — and never on media details, otherwise
      // the "View photo" link in a comment notification would subscribe to album
      // updates nobody requested. The repository excludes unverified identities.
      if (query.data.cursor === undefined) {
        if (request.commenterId !== null) {
          context.subscriptions.subscribe(request.commenterId, albumId);
        }
        // Same action and condition, but independent of identity where subscription
        // requires a verified commenter: this counts visits, not subscribers
        // (D260809h).
        context.visits.recordAlbumOpen(albumId, request.user!.username, request.sessionId!);
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
        return reply.code(404).send({ error: 'not_found', message: 'Album not found' });
      }

      const detail = context.media.getDetail(albumId, mediaId);
      if (!detail) {
        return reply.code(404).send({ error: 'not_found', message: 'Media not found' });
      }

      // After the 404 check, never before: counting an invented identifier as opened
      // would create visits nobody made.
      context.visits.recordPhotoOpen(albumId, request.user!.username, request.sessionId!);

      // The count travels with details: the viewer displays it on its tab without
      // loading a thread that most visitors will not open.
      const media: MediaDetail = {
        ...detail,
        commentCount: context.comments.countFor(albumId, mediaId),
      };
      return reply.send(media);
    });
  };
}
