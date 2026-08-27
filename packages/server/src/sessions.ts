import { randomBytes } from 'node:crypto';
import type { DeviceKind } from '@lukarn/shared';
import type { Db } from './db.js';

export const SESSION_COOKIE = 'lukarn_session';

/**
 * One year, extended along the way (see `get`). In practice, users are never signed
 * out while they continue to use the gallery.
 *
 * Why not omit expiry entirely: an eternal session is a permanent sign-in token —
 * stolen once, valid for life — and the table would grow with nothing to clean it.
 * An expiry extended on each visit provides the intended convenience while allowing
 * unused sessions to expire.
 *
 * Beware the terminology: an HTTP *session cookie*, without `maxAge`, dies when the
 * browser closes — exactly the opposite. The cookie set here is persistent, with
 * this `maxAge`.
 */
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Renewal threshold. Extending the expiry on every request would cost one SQLite
 * write per thumbnail; extending it only at mid-life reduces this to one write per
 * visitor every six months, for the same result.
 */
const RENEW_AFTER_MS = SESSION_TTL_MS / 2;

/**
 * Write cap for `last_seen_at`, following the reasoning for `RENEW_AFTER_MS` above:
 * without it, every thumbnail in a grid would trigger a SQLite UPDATE. At hourly
 * precision, the question this column answers — "was this key used this week?" —
 * has exactly the same answer.
 */
const SEEN_AFTER_MS = 60 * 60 * 1000;

export interface SessionRecord {
  id: string;
  /**
   * The access key this session belongs to, or `null` when a **share link** opened
   * it (D260825). Exactly one of this and `shareToken` is set, which the table
   * states as a CHECK rather than leaving to whoever writes a row next.
   */
  username: string | null;
  /** The link that opened this session, `null` for every session an account opened. */
  shareToken: string | null;
  expiresAt: string;
  /** Remembered commenter identity, `null` if nobody has identified themselves. */
  commenterId: number | null;
  /**
   * Last request received from this session, to the nearest hour. Feeds the "Visits"
   * tab: `created_at` only says "someone signed in once", never "someone visited
   * this week" (D260809h).
   */
  lastSeenAt: string | null;
  /**
   * True when this read has just extended the expiry. The caller must then reissue
   * the cookie: otherwise the extension would exist only in the database and the
   * browser would still discard its copy on the original date — even the most active
   * session would eventually be signed out after a year.
   */
  renewed: boolean;
}

/**
 * Session-cookie options shared by sign-in and renewal. If two sets of options
 * diverge, the cookie changes scope or `sameSite` policy on its first renewal.
 */
export function sessionCookieOptions(
  publicUrl: string,
  ttlMs: number,
): {
  path: string;
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  maxAge: number;
  signed: true;
} {
  return {
    path: '/',
    httpOnly: true,
    // `lax` permits inbound navigation (the OAuth callback return) while blocking
    // cross-site requests triggered by a third party.
    sameSite: 'lax',
    // Over local HTTP, a `secure` cookie would never be sent back.
    secure: publicUrl.startsWith('https://'),
    maxAge: Math.floor(ttlMs / 1000),
    signed: true,
  };
}

/**
 * Sessions are persisted in the database rather than a stateless JWT, allowing
 * access to be revoked immediately (sign-out, removing a user from configuration)
 * without waiting for an already issued token to expire.
 *
 * The session also carries the commenter identity — but does not **define** it:
 * the verified email address identifies a person, and the session merely remembers
 * it from one visit to the next.
 */
export class SessionStore {
  constructor(private readonly db: Db) {}

  /**
   * Opens a session. `device` is the device class inferred from the sign-in request's
   * user-agent — the only time it is read, as a browser does not change devices
   * during a session.
   */
  create(username: string, device: DeviceKind | null = null): SessionRecord {
    return this.open({ username, shareToken: null }, device);
  }

  /**
   * Opens a session for a share link.
   *
   * The result answers `/api/auth/me` with the same shape an account's session does,
   * which is what lets the identity form, the six-digit code and the whole comment
   * stack work through a link without being told a link exists (D260825).
   */
  createForShare(shareToken: string, device: DeviceKind | null = null): SessionRecord {
    return this.open({ username: null, shareToken }, device);
  }

  private open(
    credential: { username: string | null; shareToken: string | null },
    device: DeviceKind | null,
  ): SessionRecord {
    const id = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    this.db
      .prepare(
        `INSERT INTO sessions (id, username, created_at, expires_at, last_seen_at, device,
                               share_token)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        credential.username,
        now.toISOString(),
        expiresAt.toISOString(),
        now.toISOString(),
        device,
        credential.shareToken,
      );

    return {
      id,
      ...credential,
      expiresAt: expiresAt.toISOString(),
      commenterId: null,
      lastSeenAt: now.toISOString(),
      renewed: false,
    };
  }

  /**
   * Returns the session if it exists and has not expired, otherwise `null`.
   * Extends its expiry when the session has passed mid-life, and records the visit
   * if the previous trace is more than an hour old.
   */
  get(id: string): SessionRecord | null {
    // `last_seen_at` costs no additional read: this row is already fetched on every
    // request to check the expiry, so only one column is added to the SELECT.
    const row = this.db
      .prepare(
        `SELECT id, username, share_token AS shareToken, expires_at AS expiresAt,
                commenter_id AS commenterId, last_seen_at AS lastSeenAt
           FROM sessions WHERE id = ?`,
      )
      .get(id) as Omit<SessionRecord, 'renewed'> | undefined;

    if (!row) return null;

    const now = Date.now();
    const expiresAt = new Date(row.expiresAt).getTime();
    if (expiresAt <= now) {
      this.destroy(id);
      return null;
    }

    // NULL for a session opened before migration 15: the first request that reads it
    // assigns a date, otherwise it would remain invisible from the "Visits" tab until
    // the next sign-in — potentially a year.
    const seenAt = row.lastSeenAt === null ? 0 : new Date(row.lastSeenAt).getTime();
    const lastSeenAt = now - seenAt >= SEEN_AFTER_MS ? new Date(now).toISOString() : row.lastSeenAt;
    if (lastSeenAt !== row.lastSeenAt) {
      this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(lastSeenAt, id);
    }

    if (expiresAt - now < RENEW_AFTER_MS) {
      const next = new Date(now + SESSION_TTL_MS).toISOString();
      this.db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(next, id);
      return { ...row, expiresAt: next, lastSeenAt, renewed: true };
    }

    return { ...row, lastSeenAt, renewed: false };
  }

  /**
   * Attaches a verified identity to the session. Other open sessions for the same
   * identity are untouched: someone may be identified on their phone but not on the
   * family computer, precisely why identity is carried per session rather than per
   * account.
   */
  attachCommenter(sessionId: string, commenterId: number | null): void {
    this.db
      .prepare('UPDATE sessions SET commenter_id = ? WHERE id = ?')
      .run(commenterId, sessionId);
  }

  destroy(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  /** Revokes all sessions for a user (removed from configuration, for example). */
  destroyForUser(username: string): void {
    this.db.prepare('DELETE FROM sessions WHERE username = ?').run(username);
  }

  purgeExpired(): number {
    const result = this.db
      .prepare('DELETE FROM sessions WHERE expires_at <= ?')
      .run(new Date().toISOString());
    return result.changes;
  }

  get ttlMs(): number {
    return SESSION_TTL_MS;
  }
}
