import type { SessionUser } from '@lukarn/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { toIdentity } from '../commenters.js';
import type { StoredUser } from '../config-repo.js';
import type { AppContext } from '../context.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../sessions.js';
import { shareState, type ShareLink } from '../shares.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The session behind this request, or `null` for an anonymous one.
     *
     * `user.username` is `null` when a share link opened the session: a link is a
     * credential and not a person, so there is no access key to report (D260825).
     * Anything that means "the account behind this request" says so by going
     * through `requireAccount`.
     */
    user: SessionUser | null;
    /**
     * The share link that opened this session, `null` for every other request.
     *
     * The link is asked what it covers; `ConfigRepo.canSee` is never asked about it
     * and is not taught that links exist.
     */
    share: ShareLink | null;
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
  app.decorateRequest('share', null);
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

    // A link's session, resolved beside an account rather than on a parallel hook:
    // everything below — identity, language, renewal — applies to it unchanged,
    // which is what keeps the comment stack working through a link (D260825).
    let share: ShareLink | null = null;
    let account: StoredUser | null = null;

    if (session.shareToken !== null) {
      const link = context.shares.find(session.shareToken);
      // Revoking already deletes the sessions a link opened, so reaching this is a
      // link that expired while a browser was open. Destroying the session is the
      // same treatment a deleted account gets: the credential stopped working.
      if (!link || shareState(link) !== 'live') {
        context.sessions.destroy(session.id);
        return;
      }
      share = link;
    } else {
      // Database configuration is authoritative: an account deleted from /admin loses
      // access immediately even if its session has not expired. The read uses the
      // repository's memory cache, not SQLite.
      const configured = context.config.user(session.username!);
      if (!configured) {
        context.sessions.destroy(session.id);
        return;
      }
      account = configured;
    }

    // Identity is reread on every request rather than fixed at sign-in: an address
    // deleted from another device must revoke commenting without waiting for another
    // sign-in — the session lasts a year.
    //
    // It comes from the **account** when that account is bound, and from the session
    // otherwise. `users.commenter_id` is written only when a code is consumed, so a
    // bound identity is always a verified one: the rule that an unverified identity
    // is attached to no session holds here without a check of its own.
    //
    // A link has no account to bind, so its session's own identity is the only one:
    // the same rule read through `account` being null.
    const bound = account?.commenterId ?? null;
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
    request.share = share;
    request.commenterId = commenter?.id ?? null;
    request.user = {
      // A link reports no access key, and `admin` is false: what the shape carries is
      // adjusted, never extended, so the front end branches on this response alone.
      username: account?.username ?? null,
      admin: account?.admin ?? false,
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

/**
 * Requires an **account**, refusing a session a share link opened.
 *
 * Every route keyed on an album identifier wears this: a link is not asked what it
 * covers there, and letting it through would need a second predicate beside
 * `ConfigRepo.canSee` — which is how one of the two gets updated alone (D260825).
 * What a link may reach lives under `/api/share`, and the `/media` prefix, where the
 * link is read beside the account at one `preHandler`.
 *
 * The refusal is a **404**, not a 403: only `/api/admin/*` and the standing
 * `identity_required` answer 403, and everything else says nothing about what exists
 * (D12).
 */
export async function requireAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    await reply.code(401).send({ error: 'unauthorized', message: request.t('error.authRequired') });
    return;
  }
  if (request.user.username === null) {
    await reply.code(404).send({ error: 'not_found', message: request.t('error.notFound') });
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
