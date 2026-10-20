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

    const accountCommenterId =
      account !== null
        ? (account.commenterId ?? context.config.ensureUserCommenter(account.username))
        : null;
    const accountCommenter =
      accountCommenterId === null ? null : context.commenters.byId(accountCommenterId);
    const hasBoundEmail =
      accountCommenter !== null &&
      accountCommenter.email !== null &&
      accountCommenter.verifiedAt !== null;

    let commenter = accountCommenter;
    if (!hasBoundEmail && session.commenterId !== null) {
      const sessionCommenter = context.commenters.byId(session.commenterId);
      if (!sessionCommenter) {
        context.sessions.attachCommenter(session.id, null);
      } else {
        commenter = sessionCommenter;
      }
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

    const canComment =
      account !== null
        ? account.admin || account.roleCommenter || session.commenterId !== null
        : (share?.allowComments ?? false) && commenter !== null;

    request.sessionId = session.id;
    request.share = share;
    request.commenterId = commenter?.id ?? null;
    request.user = {
      // A link reports no access key, and `admin` is false: what the shape carries is
      // adjusted, never extended, so the front end branches on this response alone.
      username: account?.username ?? null,
      displayName: account?.displayName || commenter?.displayName || account?.username || '',
      admin: account?.admin ?? false,
      roleViewer: account ? account.admin || account.roleViewer : true,
      roleCommenter: account
        ? account.admin || account.roleCommenter
        : (share?.allowComments ?? false),
      email: commenter?.email ?? null,
      hasPassword: account ? account.passwordHash !== '' : false,
      notifyPhotos: commenter?.notifyPhotos ?? true,
      notifyComments: commenter?.notifyComments ?? true,
      identity: commenter && canComment ? toIdentity(commenter) : null,
      identityBound: hasBoundEmail,
      commentsEnabled:
        context.mailer.enabled || (account !== null && (account.admin || account.roleCommenter)),
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
