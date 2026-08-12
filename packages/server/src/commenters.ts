import { VERIFICATION_CODE_LENGTH, type CommenterIdentity } from '@lukarn/shared';
import { randomInt } from 'node:crypto';
import { hashVerificationCode, safeEqual } from './crypto.js';
import type { Db } from './db.js';

/**
 * Commenter identities: people, as opposed to access keys in `users`.
 *
 * A username and password open albums, and nothing prevents sharing them with an
 * entire family. Signing a comment, however, requires being a person: that is the
 * role of this table, where an email address — verified by a code — serves as the
 * stable key. Identifying oneself again with the same address on another device
 * therefore finds the same comments.
 *
 * The address is verified because identity is declarative: without a code, anyone
 * behind the shared key could sign using someone else's name or send notifications
 * to a third party's inbox.
 */

/** Code lifetime. Long enough to fetch the email, but no longer. */
const CODE_TTL_MS = 15 * 60 * 1000;

/** Minimum delay between two deliveries to the same address. */
const RESEND_DELAY_MS = 60 * 1000;

/**
 * Attempts before invalidating the code. Six digits can be exhausted in one million
 * attempts; without a limit, verification would verify nothing.
 */
const MAX_ATTEMPTS = 5;

const MAX_DISPLAY_NAME = 64;

export interface StoredCommenter {
  id: number;
  email: string;
  displayName: string;
  notify: boolean;
  verifiedAt: string | null;
}

interface CommenterRow {
  id: number;
  email: string;
  display_name: string;
  notify: number;
  verified_at: string | null;
  code_hash: string | null;
  code_expires_at: string | null;
  code_sent_at: string | null;
  code_attempts: number;
  pending_display_name: string | null;
}

function toCommenter(row: CommenterRow): StoredCommenter {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    notify: row.notify === 1,
    verifiedAt: row.verified_at,
  };
}

/** Shape exposed to its holder. Reduced because the rest is not their concern. */
export function toIdentity(commenter: StoredCommenter): CommenterIdentity {
  return {
    email: commenter.email,
    displayName: commenter.displayName,
    notify: commenter.notify,
  };
}

/** What prevents sending a code, expressed in a term the route can translate. */
export type RequestFailure = 'too_soon';

/** What prevents validating a code. */
export type VerifyFailure = 'unknown' | 'expired' | 'too_many_attempts' | 'mismatch';

export class CommenterRepo {
  constructor(
    private readonly db: Db,
    private readonly secret: string,
  ) {}

  byEmail(email: string): StoredCommenter | null {
    const row = this.db.prepare('SELECT * FROM commenters WHERE email = ?').get(email.trim()) as
      CommenterRow | undefined;
    return row ? toCommenter(row) : null;
  }

  byId(id: number): StoredCommenter | null {
    const row = this.db.prepare('SELECT * FROM commenters WHERE id = ?').get(id) as
      CommenterRow | undefined;
    return row ? toCommenter(row) : null;
  }

  /**
   * Prepares a verification: creates the identity if the address is unknown,
   * generates a code and returns it in plain text **once** to the caller that will
   * send it by email. Only its HMAC is retained.
   *
   * The supplied name is **not applied immediately** to an already verified identity:
   * it waits in `pending_display_name` until `verify` proves control of the inbox.
   * Without this delay, knowing someone's address would be enough to rename them —
   * and because comment signatures are read on every request, their entire history
   * would change names instantly without any code being entered.
   *
   * An identity that is not yet verified is written directly: nothing is signed by
   * it yet, so there is nothing to hijack.
   */
  requestCode(
    email: string,
    displayName: string,
  ):
    | { code: string; commenter: StoredCommenter }
    | { failure: RequestFailure; retryAfterMs: number } {
    const normalized = email.trim();
    const name = displayName.trim().slice(0, MAX_DISPLAY_NAME);
    const now = Date.now();
    const existing = this.db.prepare('SELECT * FROM commenters WHERE email = ?').get(normalized) as
      CommenterRow | undefined;

    // Without this delay, the form would become a way to send bursts of email to an
    // address the requester does not control.
    if (existing?.code_sent_at) {
      const elapsed = now - new Date(existing.code_sent_at).getTime();
      if (elapsed < RESEND_DELAY_MS) {
        return { failure: 'too_soon', retryAfterMs: RESEND_DELAY_MS - elapsed };
      }
    }

    // `randomInt` rather than `Math.random`: this is a secret, however short-lived.
    const code = String(randomInt(0, 10 ** VERIFICATION_CODE_LENGTH)).padStart(
      VERIFICATION_CODE_LENGTH,
      '0',
    );
    const nowIso = new Date(now).toISOString();
    const expiresAt = new Date(now + CODE_TTL_MS).toISOString();
    const hash = hashVerificationCode(normalized, code, this.secret);

    if (existing) {
      // The column name is selected from two literals in this file, never built from
      // the request, so nothing can be injected through it.
      const column = existing.verified_at === null ? 'display_name' : 'pending_display_name';
      this.db
        .prepare(
          `UPDATE commenters
              SET ${column} = ?, code_hash = ?, code_expires_at = ?, code_sent_at = ?,
                  code_attempts = 0
            WHERE id = ?`,
        )
        .run(name, hash, expiresAt, nowIso, existing.id);
      return { code, commenter: this.byId(existing.id)! };
    }

    const result = this.db
      .prepare(
        `INSERT INTO commenters (email, display_name, code_hash, code_expires_at, code_sent_at,
                                 created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(normalized, name, hash, expiresAt, nowIso, nowIso);

    return { code, commenter: this.byId(Number(result.lastInsertRowid))! };
  }

  /**
   * Validates a code. Every attempt is counted **before** comparison so abandoning
   * partway through cannot provide free attempts.
   */
  verify(email: string, code: string): { commenter: StoredCommenter } | { failure: VerifyFailure } {
    const row = this.db.prepare('SELECT * FROM commenters WHERE email = ?').get(email.trim()) as
      CommenterRow | undefined;

    if (!row || !row.code_hash || !row.code_expires_at) return { failure: 'unknown' };
    if (row.code_attempts >= MAX_ATTEMPTS) return { failure: 'too_many_attempts' };
    if (new Date(row.code_expires_at).getTime() <= Date.now()) return { failure: 'expired' };

    this.db
      .prepare('UPDATE commenters SET code_attempts = code_attempts + 1 WHERE id = ?')
      .run(row.id);

    const expected = hashVerificationCode(row.email, code.trim(), this.secret);
    if (!safeEqual(expected, row.code_hash)) return { failure: 'mismatch' };

    // The code is consumed: replaying it must not revalidate an address whose access
    // was revoked in the meantime. This is also where, and nowhere else, a rename
    // takes effect — control has just been proved.
    this.db
      .prepare(
        `UPDATE commenters
            SET verified_at = COALESCE(verified_at, ?),
                display_name = COALESCE(pending_display_name, display_name),
                pending_display_name = NULL,
                code_hash = NULL, code_expires_at = NULL, code_attempts = 0
          WHERE id = ?`,
      )
      .run(new Date().toISOString(), row.id);

    return { commenter: this.byId(row.id)! };
  }

  /** Disables notifications without deleting the address, so resubscribing remains possible. */
  setNotify(id: number, notify: boolean): void {
    this.db.prepare('UPDATE commenters SET notify = ? WHERE id = ?').run(notify ? 1 : 0, id);
  }

  /**
   * Notification recipients: the author of the thread root for a reply. The caller
   * adds the moderation address — it comes from settings, not this table.
   *
   * The message author is never included: receiving an email about something just
   * written is the quickest way to make someone disable notifications.
   */
  recipientForReply(parentCommentId: number, authorId: number): StoredCommenter | null {
    const row = this.db
      .prepare(
        `SELECT c.* FROM commenters c
           JOIN comments p ON p.commenter_id = c.id
          WHERE p.id = ? AND c.id <> ? AND c.notify = 1 AND c.verified_at IS NOT NULL`,
      )
      .get(parentCommentId, authorId) as CommenterRow | undefined;
    return row ? toCommenter(row) : null;
  }
}
