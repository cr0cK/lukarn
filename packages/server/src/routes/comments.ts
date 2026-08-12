import {
  COMMENTS_FEED_PAGE_SIZE,
  COMMENT_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  type AlbumCommentCounts,
  type Comment,
  type CommentsFeedPage,
  type CommentsPage,
} from '@lukarn/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { EditWindowClosedError, UnknownParentError } from '../comments.js';
import type { AppContext } from '../context.js';
import type { Translate } from '../i18n/index.js';
import { verifyUnsubscribeToken } from '../crypto.js';
import { buildCommentMail, type Recipient } from '../mail.js';
import { requireAuth } from '../plugins/auth.js';

const createSchema = z.object({
  // `trim` before the lower bound: a comment containing three spaces is empty.
  body: z.string().trim().min(1).max(COMMENT_MAX_LENGTH),
  parentId: z.number().int().positive().nullable().optional(),
});

// Editing does not move a message within the thread: `parentId` is not accepted here,
// otherwise correcting a typo would allow changing conversations.
const updateSchema = createSchema.pick({ body: true });

/**
 * `coerce` because everything arrives as text in a query string. The upper `limit`
 * bound is not a courtesy: without it, `?limit=100000` would make synchronous
 * `better-sqlite3` assemble a page of one hundred thousand comments, blocking the
 * event loop while it renders.
 */
const feedSchema = z.object({
  album: z.string().min(1).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(COMMENTS_FEED_PAGE_SIZE),
});

const unsubscribeSchema = z.object({
  // The address itself identifies a person, while the access account may be shared.
  u: z.string().min(1).max(EMAIL_MAX_LENGTH),
  t: z.string().min(1).max(256),
});

/**
 * Comments: album counts, reading and writing a thread, editing, deletion and
 * unsubscribing.
 *
 * Access exactly follows album access: an album the requester may not view returns
 * 404, never 403 — otherwise probing identifiers would reveal other people's albums
 * (D12). Each route repeats the check rather than delegating it to a prefix
 * `preHandler`: here the album is not in a fixed URL segment as it is for media.
 */
export function createCommentRoutes(context: AppContext): FastifyPluginAsync {
  return async (app) => {
    /**
     * Unsubscribing deliberately sits outside the authenticated scope below: the link
     * is clicked from an inbox, often on another device, and requiring sign-in to stop
     * being disturbed would fail to honour the request.
     */
    app.get('/unsubscribe', async (request, reply) => {
      const parsed = unsubscribeSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.incompleteLink') });
      }

      const { u: email, t: token } = parsed.data;
      if (!verifyUnsubscribeToken(email, token, context.env.sessionSecret)) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.invalidOrExpiredLink') });
      }

      const commenter = context.commenters.byEmail(email);
      // The identity has disappeared since delivery: unsubscribing is moot, and saying
      // so avoids suggesting a failure.
      if (commenter) context.commenters.setNotify(commenter.id, false);

      return reply
        .type('text/html; charset=utf-8')
        .send(unsubscribePage(context.env.publicUrl, Boolean(commenter), request.t));
    });

    await app.register(async (scoped) => {
      scoped.addHook('preHandler', requireAuth);

      /**
       * Activity feed: latest comments across all albums and photos.
       *
       * Declared before `/:albumId`, though order does not matter: Fastify's routing
       * table always prioritises a literal segment over a parameter. This also protects
       * `/unsubscribe`, and a test verifies it — an album whose Drive identifier was
       * `feed` would remain unreachable through this route with no indication why.
       *
       * Isolation depends on `albumsFor()`: the list of visible albums comes from the
       * server, never the request. `?album=` only narrows it — it does not widen it,
       * and an invisible album returns 404 as everywhere else (D12).
       */
      scoped.get('/feed', async (request, reply) => {
        const parsed = feedSchema.safeParse(request.query);
        if (!parsed.success) {
          return reply
            .code(400)
            .send({ error: 'bad_request', message: request.t('error.invalidRequest') });
        }

        const account = request.user!;
        const { album, cursor, limit } = parsed.data;

        if (
          album !== undefined &&
          (!context.findAlbum(album) || !context.canSee(account.username, album))
        ) {
          return reply
            .code(404)
            .send({ error: 'not_found', message: request.t('error.albumNotFound') });
        }

        const albumIds =
          album !== undefined
            ? [album]
            : context.albumsFor(account.username).map((visible) => visible.id);

        const page: CommentsFeedPage = context.comments.listFeed({
          albumIds,
          cursor: cursor ?? null,
          limit,
          viewer: { commenterId: request.commenterId, admin: account.admin },
        });
        return reply.send(page);
      });

      /**
       * Counts for the whole album, used by the viewer badge.
       *
       * One call per album rather than per photo: the badge must be present as soon as
       * a photo is reached, while navigating an album with arrow keys crosses hundreds
       * of views. The thread itself remains loaded when the panel opens.
       *
       * This parameterised route does not mask `/unsubscribe`, declared outside the
       * authenticated scope: Fastify's routing table always prioritises a literal
       * segment over a parameter. A test verifies this — the opposite would make it
       * impossible to honour unsubscribe links in already sent emails.
       */
      scoped.get('/:albumId', async (request, reply) => {
        const { albumId } = request.params as { albumId: string };
        const account = request.user!;
        if (!context.findAlbum(albumId) || !context.canSee(account.username, albumId)) {
          return reply
            .code(404)
            .send({ error: 'not_found', message: request.t('error.albumNotFound') });
        }

        const counts: AlbumCommentCounts = { counts: context.comments.countsByAlbum(albumId) };
        return reply.send(counts);
      });

      scoped.get('/:albumId/:mediaId', async (request, reply) => {
        const { albumId, mediaId } = request.params as { albumId: string; mediaId: string };
        const account = request.user!;
        if (!context.findAlbum(albumId) || !context.canSee(account.username, albumId)) {
          return reply
            .code(404)
            .send({ error: 'not_found', message: request.t('error.albumNotFound') });
        }

        const page: CommentsPage = context.comments.thread(albumId, mediaId, {
          commenterId: request.commenterId,
          admin: account.admin,
        });
        return reply.send(page);
      });

      scoped.post('/:albumId/:mediaId', async (request, reply) => {
        const { albumId, mediaId } = request.params as { albumId: string; mediaId: string };
        const account = request.user!;
        const album = context.findAlbum(albumId);
        if (!album || !context.canSee(account.username, albumId)) {
          return reply
            .code(404)
            .send({ error: 'not_found', message: request.t('error.albumNotFound') });
        }

        // Commenting requires a verified identity. This 403 is the second deliberate
        // exception to D12's "404, never 403": it concerns the state of the requester's
        // own account rather than another person's resource whose existence must be
        // hidden, so it reveals nothing.
        const commenterId = request.commenterId;
        if (commenterId === null) {
          return reply.code(403).send({
            error: 'identity_required',
            message: request.t('error.identityRequired'),
          });
        }

        // Commenting on a photo absent from the index would make no sense and would
        // leave threads that moderation displays without a file name.
        const detail = context.media.getDetail(albumId, mediaId);
        if (!detail) {
          return reply
            .code(404)
            .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
        }

        const parsed = createSchema.safeParse(request.body);
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
            account: account.username,
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

        notify(context, {
          comment,
          commenterId,
          albumId,
          albumTitle: album.title,
          mediaId,
          mediaName: detail.name,
        });

        return reply.code(201).send(comment);
      });

      /**
       * Editing by the author within the window following publication.
       *
       * The window is enforced **here**, not only in the interface: a rule applied
       * only by the front end is not a rule. An elapsed deadline returns 409 rather
       * than 403 — refusal concerns message state, not access rights, so the 404
       * doctrine (D12) does not apply: the author already sees their own comment.
       */
      scoped.patch('/:commentId', async (request, reply) => {
        const { commentId } = request.params as { commentId: string };
        const id = Number(commentId);
        if (!Number.isInteger(id) || id <= 0) {
          return reply
            .code(400)
            .send({ error: 'bad_request', message: request.t('error.invalidUsername') });
        }

        const parsed = updateSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({
            error: 'bad_request',
            message: request.t('error.commentLength', COMMENT_MAX_LENGTH),
          });
        }

        // Same guard as deletion: revoked access must not leave write permission on
        // an album that is no longer visible.
        const account = request.user!;
        const location = context.comments.locate(id);
        if (!location || !context.canSee(account.username, location.albumId)) {
          return reply
            .code(404)
            .send({ error: 'not_found', message: request.t('error.commentNotFound') });
        }

        let comment: Comment | null;
        try {
          comment = context.comments.edit(
            id,
            { commenterId: request.commenterId, admin: account.admin },
            parsed.data.body,
          );
        } catch (error) {
          if (error instanceof EditWindowClosedError) {
            return reply
              .code(409)
              .send({ error: 'edit_window_closed', message: request.t('error.editWindowClosed') });
          }
          throw error;
        }

        if (!comment) {
          return reply
            .code(404)
            .send({ error: 'not_found', message: request.t('error.commentNotFound') });
        }
        return reply.send(comment);
      });

      /**
       * Deletion by the author or by an administrator from the moderation queue. The
       * repository decides; a refusal is indistinguishable from a missing identifier
       * for the same reason as everywhere else.
       */
      scoped.delete('/:commentId', async (request, reply) => {
        const { commentId } = request.params as { commentId: string };
        const id = Number(commentId);
        if (!Number.isInteger(id) || id <= 0) {
          return reply
            .code(400)
            .send({ error: 'bad_request', message: request.t('error.invalidUsername') });
        }

        const account = request.user!;
        // Deletion is only allowed in an album still visible to the requester:
        // otherwise revoked access would leave a surviving write permission.
        const location = context.comments.locate(id);
        if (!location || (!account.admin && !context.canSee(account.username, location.albumId))) {
          return reply
            .code(404)
            .send({ error: 'not_found', message: request.t('error.commentNotFound') });
        }

        if (
          !context.comments.remove(id, { commenterId: request.commenterId, admin: account.admin })
        ) {
          return reply
            .code(404)
            .send({ error: 'not_found', message: request.t('error.commentNotFound') });
        }
        return reply.code(204).send();
      });
    });
  };
}

/**
 * Queues notifications for a new comment outside the response path, so the author
 * sees the published message without waiting for the SMTP server.
 */
function notify(
  context: AppContext,
  input: {
    comment: Comment;
    commenterId: number;
    albumId: string;
    albumTitle: string;
    mediaId: string;
    mediaName: string;
  },
): void {
  if (!context.mailer.enabled) return;

  const recipients: Recipient[] = [];

  // The moderation address is an instance setting: an administrator account is an
  // access key, not a reachable person.
  const moderation = context.settings.moderationEmail;
  // The moderation address has no identity, hence no recorded language: the
  // instance default applies.
  if (moderation) {
    recipients.push({
      email: moderation,
      reason: 'moderation',
      locale: context.env.defaultLocale,
    });
  }

  // Reply: the thread root's author, never the person who just wrote.
  if (input.comment.parentId !== null) {
    const author = context.commenters.recipientForReply(input.comment.parentId, input.commenterId);
    if (author) {
      recipients.push({
        email: author.email,
        reason: 'reply',
        locale: author.locale ?? context.env.defaultLocale,
      });
    }
  }

  for (const recipient of recipients) {
    context.mailer.queue(
      buildCommentMail(
        {
          albumId: input.albumId,
          albumTitle: input.albumTitle,
          mediaId: input.mediaId,
          mediaName: input.mediaName,
          authorDisplayName: input.comment.author.displayName,
          body: input.comment.body,
        },
        recipient,
        context.env,
      ),
    );
  }
}

/**
 * Unsubscribe confirmation page rendered by the server rather than the front end:
 * users arrive without a session, and loading the React application to display one
 * sentence would redirect to the sign-in screen.
 */
function unsubscribePage(publicUrl: string, found: boolean, t: Translate): string {
  const message = t(found ? 'page.commentsStopped' : 'page.commentsUnknown');

  // `lang` follows the language actually written: this page is opened from an
  // inbox, outside the React application, so nothing else would set it.
  return `<!doctype html>
<html lang="${t.locale}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${t('page.unsubscribedTitle')}</title>
  </head>
  <body style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; max-width: 34rem; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.6; color: #1a1a1a;">
    <h1 style="font-size: 1.25rem; margin: 0 0 1rem;">${t('page.done')}</h1>
    <p style="margin: 0 0 1.5rem;">${message}</p>
    <p style="margin: 0; font-size: 0.9rem; color: #666;">
      ${t('page.commentsRestore')}
      <br>
      <a href="${publicUrl}" style="color: #2563eb;">${t('page.backToGallery')}</a>
    </p>
  </body>
</html>`;
}
