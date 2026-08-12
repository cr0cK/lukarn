import type { SessionUser } from '@nonni/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { toIdentity } from '../commenters.js';
import type { AppContext } from '../context.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Authenticated access key, or `null` for an anonymous request. */
    user: SessionUser | null;
    sessionId: string | null;
    /**
     * Commenter identity carried by the session, `null` if nobody has identified
     * themselves. Distinct from `user`: one username may be shared, while each person
     * signs with their own name.
     */
    commenterId: number | null;
  }
}

/**
 * Resolves the session on every request. Rejects nothing: the `preHandler`s below
 * decide whether a route allows anonymity.
 */
const authPlugin: FastifyPluginAsync<{ context: AppContext }> = async (app, { context }) => {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);
  app.decorateRequest('commenterId', null);

  app.addHook('onRequest', async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;

    // Signed cookie: a tampered value is rejected before touching the database.
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;

    const session = context.sessions.get(unsigned.value);
    if (!session) return;

    // Database configuration is authoritative: an account deleted from /admin loses
    // access immediately even if its session has not expired. The read uses the
    // repository's memory cache, not SQLite.
    const configured = context.config.user(session.username);
    if (!configured) {
      context.sessions.destroy(session.id);
      return;
    }

    // Identity is reread on every request rather than fixed at sign-in: an address
    // deleted from another device must revoke commenting without waiting for another
    // sign-in — the session lasts a year.
    const commenter =
      session.commenterId === null ? null : context.commenters.byId(session.commenterId);
    // Identity deleted meanwhile: detach it rather than retaining an identifier that
    // no longer identifies anything.
    if (session.commenterId !== null && !commenter) {
      context.sessions.attachCommenter(session.id, null);
    }

    // The database just extended expiry, so the cookie must follow. It carries its own
    // expiry date applied by the browser without database knowledge — without reissuing,
    // an active visitor would be signed out a year after sign-in and renewal would only
    // grow `sessions`.
    if (session.renewed) {
      void reply.setCookie(
        SESSION_COOKIE,
        session.id,
        sessionCookieOptions(context.env.publicUrl, context.sessions.ttlMs),
      );
    }

    request.sessionId = session.id;
    request.commenterId = commenter?.id ?? null;
    request.user = {
      username: configured.username,
      admin: configured.admin,
      identity: commenter ? toIdentity(commenter) : null,
      commentsEnabled: context.mailer.enabled,
    };
  });
};

export default fp(authPlugin, { name: 'auth', dependencies: ['@fastify/cookie'] });

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    await reply.code(401).send({ error: 'unauthorized', message: 'Authentication required' });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    await reply.code(401).send({ error: 'unauthorized', message: 'Authentication required' });
    return;
  }
  if (!request.user.admin) {
    await reply.code(403).send({ error: 'forbidden', message: 'Administrators only' });
  }
}
