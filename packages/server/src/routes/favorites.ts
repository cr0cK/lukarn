import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { requireAuth } from '../plugins/auth.js';

/**
 * Per-user favorites (`PUT /api/favorites/:albumId/:mediaId` and
 * `DELETE /api/favorites/:albumId/:mediaId`).
 *
 * Accessible to any session with a resolved `commenterId` that has read access to
 * `(albumId, mediaId)` either through an account (`ConfigRepo.canSee`) or an active
 * share link (`ShareLinkRepo.covers`).
 */
export function createFavoriteRoutes(context: AppContext): FastifyPluginAsync {
  function resolveFavoriteTarget(
    request: FastifyRequest,
    reply: FastifyReply,
  ): { commenterId: number; albumId: string; mediaId: string } | null {
    const { albumId: paramAlbumId, mediaId } = request.params as {
      albumId: string;
      mediaId: string;
    };
    const link = request.share;

    let resolvedAlbumId: string | null = null;
    if (link !== null) {
      const explicitAlbum = context.findAlbum(paramAlbumId) ? paramAlbumId : undefined;
      if (!context.shares.covers(link, mediaId, explicitAlbum)) {
        void reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
        return null;
      }
      resolvedAlbumId =
        explicitAlbum ??
        link.albumId ??
        context.shares.findItemAlbumId(link.token, mediaId) ??
        context.shares
          .findAlbumIds(link.token)
          .find((id) => context.media.getDetail(id, mediaId) !== null) ??
        null;
    } else {
      const username = request.user?.username;
      if (
        !username ||
        !context.findAlbum(paramAlbumId) ||
        !context.canSee(username, paramAlbumId)
      ) {
        void reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.albumNotFound') });
        return null;
      }
      resolvedAlbumId = paramAlbumId;
    }

    if (!resolvedAlbumId || !context.media.getDetail(resolvedAlbumId, mediaId)) {
      void reply.code(404).send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      return null;
    }

    if (request.commenterId === null) {
      void reply.code(403).send({
        error: 'identity_required',
        message: request.t('error.identityRequired'),
      });
      return null;
    }

    return {
      commenterId: request.commenterId,
      albumId: resolvedAlbumId,
      mediaId,
    };
  }

  return async (app) => {
    app.addHook('preHandler', requireAuth);

    app.put('/:albumId/:mediaId', async (request, reply) => {
      const target = resolveFavoriteTarget(request, reply);
      if (!target) return reply;

      context.favorites.add(target.commenterId, target.albumId, target.mediaId);
      return reply.send({ ok: true });
    });

    app.delete('/:albumId/:mediaId', async (request, reply) => {
      const target = resolveFavoriteTarget(request, reply);
      if (!target) return reply;

      context.favorites.remove(target.commenterId, target.albumId, target.mediaId);
      return reply.send({ ok: true });
    });
  };
}
