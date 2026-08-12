import { SEARCH_MIN_LENGTH, type SearchHit } from '@lukarn/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { requireAuth } from '../plugins/auth.js';

/**
 * Beyond this, it is no longer a search: every word becomes another term in the FTS
 * expression, and input pasted from an article would produce hundreds for a result
 * nobody expects.
 */
const MAX_LENGTH = 100;

const querySchema = z.object({
  q: z.string().min(SEARCH_MIN_LENGTH).max(MAX_LENGTH),
});

export function createSearchRoutes(context: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth);

    /**
     * Searches for navigable entities — an album, a day, a photo — in albums assigned
     * to the session, and **only** those albums: scope comes from the server, never a
     * parameter.
     *
     * Input that is too short or too long returns 400 rather than an empty list: a
     * mistaken client must be told.
     */
    app.get('/', async (request, reply) => {
      const query = querySchema.safeParse(request.query);
      if (!query.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.invalidSearch') });
      }

      const albumIds = context.albumsFor(request.user!.username).map((album) => album.id);
      const hits: SearchHit[] = context.search.search(albumIds, query.data.q);
      return reply.send(hits);
    });
  };
}
