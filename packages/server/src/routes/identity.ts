import { EMAIL_MAX_LENGTH, VERIFICATION_CODE_LENGTH, type SessionUser } from '@lukarn/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { toIdentity } from '../commenters.js';
import type { AppContext } from '../context.js';
import { hasNoPassword } from '../crypto.js';
import { buildVerificationMail } from '../mail.js';
import { requireAuth } from '../plugins/auth.js';

const requestSchema = z.object({
  email: z.string().trim().email('invalid address').max(EMAIL_MAX_LENGTH),
  displayName: z.string().trim().min(1, 'name required').max(64),
});

const verifySchema = z.object({
  email: z.string().trim().email().max(EMAIL_MAX_LENGTH),
  code: z.string().trim().length(VERIFICATION_CODE_LENGTH),
});

const updateIdentitySchema = z
  .object({
    displayName: z.string().trim().min(1).max(64).optional(),
    notify: z.boolean().optional(),
    notifyPhotos: z.boolean().optional(),
    notifyComments: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.displayName !== undefined ||
      data.notify !== undefined ||
      data.notifyPhotos !== undefined ||
      data.notifyComments !== undefined,
    { message: 'At least one field must be provided' },
  );

/**
 * Commenter identity: declaring, verifying and forgetting it.
 *
 * These routes separate what the application once conflated: `users` is an access
 * key potentially shared by a whole family, while a comment must be signed by a
 * person. The email address provides that identity and is verified by a code —
 * otherwise anyone behind the shared key could sign using another person's name or
 * send notifications to a third party's inbox.
 */
export function createIdentityRoutes(context: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth);

    /** Rebuilds the session as returned by `/auth/me` after a change. */
    const sessionUser = (
      // `null` when a share link opened this session: commenting through a link still
      // costs a code sent to an address (D39), so these routes serve it unchanged and
      // there is simply no access key to report (D260825).
      username: string | null,
      admin: boolean,
      commenterId: number | null,
    ): SessionUser => {
      const account = username ? context.config.user(username) : undefined;
      const accountCommenter =
        account?.commenterId != null ? context.commenters.byId(account.commenterId) : null;
      const hasBoundEmail =
        accountCommenter !== null &&
        accountCommenter.email !== null &&
        accountCommenter.verifiedAt !== null;
      const effectiveCommenterId = commenterId ?? account?.commenterId ?? null;
      const commenter =
        effectiveCommenterId === null ? null : context.commenters.byId(effectiveCommenterId);
      return {
        username,
        displayName: account?.displayName || commenter?.displayName || username || '',
        admin,
        roleViewer: account ? account.admin || account.roleViewer : true,
        roleCommenter: account ? account.admin || account.roleCommenter : true,
        email: commenter?.email ?? null,
        hasPassword: account ? !hasNoPassword(account.passwordHash) : false,
        notifyPhotos: commenter?.notifyPhotos ?? true,
        notifyComments: commenter?.notifyComments ?? true,
        identity: commenter ? toIdentity(commenter) : null,
        identityBound: hasBoundEmail,
        commentsEnabled:
          context.mailer.enabled || Boolean(account && (account.admin || account.roleCommenter)),
      };
    };

    /**
     * Updates the display name or notification preferences (`notify`, `notifyPhotos`,
     * `notifyComments`) for the current session's commenter identity.
     */
    app.patch('/', async (request, reply) => {
      const commenterId = request.commenterId;
      if (commenterId === null) {
        return reply
          .code(403)
          .send({ error: 'identity_required', message: request.t('error.identityRequired') });
      }

      const parsed = updateIdentitySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.invalidIdentity') });
      }

      const { displayName, notify, notifyPhotos, notifyComments } = parsed.data;
      if (displayName !== undefined) {
        context.db
          .prepare(
            'UPDATE commenters SET display_name = ?, pending_display_name = NULL WHERE id = ?',
          )
          .run(displayName, commenterId);
        const linkedUser = context.config.userByCommenterId(commenterId);
        if (linkedUser) {
          context.db
            .prepare('UPDATE users SET display_name = ? WHERE username = ?')
            .run(displayName, linkedUser.username);
          context.config.invalidate();
        }
      }
      if (notify !== undefined) {
        context.commenters.setNotify(commenterId, notify);
      }
      if (notifyPhotos !== undefined || notifyComments !== undefined) {
        context.commenters.setNotifyPreferences(commenterId, { notifyPhotos, notifyComments });
      }
      if (
        request.share !== null &&
        (notify !== undefined || notifyPhotos !== undefined || notifyComments !== undefined)
      ) {
        context.shares.recordSubscriber(commenterId, request.share.token);
        context.shares.setSubscriberPrefs(commenterId, request.share.token, {
          notifyPhotos: notifyPhotos ?? notify,
          notifyComments: notifyComments ?? notify,
        });
      }

      return reply.send(sessionUser(request.user!.username, request.user!.admin, commenterId));
    });

    /**
     * A bound account is refused declaring an address, verifying one and
     * forgetting the identity.
     *
     * The identity of such an account is not the session's to choose. Without this,
     * somebody signed in as a person could declare another address and attach an
     * identity the account contradicts — or, on `/forget`, silently do nothing, since
     * `plugins/auth.ts` reads the account rather than the session. Changing the
     * address of a bound account is out of scope for this release; here the way out
     * is to sign out.
     */
    const rejectBoundIdentity = async (
      request: Parameters<typeof requireAuth>[0],
      reply: Parameters<typeof requireAuth>[1],
    ): Promise<void> => {
      if (request.user?.identityBound) {
        await reply
          .code(409)
          .send({ error: 'identity_bound', message: request.t('error.identityBound') });
      }
    };

    /**
     * Declares an address and sends the code. Always responds with `202`, whether the
     * address is already known or not: distinguishing the two would tell an attacker
     * which addresses have already commented on this instance.
     */
    app.post('/request-code', { preHandler: rejectBoundIdentity }, async (request, reply) => {
      if (!context.mailer.enabled) {
        return reply.code(503).send({
          error: 'mail_not_configured',
          message: request.t('error.mailNotConfigured'),
        });
      }

      const parsed = requestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'bad_request',
          message: parsed.error.issues[0]?.message ?? request.t('error.invalidIdentity'),
        });
      }

      const { email, displayName } = parsed.data;
      const minted = context.codes.mint(email, 'identity');

      if ('failure' in minted) {
        const seconds = Math.ceil(minted.retryAfterMs / 1000);
        return reply
          .code(429)
          .header('Retry-After', String(seconds))
          .send({
            error: 'too_soon',
            message: request.t('error.codeJustSent', seconds),
          });
      }

      // After the code, never before: a refused request must not record a name for
      // an address whose owner is about to be sent nothing.
      context.commenters.declare(email, displayName);

      // The language of the request, not a stored one: the code is read within
      // minutes, in the tab that asked for it.
      context.mailer.queue(
        buildVerificationMail(
          email,
          displayName,
          minted.code,
          request.locale,
          context.settings.instanceName,
          context.env,
        ),
      );
      request.log.info(`Verification code sent to an address from "${request.user!.username}"`);

      return reply.code(202).send({ ok: true });
    });

    /**
     * Validates the code and attaches the identity to the session. This is the only
     * place linking the two: an unverified identity is attached to nothing.
     */
    app.post('/verify', { preHandler: rejectBoundIdentity }, async (request, reply) => {
      const parsed = verifySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.invalidCode') });
      }

      const { email, code } = parsed.data;
      const checked = context.codes.check(email, 'identity', code);
      if ('failure' in checked) {
        // Incorrect, expired and exhausted codes return the same message: identifying
        // which case occurred mainly helps someone trying random codes.
        const message = request.t(
          checked.failure === 'too_many_attempts'
            ? 'error.codeAttemptsExhausted'
            : 'error.codeWrongOrExpired',
        );
        return reply.code(400).send({ error: checked.failure, message });
      }

      // Verification and consumption in one transaction: a replayed code must not
      // revalidate an address whose access was revoked in the meantime, and an
      // identity that failed to be written must leave its code unspent.
      const commenter = context.db.transaction(() => {
        const verified = context.commenters.markVerified(email);
        if (verified) context.codes.consume(email, 'identity');
        return verified;
      })();

      // The code was valid but its identity has gone: the same answer as a code
      // nothing knows, which is what it has become.
      if (!commenter) {
        return reply
          .code(400)
          .send({ error: 'unknown', message: request.t('error.codeWrongOrExpired') });
      }

      context.sessions.attachCommenter(request.sessionId!, commenter.id);

      if (request.share !== null && commenter.email !== null) {
        context.config.ensureUserForCommenter(
          commenter.id,
          commenter.email,
          commenter.displayName,
          request.share.token,
        );
        context.shares.recordSubscriber(commenter.id, request.share.token);
        if (request.share.mediaId === null) {
          for (const albumId of context.shares.findAlbumIds(request.share.token)) {
            context.subscriptions.subscribe(commenter.id, albumId);
          }
        }
      }

      return reply.send(sessionUser(request.user!.username, request.user!.admin, commenter.id));
    });

    /**
     * Forgets the identity in this session. Existing comments remain, signed with the
     * name used at publication: they belong to the conversation, not the device.
     * Identifying oneself again with the same address finds them again, together with
     * the right to delete them.
     */
    app.post('/forget', { preHandler: rejectBoundIdentity }, async (request, reply) => {
      context.sessions.attachCommenter(request.sessionId!, null);
      const fallbackCommenterId =
        request.user?.username != null
          ? (context.config.user(request.user.username)?.commenterId ?? null)
          : null;
      return reply.send(
        sessionUser(request.user!.username, request.user!.admin, fallbackCommenterId),
      );
    });
  };
}
