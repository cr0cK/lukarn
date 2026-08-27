import {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  USER_CODE_LENGTH,
  VERIFICATION_CODE_LENGTH,
  normalizeUserCode,
  type Locale,
  type SessionUser,
} from '@lukarn/shared';
import argon2 from 'argon2';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { toIdentity } from '../commenters.js';
import type { StoredUser } from '../config-repo.js';
import type { AppContext } from '../context.js';
import type { Translate } from '../i18n/index.js';
import { classifyDevice } from '../device.js';
import { buildInvitationMail, buildSignInMail } from '../mail.js';
import { requireAccount } from '../plugins/auth.js';
import { SESSION_COOKIE, sessionCookieOptions, type SessionRecord } from '../sessions.js';
import type { CodePurpose } from '../verification-codes.js';

/**
 * Disposable hash compared when no user matches the supplied login. Without it, an
 * unknown login would respond much faster than an incorrect password, allowing
 * accounts to be enumerated with a stopwatch.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$P7YCCBMU6F1LYwExogSfjg$aGZdlIPlbgzTX9FhZKWXQp0G86Yl6A4MuXfFmVgZ868';

/**
 * The username is folded first: `USERNAME_PATTERN` allows no spaces, so no account
 * contains one, and leading or trailing whitespace only comes from a mobile keyboard
 * or copy and paste. Rejecting it would fail correct input without being able to say
 * why — the message must remain the same as for an incorrect password. The password
 * is untouched because it may contain spaces.
 */
const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(512),
});

/** `deviceCode` is 43 base64url characters; the limit leaves some margin. */
const pollSchema = z.object({ deviceCode: z.string().min(1).max(128) });

const codeRequestSchema = z.object({
  email: z.string().trim().email().max(EMAIL_MAX_LENGTH),
});

const codeVerifySchema = z.object({
  email: z.string().trim().email().max(EMAIL_MAX_LENGTH),
  code: z.string().trim().length(VERIFICATION_CODE_LENGTH),
  /**
   * Bounded but not required to be non-empty: a field left blank means "no name
   * given", and rejecting it would answer a form error where the route has a precise
   * answer of its own.
   */
  displayName: z.string().trim().max(DISPLAY_NAME_MAX_LENGTH).optional(),
});

/**
 * Rollback signal for a valid code whose invitation still needs a name.
 *
 * Thrown rather than returned because `better-sqlite3` commits a transaction whose
 * function returns, and this is the one outcome that must leave the database exactly
 * as it found it — see `/code/verify` for why the attempt must not be counted.
 */
class DisplayNameRequired extends Error {}

/**
 * What a checked code turned out to be. `refused` covers unknown, mismatched, expired
 * and exhausted alike: the route answers them with one body.
 */
type CodeOutcome =
  | { kind: 'refused' }
  | { kind: 'signedIn'; username: string; session: SessionRecord }
  | { kind: 'invited'; username: string; locale: Locale | null };

/** The displayed code after folding: eight characters from the unambiguous alphabet. */
const USER_CODE_PATTERN = new RegExp(`^[A-HJ-NP-Z2-9]{${USER_CODE_LENGTH}}$`);

export function createAuthRoutes(context: AppContext): FastifyPluginAsync {
  const throttle = context.throttle;

  /**
   * The session as `/auth/me` would return it for an account that has just opened one.
   *
   * The identity comes from the account, which is where a bound one lives. A shared
   * key carries none, exactly as before: the living-room television must not sign with
   * the approver's name. On a bound account the account **is** the person, so it
   * follows by construction — and approving a screen from one delegates the ability to
   * sign as you.
   */
  const sessionUser = (user: StoredUser): SessionUser => {
    const identity = user.commenterId === null ? null : context.commenters.byId(user.commenterId);
    return {
      username: user.username,
      admin: user.admin,
      identity: identity ? toIdentity(identity) : null,
      identityBound: user.commenterId !== null,
      commentsEnabled: context.mailer.enabled,
    };
  };

  return async (app) => {
    app.post('/login', async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.credentialsRequired') });
      }

      const { username, password } = parsed.data;
      const attempt = { ip: request.ip, username };

      const retryAfter = throttle.blockedFor(attempt);
      if (retryAfter > 0) {
        return reply
          .code(429)
          .header('Retry-After', String(Math.ceil(retryAfter / 1000)))
          .send({
            error: 'too_many_attempts',
            message: request.t('error.tooManyAttempts', Math.ceil(retryAfter / 1000)),
          });
      }

      const user = context.config.user(username);
      let valid = false;
      try {
        valid = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, password);
      } catch {
        // An unreadable database hash is treated as a failure, not a 500.
        valid = false;
      }

      if (!user || !valid) {
        throttle.fail(attempt);
        request.log.warn({ username, ip: request.ip }, 'Login failure');
        return reply.code(401).send({
          error: 'invalid_credentials',
          message: request.t('error.badCredentials'),
        });
      }

      throttle.succeed(attempt);
      // The device class is read here and nowhere else: the user-agent is used to infer
      // it and then discarded, with only the class stored (D260809h).
      const session = context.sessions.create(
        user.username,
        classifyDevice(request.headers['user-agent']),
      );

      return reply
        .setCookie(
          SESSION_COOKIE,
          session.id,
          sessionCookieOptions(context.env.publicUrl, context.sessions.ttlMs),
        )
        .send({
          username: user.username,
          admin: user.admin,
          // A fresh sign-in carries no identity: it is declared afterwards and belongs
          // to the person, not the access key.
          identity: null,
          // A password sign-in is a shared key by construction: a bound account holds
          // the reserved hash, which `argon2.verify` refuses like any wrong password.
          identityBound: false,
          commentsEnabled: context.mailer.enabled,
        } satisfies SessionUser);
    });

    app.post('/logout', async (request, reply) => {
      if (request.sessionId) context.sessions.destroy(request.sessionId);
      return reply.clearCookie(SESSION_COOKIE, { path: '/' }).send({ ok: true });
    });

    app.get('/me', async (request, reply) => {
      if (!request.user) {
        return reply
          .code(401)
          .send({ error: 'unauthorized', message: request.t('error.notSignedIn') });
      }
      return reply.send(request.user);
    });

    /**
     * An installation whose database contains no account accepts requests but refuses
     * every sign-in: the application appears broken when only `pnpm create-admin` is
     * missing. The sole clue used to be a log line nobody reads before a problem occurs.
     *
     * Public route: an instance with no accounts has nothing to protect, and the
     * sign-in screen must be able to say so before any input is entered.
     */
    app.get('/setup-state', async (_request, reply) =>
      reply.send({ needsSetup: context.config.users().length === 0 }),
    );

    /* ------------------------------------------------------------------------
     * Signing in with a code sent to an address
     *
     * A bound account holds no password: it is entered with six digits sent to the
     * address it is bound to, and an invitation is taken up the same way. Both routes
     * are public — nobody signing in has a session yet — and both therefore say **one
     * thing and one thing only** about the address they are given.
     * --------------------------------------------------------------------- */

    /**
     * Sends a code, or does not, and answers the same either way.
     *
     * `202` covers an address that opens an account, one with an invitation waiting,
     * one nothing here knows, and one asked again inside the minute. Two rapid requests
     * would otherwise be a test for "does this address open an account here".
     *
     * An expired invitation is deliberately not remade: once the purge has taken the
     * row, nothing anywhere still connects that address to that account, and inviting
     * it again is the administrator's to do.
     */
    app.post('/code/request', async (request, reply) => {
      const blocked = blockedReply(reply, throttle.blockedForIp(request.ip), request.t);
      if (blocked) return blocked;

      // Counted here, before anything is decided, and whatever gets decided. The `ip`
      // axis is shared with `/auth/login`, so an attacker walks it to one below its
      // threshold with failed sign-ins and then sends a single request for a candidate
      // address: if the counter moved, the address was known. The uniform `202` closes
      // the answer channel, and a counter that depended on the answer — counting only
      // what was actually sent, the version that looks careful — reopens it one call
      // later. It still bounds mail-bombing across a thousand addresses, since a
      // thousand calls trip the axis whether or not anybody exists behind them.
      throttle.countCall(request.ip);

      if (!context.mailer.enabled) {
        // A property of the instance rather than of the address: it says nothing about
        // who has an account here, and the alternative is `202` followed by somebody
        // waiting for an email that was never going to be sent.
        return reply.code(503).send({
          error: 'mail_not_configured',
          message: request.t('error.mailNotConfigured'),
        });
      }

      const parsed = codeRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.invalidEmail') });
      }

      const { email } = parsed.data;
      const account = context.config.userForEmail(email);
      const identity =
        account?.commenterId == null ? null : context.commenters.byId(account.commenterId);

      if (identity) {
        const minted = context.codes.mint(email, 'signin');
        if ('code' in minted) {
          // The recorded language, not this request's: the person signing in has made
          // requests here before, and that is what recording it was for (D260812d).
          context.mailer.queue(
            buildSignInMail(
              identity.email,
              identity.displayName,
              minted.code,
              identity.locale ?? context.env.defaultLocale,
              context.settings.instanceName,
              context.env,
            ),
          );
          request.log.info('Sign-in code sent to a bound account');
        }
        return reply.code(202).send({ ok: true });
      }

      // An invited address opens no account yet, so a rule phrased around "the address
      // opens an account" would answer `202` and send nothing — which is exactly what
      // somebody presses when the code from their invitation has run out.
      const pending = context.codes.find(email, 'invite');
      if (pending) {
        const minted = context.codes.mint(pending.target, 'invite', {
          username: pending.username!,
          locale: pending.locale,
        });
        if ('code' in minted) {
          // The language the row carries, which is the one whoever invited chose. The
          // recipient has still made no request here to have a language recorded, so
          // without that choice the instance default applies (D260812d) — and a code
          // asked for again must reach the inbox in the language of the message it
          // replaces.
          context.mailer.queue(
            buildInvitationMail(
              pending.target,
              minted.code,
              pending.locale ?? context.env.defaultLocale,
              context.settings.instanceName,
              context.env,
            ),
          );
          request.log.info('Invitation sent again');
        }
      }

      return reply.code(202).send({ ok: true });
    });

    /**
     * Spends a code and opens the session, writing the binding when what was spent was
     * an invitation.
     *
     * Unknown, mismatched, expired and exhausted get **one** refusal between them. The
     * argument `specs/04-security-and-access.md` makes for `/identity/verify` telling
     * its four apart is that it sits behind `requireAuth`, and that argument does not
     * survive the move to a route anybody can call.
     */
    app.post('/code/verify', async (request, reply) => {
      const parsed = codeVerifySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.invalidCode') });
      }

      const { email, code } = parsed.data;
      // An empty field means "no name given" rather than a name of no characters.
      const displayName = parsed.data.displayName || undefined;
      // The address stands in for the username on all three axes, the way pairing puts
      // its `deviceCode` there: there is no fourth counter to add.
      const attempt = { ip: request.ip, username: email };
      const blocked = blockedReply(reply, throttle.blockedFor(attempt), request.t);
      if (blocked) return blocked;

      // Which of the two this is depends on the address and not on the caller. Purpose
      // is part of the key, so a sign-in code is not merely refused by the invitation
      // path — it is not found by it.
      const account = context.config.userForEmail(email);
      const purpose: CodePurpose = account ? 'signin' : 'invite';
      const device = classifyDevice(request.headers['user-agent']);

      let outcome: CodeOutcome;
      try {
        outcome = context.db.transaction((): CodeOutcome => {
          const checked = context.codes.check(email, purpose, code);
          if ('failure' in checked) return { kind: 'refused' };

          if (account) {
            context.codes.consume(email, purpose);
            return {
              kind: 'signedIn',
              username: account.username,
              session: context.sessions.create(account.username, device),
            };
          }

          // The account comes from the **checked row**, never from anything the caller
          // sent: `consumeInvitation` trusts the username it is given, and a request
          // able to name the account it is binding would hand away every account here.
          const username = checked.row.username!;

          // A row nobody has verified carries a name anybody behind a shared key could
          // have chosen, so it counts as unknown and its owner is asked for their own.
          //
          // This condition is `consumeInvitation`'s own, asked one step earlier on
          // purpose: that method **throws** when it is met, so deciding here is what
          // keeps an answer the screen is expected to receive from arriving as a 500.
          const known = context.commenters.byEmail(email);
          if (!displayName && (!known || known.verifiedAt === null)) {
            // `check()` counted the attempt before comparing, on purpose: abandoning
            // midway must buy no free tries. A valid submission that is merely
            // incomplete is not an attempt, though — a correct code arriving fifth
            // would otherwise answer `display_name_required` and be exhausted by the
            // time the name came back. Throwing rolls the transaction back, which is
            // how the count is undone without this route writing that table itself.
            // The answer stays behind a valid comparison, so it never becomes a way to
            // ask whether an address has an invitation waiting.
            throw new DisplayNameRequired();
          }
          // The language of the message that brought this person here, carried out of
          // the row rather than read from the request: it is what the identity is
          // seeded with, and the browser's own header replaces it on the very next
          // request (D260812d).
          return { kind: 'invited', username, locale: checked.row.locale };
        })();
      } catch (error) {
        if (error instanceof DisplayNameRequired) {
          return reply.code(400).send({
            error: 'display_name_required',
            message: request.t('error.displayNameRequired'),
          });
        }
        throw error;
      }

      if (outcome.kind === 'refused') {
        throttle.fail(attempt);
        return reply
          .code(400)
          .send({ error: 'invalid_code', message: request.t('error.codeWrongOrExpired') });
      }

      throttle.succeed(attempt);

      let session: SessionRecord;
      if (outcome.kind === 'signedIn') {
        session = outcome.session;
      } else {
        // Consumption first, the session after, and never the other way round: what
        // `consumeInvitation` closes is every session this account already had, and a
        // session opened before it would be signed straight back out. The name is
        // passed on this path alone — on any other it would rename an existing
        // identity, which is the rule `pending_display_name` exists for.
        let user: StoredUser;
        try {
          user = context.config.consumeInvitation(
            { username: outcome.username, email, displayName, locale: outcome.locale },
            context.codes,
          );
        } catch (error) {
          // The identity was bound to another account between this invitation being
          // sent and its code being typed. `users.commenter_id` is unique, so the
          // UPDATE was refused, the whole transaction rolled back and the code is
          // correctly still unspent — but what arrives here is a SQLite exception
          // rather than a refusal. It is translated into the same `409` an
          // administrator meets when they can see the collision coming, so a race
          // and a foreseeable clash answer alike.
          //
          // Matched on the column by name rather than by catching everything: an
          // unrelated failure swallowed here would report a binding that never
          // happened. If the account holding the address cannot then be named, the
          // diagnosis did not hold up and the error keeps travelling.
          const holder = boundElsewhere(error) ? context.config.userForEmail(email) : undefined;
          if (!holder) throw error;
          return reply.code(409).send({
            error: 'identity_taken',
            message: request.t('error.identityTaken', holder.username),
          });
        }
        request.log.info({ username: user.username }, 'Invitation taken up');
        session = context.sessions.create(user.username, device);
      }

      return reply
        .setCookie(
          SESSION_COOKIE,
          session.id,
          sessionCookieOptions(context.env.publicUrl, context.sessions.ttlMs),
        )
        .send(sessionUser(context.config.user(session.username!)!));
    });

    /* ------------------------------------------------------------------------
     * Pairing a keyboardless screen (D260809c)
     *
     * A television has no camera: it displays the QR code, which an already signed-in
     * phone scans. Pairing therefore delegates existing access; it creates none.
     * --------------------------------------------------------------------- */

    /**
     * Opens a request. It is public by necessity: this is the first action of a screen
     * without a session. It reveals nothing — a random code and a secret received only
     * by its intended recipient.
     */
    app.post('/device/start', async (request, reply) => {
      const started = context.pairings.start();
      if (!started) {
        // The limit has been reached: the table lives in the database, and a burst of
        // requests must not make it grow without bound. Nobody gains access; pairing
        // merely becomes unavailable until current requests expire.
        return reply
          .code(429)
          .header('Retry-After', '60')
          .send({
            error: 'too_many_pairings',
            message: request.t('error.tooManyPairings'),
          });
      }
      return noStore(reply).send(started);
    });

    /**
     * The screen's poll. POST rather than GET: the response sets a cookie, and the
     * `deviceCode` must not appear in a URL retained by access logs, history and
     * `Referer`.
     */
    app.post('/device/poll', async (request, reply) => {
      const parsed = pollSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.deviceCodeRequired') });
      }

      const { deviceCode } = parsed.data;
      const attempt = { ip: request.ip, username: deviceCode };
      const blocked = blockedReply(reply, throttle.blockedFor(attempt), request.t);
      if (blocked) return blocked;

      const claimed = context.pairings.claim(deviceCode);
      if (claimed.status === 'pending') {
        return noStore(reply).code(202).send({ status: 'pending' });
      }
      if (claimed.status === 'unknown') {
        throttle.fail(attempt);
        return noStore(reply).code(404).send(unknownCode(request.t));
      }

      // Configuration is authoritative, as for every session: an account deleted
      // between approval and claiming opens nothing. The `ON DELETE CASCADE` foreign
      // key already covers that case; this check covers an account missing otherwise.
      const user = context.config.user(claimed.username);
      if (!user) {
        throttle.fail(attempt);
        return noStore(reply).code(404).send(unknownCode(request.t));
      }

      throttle.succeed(attempt);
      // The user-agent belongs to the polling screen, not the phone that approved:
      // the television is the device that should be counted as such.
      const session = context.sessions.create(
        user.username,
        classifyDevice(request.headers['user-agent']),
      );
      request.log.info({ username: user.username }, 'Screen paired');

      return noStore(reply)
        .setCookie(
          SESSION_COOKIE,
          session.id,
          sessionCookieOptions(context.env.publicUrl, context.sessions.ttlMs),
        )
        .send({
          status: 'approved',
          user: sessionUser(user),
        });
    });

    /** What the phone displays before approval. */
    app.get<{ Params: { userCode: string } }>(
      '/device/:userCode',
      // An **account**, never a share link. Pairing delegates existing access, and a
      // link has none to delegate: `approve` would write its null username into
      // `device_pairings` and consume somebody's pending request for nothing.
      { preHandler: requireAccount },
      async (request, reply) => {
        const userCode = normalizeUserCode(request.params.userCode);
        const attempt = { ip: request.ip, username: userCode };
        const blocked = blockedReply(reply, throttle.blockedFor(attempt), request.t);
        if (blocked) return blocked;

        const pairing = USER_CODE_PATTERN.test(userCode) ? context.pairings.find(userCode) : null;
        if (!pairing) {
          throttle.fail(attempt);
          return noStore(reply).code(404).send(unknownCode(request.t));
        }

        return noStore(reply).send({
          userCode: pairing.userCode,
          expiresAt: pairing.expiresAt,
          // An already approved request is not an error: this makes it possible to say
          // "done" to someone reopening the page rather than "this code does not exist".
          approved: pairing.username !== null,
        });
      },
    );

    /**
     * Approval. It records who approves and nothing more: polling creates the session,
     * otherwise a screen switched off in the meantime would leave behind a year-long
     * session nobody opened.
     */
    app.post<{ Params: { userCode: string } }>(
      '/device/:userCode/approve',
      { preHandler: requireAccount },
      async (request, reply) => {
        const userCode = normalizeUserCode(request.params.userCode);
        const attempt = { ip: request.ip, username: userCode };
        const blocked = blockedReply(reply, throttle.blockedFor(attempt), request.t);
        if (blocked) return blocked;

        const result = USER_CODE_PATTERN.test(userCode)
          ? context.pairings.approve(userCode, request.user!.username!)
          : 'unknown';

        if (result === 'unknown') {
          throttle.fail(attempt);
          return noStore(reply).code(404).send(unknownCode(request.t));
        }
        if (result === 'taken') {
          // 409 rather than 404: refusal concerns the request state, not the existence
          // of someone else's resource that must be hidden — the approver has the code
          // in front of them.
          return noStore(reply)
            .code(409)
            .send({
              error: 'already_paired',
              message: request.t('error.alreadyPaired'),
            });
        }

        throttle.succeed(attempt);
        return noStore(reply).send({ ok: true });
      },
    );
  };
}

/**
 * Whether this is the unique index over `users.commenter_id` refusing a second
 * account for one person.
 *
 * Narrow on purpose, on the code **and** the column: every other constraint failure
 * has to keep travelling rather than be reported as somebody else's binding.
 * `better-sqlite3` names the column rather than the index in the message, which is
 * why this reads `users.commenter_id` and not `idx_users_commenter`.
 */
function boundElsewhere(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    error.message.includes('users.commenter_id')
  );
}

/**
 * Shared response for an unknown, expired, already claimed or malformed code.
 * Distinguishing these cases would tell someone trying random codes which ones existed.
 */
function unknownCode(t: Translate): { error: string; message: string } {
  return { error: 'unknown_code', message: t('error.unknownCode') };
}

/**
 * No pairing response may be retained: each carries a secret, state that changes
 * every two seconds, or a session cookie.
 */
function noStore(reply: FastifyReply): FastifyReply {
  return reply.header('Cache-Control', 'no-store');
}

/** The throttle's 429, or `null` when the attempt may proceed. */
function blockedReply(
  reply: FastifyReply,
  retryAfterMs: number,
  t: Translate,
): FastifyReply | null {
  if (retryAfterMs <= 0) return null;
  const seconds = Math.ceil(retryAfterMs / 1000);
  return reply
    .code(429)
    .header('Retry-After', String(seconds))
    .send({ error: 'too_many_attempts', message: t('error.tooManyAttempts', seconds) });
}
