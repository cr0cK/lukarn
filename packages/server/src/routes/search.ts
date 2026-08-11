import { SEARCH_MIN_LENGTH, type SearchHit } from '@nonni/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { requireAuth } from '../plugins/auth.js';

/**
 * Au-delà, ce n'est plus une recherche : chaque mot devient un terme de plus
 * dans l'expression FTS, et une saisie collée depuis un article en produirait
 * des centaines pour un résultat que personne n'attend.
 */
const MAX_LENGTH = 100;

const querySchema = z.object({
  q: z.string().min(SEARCH_MIN_LENGTH).max(MAX_LENGTH),
});

export function createSearchRoutes(context: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth);

    /**
     * Cherche des entités navigables — un album, une journée, une photo — dans
     * les albums attribués à la session, et **seulement** dans ceux-là : le
     * périmètre vient du serveur, jamais d'un paramètre.
     *
     * Une saisie trop courte ou trop longue répond 400 plutôt qu'une liste
     * vide : un client qui se trompe doit l'apprendre.
     */
    app.get('/', async (request, reply) => {
      const query = querySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: 'bad_request', message: 'Recherche invalide' });
      }

      const albumIds = context.albumsFor(request.user!.username).map((album) => album.id);
      const hits: SearchHit[] = context.search.search(albumIds, query.data.q);
      return reply.send(hits);
    });
  };
}
