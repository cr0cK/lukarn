import type { SessionUser } from '@lukarn/shared';
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
    //
    // It comes from the **account** when that account is bound, and from the session
    // otherwise. `users.commenter_id` is written only when a code is consumed, so a
    // bound identity is always a verified one: the rule that an unverified identity
    // is attached to no session holds here without a check of its own.
    const bound = configured.commenterId;
    const identityId = bound ?? session.commenterId;
    const commenter = identityId === null ? null : context.commenters.byId(identityId);
    // Identity deleted meanwhile: detach it rather than retaining an identifier that
    // no longer identifies anything. Only the session's own can dangle — deleting an
    // identity sets `users.commenter_id` back to NULL (ON DELETE SET NULL), so a
    // bound account has already stopped being that person by the time it is read.
    if (bound === null && session.commenterId !== null && !commenter) {
      context.sessions.attachCommenter(session.id, null);
    }

    // Records the language this person reads, for the emails composed hours later
    // in another process (D260812d). Guarded by the comparison: this hook runs on
    // every thumbnail request, and an unconditional UPDATE would put a write on
    // the critical path of a cold grid.
    //
    // **Only a request the application made itself says anything about language.**
    // `api/client.ts` announces the language the interface is displaying; a `<img>`
    // pointing at `/api/media` is issued by the browser with the browser's own
    // `Accept-Language`, which is a setting nobody revisited. Without this guard the
    // first row of thumbnails overwrites a language somebody chose, and an invitation
    // written in French is undone by the photographs it led to (D260819c).
    //
    // `Sec-Fetch-Dest` is the browser stating what it will do with the answer:
    // `empty` is `fetch()`, everything else is a subresource. A browser that does not
    // send it keeps the previous behaviour rather than losing the recording, which is
    // the safer way round: the language stays a guess there, as it was before.
    const destination = request.headers['sec-fetch-dest'];
    const fromTheApplication = destination === undefined || destination === 'empty';
    if (fromTheApplication && commenter && commenter.locale !== request.locale) {
      context.commenters.setLocale(commenter.id, request.locale);
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
      identityBound: bound !== null,
      commentsEnabled: context.mailer.enabled,
    };
  });
};

export default fp(authPlugin, { name: 'auth', dependencies: ['@fastify/cookie'] });

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    await reply.code(401).send({ error: 'unauthorized', message: request.t('error.authRequired') });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    await reply.code(401).send({ error: 'unauthorized', message: request.t('error.authRequired') });
    return;
  }
  if (!request.user.admin) {
    await reply.code(403).send({ error: 'forbidden', message: request.t('error.adminsOnly') });
  }
}
