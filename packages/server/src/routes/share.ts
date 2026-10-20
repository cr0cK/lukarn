import {
  COMMENT_MAX_LENGTH,
  DEFAULT_SORT_ORDER,
  SHARE_TOKEN_PATTERN,
  isThumbSize,
  type Comment,
  type CommentsPage,
  type ShareDetail,
  type ShareItemsPage,
  type ShareView,
} from '@lukarn/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { UnknownParentError } from '../comments.js';
import type { AppContext } from '../context.js';
import { classifyDevice } from '../device.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../sessions.js';
import { shareKind, shareState, type ShareLink } from '../shares.js';
import { notifyComment } from './comments.js';
import {
  handleMediaError,
  serveOriginal,
  servePlayable,
  serveRendered,
  thumbQuery,
} from './media.js';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const pageSchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  order: z.enum(['desc', 'asc']).default(DEFAULT_SORT_ORDER),
});

const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(COMMENT_MAX_LENGTH),
  parentId: z.number().int().positive().nullable().optional(),
});

const feedQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  mediaId: z.string().min(1).max(128).optional(),
});

const updateSubscriptionSchema = z
  .object({
    notify: z.boolean().optional(),
    notifyPhotos: z.boolean().optional(),
    notifyComments: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.notify !== undefined ||
      data.notifyPhotos !== undefined ||
      data.notifyComments !== undefined,
    { message: 'At least one notification preference must be provided' },
  );

/**
 * What a share link opens, and everything reachable through one.
 *
 * **One address family, both kinds of link.** A shared photograph must not have its
 * album named anywhere its recipient can reach — not the page, not the address they
 * were sent, not the addresses their comment requests use (D260825e) — so every
 * route here is keyed on the token. Serving an album link through `/api/albums`
 * instead would give the feature two authorisation paths that start out identical
 * and drift on the first change to either.
 *
 * **Nothing here consults `ConfigRepo.canSee`.** The link is asked what it covers
 * (D260825). Media bytes are not served here either: they come from the `/media`
 * prefix, where the link is read beside the account at the one `preHandler` every
 * media route inherits (D4, D43).
 *
 * **A link that once worked answers 410 and says which of revoked or expired
 * happened; a token that never existed answers 404** (D260825b). Reaching the 410
 * requires already holding thirty-two random bytes, which is the same thing as
 * having been sent the link.
 */
export function createShareRoutes(context: AppContext): FastifyPluginAsync {
  /**
   * Resolves the token in the URL, answering for it when it does not work.
   *
   * Returns `null` once a reply has been sent, following the shape `authorize` in
   * `routes/media.ts` uses: the caller stops rather than the helper throwing.
   */
  async function resolve(request: FastifyRequest, reply: FastifyReply): Promise<ShareLink | null> {
    const { token } = request.params as { token: string };

    // Checked before the database is touched: a malformed address is an unknown
    // address, and answering it costs no query.
    if (!SHARE_TOKEN_PATTERN.test(token)) {
      await reply.code(404).send({ error: 'not_found', message: request.t('error.shareUnknown') });
      return null;
    }

    const link = context.shares.find(token);
    if (!link) {
      await reply.code(404).send({ error: 'not_found', message: request.t('error.shareUnknown') });
      return null;
    }

    const state = shareState(link);
    if (state !== 'live') {
      // 410, and which of the two: the person reading was sent this address by
      // somebody they know and cannot otherwise tell a mistyped address from one
      // that was taken back (D260825b). The reason travels in the body so the page
      // can say it in words; the status only says the link once worked.
      await reply.code(410).send({
        error: state === 'revoked' ? 'share_revoked' : 'share_expired',
        message: request.t(state === 'revoked' ? 'error.shareRevoked' : 'error.shareExpired'),
      });
      return null;
    }
    return link;
  }

  /**
   * The session this request carries, when it is this link's own.
   *
   * A visitor holding two links has one cookie between them, so a request arriving
   * on link B carrying link A's session is treated as having none: the route below
   * opens a fresh one rather than serving B under A's record of use.
   */
  function sessionFor(request: FastifyRequest, link: ShareLink): string | null {
    return request.share?.token === link.token ? request.sessionId : null;
  }

  async function ensureUnlocked(
    request: FastifyRequest,
    reply: FastifyReply,
    link: ShareLink,
  ): Promise<boolean> {
    if (link.requireIdentity && request.commenterId === null && request.user?.username == null) {
      await reply
        .code(403)
        .send({ error: 'identity_required', message: request.t('error.identityRequired') });
      return false;
    }
    return true;
  }

  return async (app) => {
    app.setErrorHandler(handleMediaError);

    /**
     * Opening the link. The one route that mints a session, and the only address its
     * recipient was ever given.
     */
    app.get('/:token', async (request, reply) => {
      const link = await resolve(request, reply);
      if (!link) return reply;

      const opened = view(context, link, request.commenterId);
      // The photograph left the index — a renamed folder, an interrupted sync. The
      // link is live and covers nothing, and saying so is the point: answering 404
      // here would tell its reader they got the address wrong.
      if (!opened) {
        return reply.code(410).send({ error: 'share_gone', message: request.t('error.shareGone') });
      }

      const username = request.user?.username;
      const linkAlbumIds =
        link.mediaId === null
          ? context.shares.findAlbumIds(link.token)
          : link.albumId
            ? [link.albumId]
            : [];
      const itemAlbumIds = context.shares.findItemAlbumIds(link.token);
      const allLinkAlbums = [...new Set([...linkAlbumIds, ...itemAlbumIds])];
      const account =
        username != null &&
        allLinkAlbums.length > 0 &&
        allLinkAlbums.every((id) => context.canSee(username, id));

      let sessionId = sessionFor(request, link);
      if (sessionId === null && !account) {
        const session = context.sessions.createForShare(
          link.token,
          classifyDevice(request.headers['user-agent']),
        );
        if (request.commenterId !== null) {
          context.sessions.attachCommenter(session.id, request.commenterId);
        }
        sessionId = session.id;
        void reply.setCookie(
          SESSION_COOKIE,
          session.id,
          sessionCookieOptions(context.env.publicUrl, context.sessions.ttlMs),
        );
      }

      if (sessionId !== null && !account) {
        context.shares.recordOpening(link.token, sessionId);
      }

      if (request.commenterId !== null) {
        context.shares.recordSubscriber(request.commenterId, link.token);
        if (link.mediaId === null) {
          for (const albumId of linkAlbumIds) {
            context.subscriptions.subscribe(request.commenterId, albumId);
          }
        }
      }

      if (link.requireIdentity && request.commenterId === null && !account) {
        const locked: ShareView = {
          kind: 'locked',
          label:
            link.label ??
            (link.mediaId === null && linkAlbumIds[0]
              ? (context.findAlbum(linkAlbumIds[0])?.title ?? null)
              : null),
          requireIdentity: true,
          allowComments: link.allowComments,
        };
        return reply.send(locked);
      }

      return reply.send(opened);
    });

    /** A shared album's grid, page by page. A photograph link has no grid. */
    app.get('/:token/items', async (request, reply) => {
      const link = await resolve(request, reply);
      if (!link) return reply;
      if (link.requireIdentity && request.commenterId === null && request.user?.username == null) {
        return reply
          .code(403)
          .send({ error: 'identity_required', message: request.t('error.identityRequired') });
      }
      const albumIds = context.shares.findAlbumIds(link.token);
      if (link.mediaId !== null || albumIds.length === 0) {
        return reply.code(404).send({ error: 'not_found', message: request.t('error.notFound') });
      }

      const query = pageSchema.safeParse(request.query);
      if (!query.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.invalidParameters') });
      }

      const page = context.media.listItemsForAlbums(
        albumIds,
        query.data.limit,
        query.data.cursor ?? null,
        query.data.order,
      );
      const body: ShareItemsPage = {
        items: page.items.map(({ albumId: _covered, ...item }) => item),
        nextCursor: page.nextCursor,
      };
      return reply.send(body);
    });

    /** One photograph's record, for the viewer. */
    app.get('/:token/items/:mediaId', async (request, reply) => {
      const link = await resolve(request, reply);
      if (!link) return reply;
      if (link.requireIdentity && request.commenterId === null && request.user?.username == null) {
        return reply
          .code(403)
          .send({ error: 'identity_required', message: request.t('error.identityRequired') });
      }

      const { mediaId } = request.params as { mediaId: string };
      if (!context.shares.covers(link, mediaId)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }

      const albumId = albumIdForMedia(context, link, mediaId);
      if (!albumId) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }

      const detail = context.media.getDetail(albumId, mediaId);
      if (!detail) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }

      const { albumId: _covered, ...item } = detail;
      const body: ShareDetail = {
        ...item,
        commentCount: context.comments.countFor(albumId, mediaId),
      };
      return reply.send(body);
    });

    /**
     * The thread on one photograph.
     *
     * It resolves through `(album_id, media_id)` like every other, so a comment
     * written through a link lands in the conversation an account sees (D34). The
     * album travels no further than this handler.
     */
    app.get('/:token/comments/:mediaId', async (request, reply) => {
      const link = await resolve(request, reply);
      if (!link) return reply;
      if (link.requireIdentity && request.commenterId === null && request.user?.username == null) {
        return reply
          .code(403)
          .send({ error: 'identity_required', message: request.t('error.identityRequired') });
      }

      const { mediaId } = request.params as { mediaId: string };
      if (!context.shares.covers(link, mediaId)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }

      const albumId = albumIdForMedia(context, link, mediaId);
      if (!albumId) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }

      // `admin` is false for a link by construction, so hidden comments stay hidden
      // and the reader may delete only what it wrote.
      const page: CommentsPage = context.comments.thread(albumId, mediaId, {
        commenterId: request.commenterId,
        admin: false,
      });
      return reply.send(page);
    });

    /**
     * Writing through a link. It still costs a six-digit code sent to an address
     * (D39): the identity apparatus is reached at `/api/identity`, which names no
     * album and therefore works through a link unchanged.
     */
    app.post('/:token/comments/:mediaId', async (request, reply) => {
      const link = await resolve(request, reply);
      if (!link) return reply;

      const { mediaId } = request.params as { mediaId: string };
      if (!context.shares.covers(link, mediaId)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }

      if (!link.allowComments) {
        return reply.code(403).send({
          error: 'comments_disabled',
          message: request.t('error.commentsDisabledOnShare'),
        });
      }

      // The same 403 the album path returns, and not a 404 for the same reason: it
      // concerns the state of the requester's own session, not another person's
      // resource whose existence has to stay hidden.
      const commenterId = request.commenterId;
      if (commenterId === null) {
        return reply
          .code(403)
          .send({ error: 'identity_required', message: request.t('error.identityRequired') });
      }

      const albumId = albumIdForMedia(context, link, mediaId);
      if (!albumId) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }

      const detail = context.media.getDetail(albumId, mediaId);
      if (!detail) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }

      const parsed = createCommentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'bad_request',
          message: request.t('error.commentLength', COMMENT_MAX_LENGTH),
        });
      }

      let comment: Comment;
      try {
        comment = context.comments.create({
          albumId,
          mediaId,
          commenterId,
          // The credential that carried the message, which is the link (D38). The
          // column holds an access key or a token, and moderation reads it to say
          // which invitation delivered something — the job it already had.
          account: link.token,
          body: parsed.data.body,
          parentId: parsed.data.parentId ?? null,
        });
      } catch (error) {
        if (error instanceof UnknownParentError) {
          return reply
            .code(404)
            .send({ error: 'not_found', message: request.t('error.unknownParent') });
        }
        throw error;
      }

      notifyComment(context, {
        comment,
        commenterId,
        albumId,
        albumTitle: context.findAlbum(albumId)?.title ?? albumId,
        mediaId,
        mediaName: detail.name,
      });

      return reply.code(201).send(comment);
    });

    /**
     * Recent comments activity feed across everything covered by this share link.
     *
     * Respects D260825e privacy invariants: origin album identifiers and titles are
     * suppressed for single-photograph and selection shares.
     */
    app.get('/:token/comments', async (request, reply) => {
      const link = await resolve(request, reply);
      if (!link) return reply;
      if (link.requireIdentity && request.commenterId === null && request.user?.username == null) {
        return reply
          .code(403)
          .send({ error: 'identity_required', message: request.t('error.identityRequired') });
      }

      const query = feedQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.invalidParameters') });
      }

      if (query.data.mediaId !== undefined && !context.shares.covers(link, query.data.mediaId)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }

      const page = context.comments.listFeedForShare({
        token: link.token,
        albumId: link.albumId,
        mediaId: query.data.mediaId ?? link.mediaId,
        viewer: {
          commenterId: request.commenterId,
          admin: Boolean(request.user?.admin),
        },
        cursor: query.data.cursor ?? null,
        limit: query.data.limit,
      });
      return reply.send(page);
    });

    /**
     * Updates granular notification preferences (`notifyPhotos`, `notifyComments`)
     * for the identified subscriber of this share link.
     */
    app.patch('/:token/subscription', async (request, reply) => {
      const link = await resolve(request, reply);
      if (!link) return reply;

      const commenterId = request.commenterId;
      if (commenterId === null) {
        return reply
          .code(403)
          .send({ error: 'identity_required', message: request.t('error.identityRequired') });
      }

      const parsed = updateSubscriptionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.invalidParameters') });
      }

      const notifyPhotos = parsed.data.notifyPhotos ?? parsed.data.notify;
      const notifyComments = parsed.data.notifyComments ?? parsed.data.notify;

      context.shares.recordSubscriber(commenterId, link.token);
      context.shares.setSubscriberPrefs(commenterId, link.token, {
        notifyPhotos,
        notifyComments,
      });
      context.commenters.setNotifyPreferences(commenterId, {
        notifyPhotos,
        notifyComments,
      });

      if (link.mediaId === null) {
        for (const albumId of context.shares.findAlbumIds(link.token)) {
          context.subscriptions.setPreferences(commenterId, albumId, {
            notifyPhotos,
            notifyComments,
          });
        }
      }

      const subRow = context.db
        .prepare(
          'SELECT notify_photos, notify_comments FROM commenter_shares WHERE commenter_id = ? AND token = ?',
        )
        .get(commenterId, link.token) as
        { notify_photos: number; notify_comments: number } | undefined;

      return reply.send({
        ok: true,
        notifyPhotos: subRow ? subRow.notify_photos === 1 : true,
        notifyComments: subRow ? subRow.notify_comments === 1 : true,
      });
    });

    /**
     * Media bytes scoped under this share token.
     *
     * Scoping media under the token in the URL ensures that concurrent visits to
     * different shared albums across browser tabs never collide on session cookies.
     * Access is authorized by the token and whether the link covers the media item.
     */
    app.get('/:token/media/:mediaId/thumb', async (request, reply) => {
      const link = await resolve(request, reply);
      if (!link) return reply;
      if (!(await ensureUnlocked(request, reply, link))) return reply;
      const { mediaId } = request.params as { mediaId: string };
      if (!context.shares.covers(link, mediaId)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }
      const query = thumbQuery.safeParse(request.query);
      const size = query.success ? query.data.s : 320;
      if (!isThumbSize(size)) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.unsupportedThumbSize') });
      }
      return serveRendered(context, request, reply, { kind: 'thumb', size }, mediaId);
    });

    app.get('/:token/media/:mediaId/full', async (request, reply) => {
      const link = await resolve(request, reply);
      if (!link) return reply;
      if (!(await ensureUnlocked(request, reply, link))) return reply;
      const { mediaId } = request.params as { mediaId: string };
      if (!context.shares.covers(link, mediaId)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }
      return serveRendered(context, request, reply, { kind: 'full' }, mediaId);
    });

    app.get('/:token/media/:mediaId/hd', async (request, reply) => {
      const link = await resolve(request, reply);
      if (!link) return reply;
      if (!(await ensureUnlocked(request, reply, link))) return reply;
      const { mediaId } = request.params as { mediaId: string };
      if (!context.shares.covers(link, mediaId)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }
      return serveRendered(context, request, reply, { kind: 'hd' }, mediaId);
    });

    app.get('/:token/media/:mediaId/playable', async (request, reply) => {
      const link = await resolve(request, reply);
      if (!link) return reply;
      if (!(await ensureUnlocked(request, reply, link))) return reply;
      const { mediaId } = request.params as { mediaId: string };
      if (!context.shares.covers(link, mediaId)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }
      return servePlayable(context, request, reply, mediaId);
    });

    app.get('/:token/media/:mediaId/original', async (request, reply) => {
      const link = await resolve(request, reply);
      if (!link) return reply;
      if (!(await ensureUnlocked(request, reply, link))) return reply;
      const { mediaId } = request.params as { mediaId: string };
      if (!context.shares.covers(link, mediaId)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }
      const wantsDownload = (request.query as { download?: string }).download === '1';
      return serveOriginal(context, request, reply, mediaId, wantsDownload);
    });
  };
}

function albumIdForMedia(context: AppContext, link: ShareLink, mediaId: string): string | null {
  if (link.albumId && context.media.getDetail(link.albumId, mediaId)) {
    return link.albumId;
  }
  const itemAlbumId = context.shares.findItemAlbumId(link.token, mediaId);
  if (itemAlbumId) return itemAlbumId;
  for (const albumId of context.shares.findAlbumIds(link.token)) {
    if (context.media.getDetail(albumId, mediaId)) return albumId;
  }
  return link.albumId;
}

/**
 * What the recipient receives, by kind, or `null` when the link covers a photograph
 * the index no longer holds. The album's identifier is in neither branch.
 */
function view(context: AppContext, link: ShareLink, commenterId: number | null): ShareView | null {
  const kind = shareKind(link);
  if (kind === 'album') {
    const albumIds = context.shares.findAlbumIds(link.token);
    const validAlbums = albumIds
      .map((id) => context.findAlbum(id))
      .filter((a): a is NonNullable<typeof a> => a !== undefined);
    if (validAlbums.length === 0) return null;

    const primary = validAlbums[0]!;
    let itemCount = 0;
    let coverId: string | null = null;
    let coverVersion: string | null = null;
    for (const album of validAlbums) {
      const stats = context.media.stats(album.id, album.coverMediaId);
      itemCount += stats.itemCount;
      if (coverId === null && stats.coverId !== null) {
        coverId = stats.coverId;
        coverVersion = stats.coverVersion;
      }
    }

    const favoriteMediaIds =
      commenterId !== null
        ? validAlbums.flatMap((album) => context.favorites.listForAlbum(commenterId, album.id))
        : [];

    return {
      kind: 'album',
      title: validAlbums.length > 1 && link.label ? link.label : primary.title,
      description: validAlbums.length > 1 ? null : primary.description,
      itemCount,
      coverId,
      coverVersion,
      groupBy: primary.groupBy,
      sortOrder: primary.sortOrder,
      albumCount: validAlbums.length,
      allowComments: link.allowComments,
      requireIdentity: link.requireIdentity,
      favoriteMediaIds,
    };
  }

  if (kind === 'selection') {
    const items = context.shares.findItems(link.token);
    if (items.length === 0) return null;
    const favoriteMediaIds =
      commenterId !== null
        ? context.favorites.listForMediaIds(
            commenterId,
            items.map((item) => item.id),
          )
        : [];
    return {
      kind: 'selection',
      items,
      label: link.label,
      itemCount: items.length,
      allowComments: link.allowComments,
      requireIdentity: link.requireIdentity,
      favoriteMediaIds,
    };
  }

  const detail = context.media.getDetail(link.albumId!, link.mediaId!);
  if (!detail) return null;

  const { albumId: _covered, ...item } = detail;
  const favoriteMediaIds =
    commenterId !== null && context.favorites.isFavorite(commenterId, link.albumId!, link.mediaId!)
      ? [link.mediaId!]
      : [];
  return {
    kind: 'media',
    item: { ...item, commentCount: context.comments.countFor(link.albumId!, link.mediaId!) },
    allowComments: link.allowComments,
    requireIdentity: link.requireIdentity,
    favoriteMediaIds,
  };
}
