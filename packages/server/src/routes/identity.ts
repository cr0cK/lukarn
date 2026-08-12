import { EMAIL_MAX_LENGTH, VERIFICATION_CODE_LENGTH, type SessionUser } from '@lukarn/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { toIdentity } from '../commenters.js';
import type { AppContext } from '../context.js';
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
      username: string,
      admin: boolean,
      commenterId: number | null,
    ): SessionUser => {
      const commenter = commenterId === null ? null : context.commenters.byId(commenterId);
      return {
        username,
        admin,
        identity: commenter ? toIdentity(commenter) : null,
        commentsEnabled: context.mailer.enabled,
      };
    };

    /**
     * Declares an address and sends the code. Always responds with `202`, whether the
     * address is already known or not: distinguishing the two would tell an attacker
     * which addresses have already commented on this instance.
     */
    app.post('/request-code', async (request, reply) => {
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
      const result = context.commenters.requestCode(email, displayName);

      if ('failure' in result) {
        const seconds = Math.ceil(result.retryAfterMs / 1000);
        return reply
          .code(429)
          .header('Retry-After', String(seconds))
          .send({
            error: 'too_soon',
            message: request.t('error.codeJustSent', seconds),
          });
      }

      // The language of the request, not a stored one: the code is read within
      // minutes, in the tab that asked for it.
      context.mailer.queue(
        buildVerificationMail(email, displayName, result.code, request.locale, context.env),
      );
      request.log.info(`Verification code sent to an address from "${request.user!.username}"`);

      return reply.code(202).send({ ok: true });
    });

    /**
     * Validates the code and attaches the identity to the session. This is the only
     * place linking the two: an unverified identity is attached to nothing.
     */
    app.post('/verify', async (request, reply) => {
      const parsed = verifySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.invalidCode') });
      }

      const result = context.commenters.verify(parsed.data.email, parsed.data.code);
      if ('failure' in result) {
        // Incorrect, expired and exhausted codes return the same message: identifying
        // which case occurred mainly helps someone trying random codes.
        const message = request.t(
          result.failure === 'too_many_attempts'
            ? 'error.codeAttemptsExhausted'
            : 'error.codeWrongOrExpired',
        );
        return reply.code(400).send({ error: result.failure, message });
      }

      context.sessions.attachCommenter(request.sessionId!, result.commenter.id);
      return reply.send(
        sessionUser(request.user!.username, request.user!.admin, result.commenter.id),
      );
    });

    /**
     * Forgets the identity in this session. Existing comments remain, signed with the
     * name used at publication: they belong to the conversation, not the device.
     * Identifying oneself again with the same address finds them again, together with
     * the right to delete them.
     */
    app.post('/forget', async (request, reply) => {
      context.sessions.attachCommenter(request.sessionId!, null);
      return reply.send(sessionUser(request.user!.username, request.user!.admin, null));
    });
  };
}
