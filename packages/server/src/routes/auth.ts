import { USER_CODE_LENGTH, normalizeUserCode } from '@nonni/shared';
import argon2 from 'argon2';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { classifyDevice } from '../device.js';
import { requireAuth } from '../plugins/auth.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../sessions.js';

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

/** The displayed code after folding: eight characters from the unambiguous alphabet. */
const USER_CODE_PATTERN = new RegExp(`^[A-HJ-NP-Z2-9]{${USER_CODE_LENGTH}}$`);

export function createAuthRoutes(context: AppContext): FastifyPluginAsync {
  const throttle = context.throttle;

  return async (app) => {
    app.post('/login', async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'Username and password required' });
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
            message: `Too many attempts. Try again in ${Math.ceil(retryAfter / 1000)} s.`,
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
        return reply
          .code(401)
          .send({ error: 'invalid_credentials', message: 'Incorrect username or password' });
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
          commentsEnabled: context.mailer.enabled,
        });
    });

    app.post('/logout', async (request, reply) => {
      if (request.sessionId) context.sessions.destroy(request.sessionId);
      return reply.clearCookie(SESSION_COOKIE, { path: '/' }).send({ ok: true });
    });

    app.get('/me', async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'unauthorized', message: 'Not signed in' });
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
    app.post('/device/start', async (_request, reply) => {
      const started = context.pairings.start();
      if (!started) {
        // The limit has been reached: the table lives in the database, and a burst of
        // requests must not make it grow without bound. Nobody gains access; pairing
        // merely becomes unavailable until current requests expire.
        return reply.code(429).header('Retry-After', '60').send({
          error: 'too_many_pairings',
          message: 'Too many requests in flight. Try again in a minute.',
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
        return reply.code(400).send({ error: 'bad_request', message: 'Device code required' });
      }

      const { deviceCode } = parsed.data;
      const attempt = { ip: request.ip, username: deviceCode };
      const blocked = blockedReply(reply, throttle.blockedFor(attempt));
      if (blocked) return blocked;

      const claimed = context.pairings.claim(deviceCode);
      if (claimed.status === 'pending') {
        return noStore(reply).code(202).send({ status: 'pending' });
      }
      if (claimed.status === 'unknown') {
        throttle.fail(attempt);
        return noStore(reply).code(404).send(UNKNOWN_CODE);
      }

      // Configuration is authoritative, as for every session: an account deleted
      // between approval and claiming opens nothing. The `ON DELETE CASCADE` foreign
      // key already covers that case; this check covers an account missing otherwise.
      const user = context.config.user(claimed.username);
      if (!user) {
        throttle.fail(attempt);
        return noStore(reply).code(404).send(UNKNOWN_CODE);
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
          user: {
            username: user.username,
            admin: user.admin,
            // The paired screen arrives without an identity, as after password sign-in:
            // identity belongs to the person, not the access key. Without this rule,
            // the living-room television would sign with the approver's name.
            identity: null,
            commentsEnabled: context.mailer.enabled,
          },
        });
    });

    /** What the phone displays before approval. */
    app.get<{ Params: { userCode: string } }>(
      '/device/:userCode',
      { preHandler: requireAuth },
      async (request, reply) => {
        const userCode = normalizeUserCode(request.params.userCode);
        const attempt = { ip: request.ip, username: userCode };
        const blocked = blockedReply(reply, throttle.blockedFor(attempt));
        if (blocked) return blocked;

        const pairing = USER_CODE_PATTERN.test(userCode) ? context.pairings.find(userCode) : null;
        if (!pairing) {
          throttle.fail(attempt);
          return noStore(reply).code(404).send(UNKNOWN_CODE);
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
      { preHandler: requireAuth },
      async (request, reply) => {
        const userCode = normalizeUserCode(request.params.userCode);
        const attempt = { ip: request.ip, username: userCode };
        const blocked = blockedReply(reply, throttle.blockedFor(attempt));
        if (blocked) return blocked;

        const result = USER_CODE_PATTERN.test(userCode)
          ? context.pairings.approve(userCode, request.user!.username)
          : 'unknown';

        if (result === 'unknown') {
          throttle.fail(attempt);
          return noStore(reply).code(404).send(UNKNOWN_CODE);
        }
        if (result === 'taken') {
          // 409 rather than 404: refusal concerns the request state, not the existence
          // of someone else's resource that must be hidden — the approver has the code
          // in front of them.
          return noStore(reply).code(409).send({
            error: 'already_paired',
            message: 'This screen has already been paired by another account.',
          });
        }

        throttle.succeed(attempt);
        return noStore(reply).send({ ok: true });
      },
    );
  };
}

/**
 * Shared response for an unknown, expired, already claimed or malformed code.
 * Distinguishing these cases would tell someone trying random codes which ones existed.
 */
const UNKNOWN_CODE = {
  error: 'unknown_code',
  message: 'That code is no longer valid. Start the sign-in again from the screen.',
};

/**
 * No pairing response may be retained: each carries a secret, state that changes
 * every two seconds, or a session cookie.
 */
function noStore(reply: FastifyReply): FastifyReply {
  return reply.header('Cache-Control', 'no-store');
}

/** The throttle's 429, or `null` when the attempt may proceed. */
function blockedReply(reply: FastifyReply, retryAfterMs: number): FastifyReply | null {
  if (retryAfterMs <= 0) return null;
  const seconds = Math.ceil(retryAfterMs / 1000);
  return reply
    .code(429)
    .header('Retry-After', String(seconds))
    .send({
      error: 'too_many_attempts',
      message: `Too many attempts. Try again in ${seconds} s.`,
    });
}
