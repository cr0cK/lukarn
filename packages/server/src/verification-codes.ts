import { VERIFICATION_CODE_LENGTH } from '@lukarn/shared';
import { randomInt } from 'node:crypto';
import { hashVerificationCode, safeEqual } from './crypto.js';
import type { Db } from './db.js';

/**
 * The six digits sent to an address, and the rules D39 set around them.
 *
 * `users` carries authorisation, `commenters` carries identity, and a code is
 * neither: it is a short-lived proof that whoever typed it reads a given inbox.
 * D39 put its four columns on `commenters` when there was one thing to prove;
 * a second use would turn them into one column set with two meanings, and one
 * pending code per address means verifying an address while signing in would
 * overwrite one with the other.
 *
 * The rules are enforced here rather than once per flow: five attempts per code,
 * one send a minute per **address** across every purpose, and a deadline that
 * belongs to the purpose.
 */

/**
 * What a code proves. It is part of the primary key rather than a flag, so a code
 * minted for one flow is not merely refused by another — it is not found by it.
 */
export type CodePurpose = 'identity' | 'signin' | 'invite';

/**
 * How long a code lives, by purpose. An invitation has to survive somebody's
 * weekend, while a sign-in code is read within minutes in the tab that asked for
 * it. Six digits stay sufficient for the longer life for the reason D39 gives:
 * the five-attempt ceiling bounds guessing, not the lifetime.
 */
const TTL_MS: Record<CodePurpose, number> = {
  identity: 15 * 60 * 1000,
  signin: 15 * 60 * 1000,
  invite: 7 * 24 * 60 * 60 * 1000,
};

/** Minimum delay between two deliveries to the same address, whatever the purpose. */
const RESEND_DELAY_MS = 60 * 1000;

/**
 * Attempts before a code is spent. Six digits can be exhausted in one million
 * attempts; without a ceiling, verification would verify nothing.
 */
const MAX_ATTEMPTS = 5;

/** A live code, without the hash that proves it: no caller needs to read that. */
export interface StoredCode {
  /** The address the code was sent to. */
  target: string;
  purpose: CodePurpose;
  expiresAt: string;
  sentAt: string;
  attempts: number;
  /** The account an invitation is for, `null` for every other purpose. */
  username: string | null;
}

/** What prevents sending a code, expressed in a term a route can translate. */
export type MintFailure = 'too_soon';

/** What prevents spending one. */
export type CheckFailure = 'unknown' | 'expired' | 'too_many_attempts' | 'mismatch';

interface CodeRow {
  target: string;
  purpose: CodePurpose;
  code_hash: string;
  expires_at: string;
  sent_at: string;
  attempts: number;
  username: string | null;
}

function toStoredCode(row: CodeRow): StoredCode {
  return {
    target: row.target,
    purpose: row.purpose,
    expiresAt: row.expires_at,
    sentAt: row.sent_at,
    attempts: row.attempts,
    username: row.username,
  };
}

/** The `verification_codes` table and the whole of its rules. Sole writer. */
export class VerificationCodeRepo {
  constructor(
    private readonly db: Db,
    private readonly secret: string,
  ) {}

  /**
   * Draws a code, stores only its HMAC, and returns the digits **once** to the
   * caller that will send them.
   *
   * `options.username` names the account an invitation is for and is required for
   * that purpose alone — the table's `CHECK` says the same thing.
   */
  mint(
    target: string,
    purpose: CodePurpose,
    options: { username?: string } = {},
  ): { code: string } | { failure: MintFailure; retryAfterMs: number } {
    const normalized = target.trim();
    const username = options.username ?? null;
    // Thrown rather than returned: the table's CHECK says the same thing, and a
    // caller pairing the wrong purpose with the wrong argument has a bug no route
    // can answer.
    if (purpose === 'invite' && username === null) {
      throw new Error('An invitation must name the account it is for');
    }
    if (purpose !== 'invite' && username !== null) {
      throw new Error(`A ${purpose} code cannot name an account`);
    }

    const now = Date.now();
    // The delay is read across every purpose of one address rather than on the row
    // about to be written: a per-row check would let an identity code and an
    // invitation reach the same inbox in the same minute, which is the mail-bombing
    // this rule exists to stop.
    const last = this.db
      .prepare('SELECT MAX(sent_at) AS sentAt FROM verification_codes WHERE target = ?')
      .get(normalized) as { sentAt: string | null };
    if (last.sentAt) {
      const elapsed = now - new Date(last.sentAt).getTime();
      if (elapsed < RESEND_DELAY_MS) {
        return { failure: 'too_soon', retryAfterMs: RESEND_DELAY_MS - elapsed };
      }
    }

    // `randomInt` rather than `Math.random`: this is a secret, however short-lived.
    const code = String(randomInt(0, 10 ** VERIFICATION_CODE_LENGTH)).padStart(
      VERIFICATION_CODE_LENGTH,
      '0',
    );
    const sentAt = new Date(now).toISOString();
    const expiresAt = new Date(now + TTL_MS[purpose]).toISOString();
    const hash = hashVerificationCode(normalized, code, this.secret);

    if (purpose === 'invite') this.replaceInvite(normalized, username!, hash, expiresAt, sentAt);
    else this.replaceCode(normalized, purpose, hash, expiresAt, sentAt);

    return { code };
  }

  /**
   * Validates a code without spending it. Every attempt is counted **before** the
   * comparison, inherited from the identity flow it replaces: abandoning midway
   * must buy no free tries.
   *
   * The row is left in place because consumption belongs to the caller — accepting
   * an invitation writes an account, an identity and a session in one transaction,
   * and the deletion belongs inside it.
   */
  check(
    target: string,
    purpose: CodePurpose,
    code: string,
  ): { row: StoredCode } | { failure: CheckFailure } {
    const normalized = target.trim();
    const row = this.db
      .prepare('SELECT * FROM verification_codes WHERE target = ? AND purpose = ?')
      .get(normalized, purpose) as CodeRow | undefined;

    if (!row) return { failure: 'unknown' };
    if (row.attempts >= MAX_ATTEMPTS) return { failure: 'too_many_attempts' };
    if (new Date(row.expires_at).getTime() <= Date.now()) return { failure: 'expired' };

    this.db
      .prepare(
        'UPDATE verification_codes SET attempts = attempts + 1 WHERE target = ? AND purpose = ?',
      )
      .run(normalized, purpose);

    const expected = hashVerificationCode(row.target, code.trim(), this.secret);
    if (!safeEqual(expected, row.code_hash)) return { failure: 'mismatch' };

    // The attempt just counted belongs to the row handed back: the value read before
    // the UPDATE would understate it by one.
    return { row: { ...toStoredCode(row), attempts: row.attempts + 1 } };
  }

  /**
   * Spends a code: replaying it must find nothing.
   *
   * A plain statement rather than a transaction of its own, so a caller can run it
   * inside the wider one that writes what the code just proved.
   */
  consume(target: string, purpose: CodePurpose): void {
    this.db
      .prepare('DELETE FROM verification_codes WHERE target = ? AND purpose = ?')
      .run(target.trim(), purpose);
  }

  /**
   * The live code for this address and purpose, `null` if there is none.
   *
   * Expired rows are excluded rather than returned with a past date: they linger
   * only until the hourly purge, and a caller reading one would offer to remint
   * something nothing still connects to anything.
   */
  find(target: string, purpose: CodePurpose, now = new Date()): StoredCode | null {
    const row = this.db
      .prepare(
        `SELECT * FROM verification_codes
          WHERE target = ? AND purpose = ? AND expires_at > ?`,
      )
      .get(target.trim(), purpose, now.toISOString()) as CodeRow | undefined;
    return row ? toStoredCode(row) : null;
  }

  /**
   * The live invitation for this account, `null` if there is none. The partial
   * unique index is what makes "the" the right word: one invitation per account,
   * whichever address it was sent to.
   */
  pendingInvite(username: string, now = new Date()): StoredCode | null {
    const row = this.db
      .prepare(
        `SELECT * FROM verification_codes
          WHERE purpose = 'invite' AND username = ? AND expires_at > ?`,
      )
      .get(username, now.toISOString()) as CodeRow | undefined;
    return row ? toStoredCode(row) : null;
  }

  /**
   * Hourly housekeeping. The columns this table replaced were overwritten in place
   * and accumulated nothing; a table does.
   */
  purgeExpired(now = new Date()): number {
    return this.db
      .prepare('DELETE FROM verification_codes WHERE expires_at <= ?')
      .run(now.toISOString()).changes;
  }

  /**
   * An invitation replaces any other matching **either** axis, in one transaction.
   *
   * The two constraints refuse a duplicate and neither replaces it: inviting an
   * account at a second address conflicts on the partial index, inviting a second
   * account at one address conflicts on the primary key, and an upsert can name
   * only one of them. Anything shorter ships as a constraint error on the day
   * somebody corrects a typo in an address.
   */
  private replaceInvite(
    target: string,
    username: string,
    hash: string,
    expiresAt: string,
    sentAt: string,
  ): void {
    const remove = this.db.prepare(
      `DELETE FROM verification_codes
        WHERE purpose = 'invite' AND (target = ? OR username = ?)`,
    );
    const insert = this.db.prepare(
      `INSERT INTO verification_codes
         (target, purpose, code_hash, expires_at, sent_at, attempts, username)
       VALUES (?, 'invite', ?, ?, ?, 0, ?)`,
    );
    this.db.transaction(() => {
      remove.run(target, username);
      insert.run(target, hash, expiresAt, sentAt, username);
    })();
  }

  /**
   * A code for one address and purpose replaces the previous one and resets its
   * attempt counter: reminting is what somebody presses when their code ran out.
   */
  private replaceCode(
    target: string,
    purpose: CodePurpose,
    hash: string,
    expiresAt: string,
    sentAt: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO verification_codes
           (target, purpose, code_hash, expires_at, sent_at, attempts, username)
         VALUES (?, ?, ?, ?, ?, 0, NULL)
         ON CONFLICT (target, purpose) DO UPDATE
           SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
               sent_at = excluded.sent_at, attempts = 0`,
      )
      .run(target, purpose, hash, expiresAt, sentAt);
  }
}
