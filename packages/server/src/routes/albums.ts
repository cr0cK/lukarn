import {
  DEFAULT_SORT_ORDER,
  type Album,
  type AlbumDay,
  type ItemsPage,
  type MediaDetail,
} from '@nonni/shared';
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
        return reply.code(404).send({ error: 'not_found', message: 'Album not found' });
      }
      return reply.send(buildAlbum(album, context.media, context.syncState));
    });

    /**
     * Les journées annotées de l'album — note, lieu saisi, lieux déduits de
     * l'EXIF. Seules celles qui ont quelque chose à montrer sont rendues : une
     * ligne par jour d'album ne servirait qu'à grossir la réponse.
     *
     * Route de lecture, donc côté galerie : c'est la grille qui les affiche.
     * L'écriture, elle, est sous `/api/admin` (D50).
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

      // Ouvrir un album vaut abonnement à ses nouveautés (D41) : c'est un
      // signal d'intérêt bien meilleur qu'une case à cocher, que personne ne
      // coche. Sur la première page seulement — les suivantes sont le même
      // geste — et jamais sur le détail d'un média, sinon le lien « Voir la
      // photo » d'une notification de commentaire abonnerait aux nouveautés de
      // l'album, ce que personne n'a demandé. Le dépôt écarte les identités non
      // vérifiées.
      if (query.data.cursor === undefined) {
        if (request.commenterId !== null) {
          context.subscriptions.subscribe(request.commenterId, albumId);
        }
        // Même geste, même condition — mais inconditionnel sur l'identité, là
        // où l'abonnement exige un commentateur vérifié : on compte des
        // visites, pas des abonnés (D260809h).
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

      // Après le 404, jamais avant : compter l'ouverture d'un identifiant
      // inventé ferait des visites que personne n'a faites.
      context.visits.recordPhotoOpen(albumId, request.user!.username, request.sessionId!);

      // Le compteur voyage avec le détail : la visionneuse l'affiche sur son
      // onglet sans avoir à charger un fil que la plupart des visiteurs
      // n'ouvriront pas.
      const media: MediaDetail = {
        ...detail,
        commentCount: context.comments.countFor(albumId, mediaId),
      };
      return reply.send(media);
    });
  };
}
