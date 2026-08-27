import {
  COMMENT_MAX_LENGTH,
  DEFAULT_SORT_ORDER,
  SHARE_TOKEN_PATTERN,
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

  return async (app) => {
    /**
     * Opening the link. The one route that mints a session, and the only address its
     * recipient was ever given.
     */
    app.get('/:token', async (request, reply) => {
      const link = await resolve(request, reply);
      if (!link) return reply;

      const opened = view(context, link);
      // The photograph left the index — a renamed folder, an interrupted sync. The
      // link is live and covers nothing, and saying so is the point: answering 404
      // here would tell its reader they got the address wrong.
      if (!opened) {
        return reply.code(410).send({ error: 'share_gone', message: request.t('error.shareGone') });
      }

      /**
       * **An account that can already see this keeps its account.**
       *
       * There is one session cookie per browser, so minting here would sign the
       * owner out of their own instance for having checked the link they just
       * issued — and the cached `/api/auth/me` beside it would still say otherwise.
       * Replacing a credential to show somebody what it already opens is a side
       * effect nobody asked for.
       *
       * Their visit is not counted either. What the openings answer is "did it
       * reach the person I sent it to" (D260825c), and the issuer testing their own
       * link is exactly the reading that would make it lie.
       *
       * **`canSee` is asked about the account, never about the link.** It decides
       * one thing here: whether this session already serves the content. An account
       * that cannot — somebody sent a link to an album nobody gave them — is a
       * recipient like any other and gets a link session, because the `/media`
       * prefix would otherwise refuse every photograph on the page it just drew.
       */
      const account =
        request.user?.username != null && context.canSee(request.user.username, link.albumId);

      let sessionId = sessionFor(request, link);
      if (sessionId === null && !account) {
        const session = context.sessions.createForShare(
          link.token,
          classifyDevice(request.headers['user-agent']),
        );
        sessionId = session.id;
        void reply.setCookie(
          SESSION_COOKIE,
          session.id,
          sessionCookieOptions(context.env.publicUrl, context.sessions.ttlMs),
        );
        // A session that has just replaced another carries no identity yet: the
        // commenter below belongs to the credential this request arrived with, not
        // to the one it leaves with.
      }

      if (sessionId !== null && !account) {
        // After the session exists, so the first opening is counted rather than
        // lost, and once per session and hour, which the primary key enforces
        // (D260825c).
        context.shares.recordOpening(link.token, sessionId);

        // Opening an album subscribes a verified visitor to its updates, exactly as
        // opening it with an account does (D41). A shared photograph subscribes
        // nobody: no album was opened, which is D41's own condition rather than an
        // exception to it (D260825e).
        //
        // `sessionId === request.sessionId` is what keeps it honest: on a request
        // that just minted a session, `request.commenterId` still belongs to the
        // link the visitor arrived on, and subscribing that person to this album
        // would credit an interest they never expressed here. Verifying an address
        // reopens the link, which is when this fires for them.
        if (
          link.mediaId === null &&
          sessionId === request.sessionId &&
          request.commenterId !== null
        ) {
          context.subscriptions.subscribe(request.commenterId, link.albumId);
        }
      }

      return reply.send(opened);
    });

    /** A shared album's grid, page by page. A photograph link has no grid. */
    app.get('/:token/items', async (request, reply) => {
      const link = await resolve(request, reply);
      if (!link) return reply;
      if (link.mediaId !== null) {
        return reply.code(404).send({ error: 'not_found', message: request.t('error.notFound') });
      }

      const query = pageSchema.safeParse(request.query);
      if (!query.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.invalidParameters') });
      }

      const page = context.media.listItems(
        link.albumId,
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

      const { mediaId } = request.params as { mediaId: string };
      const detail = context.shares.covers(link, mediaId)
        ? context.media.getDetail(link.albumId, mediaId)
        : null;
      if (!detail) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }

      const { albumId: _covered, ...item } = detail;
      const body: ShareDetail = {
        ...item,
        commentCount: context.comments.countFor(link.albumId, mediaId),
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

      const { mediaId } = request.params as { mediaId: string };
      if (!context.shares.covers(link, mediaId)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }

      // `admin` is false for a link by construction, so hidden comments stay hidden
      // and the reader may delete only what it wrote.
      const page: CommentsPage = context.comments.thread(link.albumId, mediaId, {
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

      // The same 403 the album path returns, and not a 404 for the same reason: it
      // concerns the state of the requester's own session, not another person's
      // resource whose existence has to stay hidden.
      const commenterId = request.commenterId;
      if (commenterId === null) {
        return reply
          .code(403)
          .send({ error: 'identity_required', message: request.t('error.identityRequired') });
      }

      const detail = context.media.getDetail(link.albumId, mediaId);
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
          albumId: link.albumId,
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
        albumId: link.albumId,
        albumTitle: context.findAlbum(link.albumId)?.title ?? link.albumId,
        mediaId,
        mediaName: detail.name,
      });

      return reply.code(201).send(comment);
    });
  };
}

/**
 * What the recipient receives, by kind, or `null` when the link covers a photograph
 * the index no longer holds. The album's identifier is in neither branch.
 */
function view(context: AppContext, link: ShareLink): ShareView | null {
  if (shareKind(link) === 'album') {
    // Non-null: `share_links.album_id` cascades with the album, so a live link
    // always has one.
    const album = context.findAlbum(link.albumId)!;
    const stats = context.media.stats(link.albumId, album.coverMediaId);
    return {
      kind: 'album',
      title: album.title,
      description: album.description,
      itemCount: stats.itemCount,
      coverId: stats.coverId,
      coverVersion: stats.coverVersion,
      groupBy: album.groupBy,
      sortOrder: album.sortOrder,
    };
  }

  const detail = context.media.getDetail(link.albumId, link.mediaId!);
  if (!detail) return null;

  const { albumId: _covered, ...item } = detail;
  return {
    kind: 'media',
    item: { ...item, commentCount: context.comments.countFor(link.albumId, link.mediaId!) },
  };
}
