import { randomBytes, randomInt } from 'node:crypto';
import { USER_CODE_ALPHABET, USER_CODE_LENGTH, type DevicePairingStart } from '@lukarn/shared';
import { hashDeviceCode } from './crypto.js';
import type { Db } from './db.js';

/**
 * Request lifetime. Long enough to fetch a phone, not long enough for an
 * approvable code to linger on a screen left on.
 */
const TTL_MS = 5 * 60 * 1000;

/** Polling interval advertised to the requester. */
export const POLL_INTERVAL_MS = 2_000;

/**
 * Limit on pending requests. The table lives in the database, so a burst of requests
 * must not make it grow without bound. Nobody gains access from this — at worst,
 * pairing becomes unavailable during the burst, which the burst would achieve anyway.
 */
export const MAX_PENDING = 200;

/**
 * Draws before giving up after a code collision. Eight characters from an alphabet
 * of 32 provide 40 bits: with at most 200 live requests, one collision is already
 * unlikely and two in a row indicate a failure.
 */
const CODE_ATTEMPTS = 5;

/** A live pairing request as read by the approval page. */
export interface PairingRecord {
  userCode: string;
  /** Account of the approver, `null` until someone approves. */
  username: string | null;
  approvedAt: string | null;
  expiresAt: string;
}

/** Approval result: repeating one's own changes nothing, while another's is refused. */
export type ApprovalResult = 'ok' | 'unknown' | 'taken';

/** Poll result. `unknown` covers unknown, expired and already claimed requests. */
export type ClaimResult =
  { status: 'unknown' } | { status: 'pending' } | { status: 'approved'; username: string };

/**
 * Pairing requests from a keyboardless screen (D260809c).
 *
 * Two values of opposite natures circulate, and the whole mechanism depends on
 * keeping them separate: the `userCode` is displayed on screen — in front of the
 * whole room — and only identifies the request; the `deviceCode` is returned once
 * to the requester and is the only value that claims the session.
 */
export class PairingStore {
  constructor(
    private readonly db: Db,
    private readonly secret: string,
  ) {}

  /**
   * Opens a request, or returns `null` if too many requests are already pending.
   * Purges expired requests before counting: otherwise a burst from an hour ago
   * would disable pairing until hourly housekeeping.
   */
  start(now = new Date()): DevicePairingStart | null {
    this.purgeExpired(now);

    const pending = this.db.prepare('SELECT COUNT(*) AS n FROM device_pairings').get() as {
      n: number;
    };
    if (pending.n >= MAX_PENDING) return null;

    const deviceCode = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + TTL_MS).toISOString();
    const insert = this.db.prepare(
      `INSERT INTO device_pairings (user_code, device_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
    );

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const userCode = generateUserCode();
      try {
        insert.run(userCode, hashDeviceCode(deviceCode, this.secret), now.toISOString(), expiresAt);
        return { userCode, deviceCode, expiresAt, intervalMs: POLL_INTERVAL_MS };
      } catch {
        // Primary-key collision: draw another code. Any other write error will recur
        // unchanged and end as `null`, meaning refusal to open a request — never
        // granted access.
      }
    }
    return null;
  }

  /** The live request carrying this code, `null` if unknown or expired. */
  find(userCode: string, now = new Date()): PairingRecord | null {
    const row = this.db
      .prepare(
        `SELECT user_code AS userCode, username, approved_at AS approvedAt,
                expires_at AS expiresAt
           FROM device_pairings WHERE user_code = ? AND expires_at > ?`,
      )
      .get(userCode, now.toISOString()) as PairingRecord | undefined;
    return row ?? null;
  }

  /**
   * Records who approves — and nothing more. No session is created here: otherwise
   * a screen switched off in the meantime would leave behind a year-long session
   * that nobody opened (D260809c).
   */
  approve(userCode: string, username: string, now = new Date()): ApprovalResult {
    const pairing = this.find(userCode, now);
    if (!pairing) return 'unknown';

    if (pairing.username !== null) {
      // Repeating one's own approval is not an error: it is a double click or a
      // reopened page. Repeating another account's approval is.
      return pairing.username.toLowerCase() === username.toLowerCase() ? 'ok' : 'taken';
    }

    this.db
      .prepare('UPDATE device_pairings SET username = ?, approved_at = ? WHERE user_code = ?')
      .run(username, now.toISOString(), userCode);
    return 'ok';
  }

  /**
   * Claims an approved request: returns the account to open and **deletes** the row.
   * A `deviceCode` therefore grants only one session; replayed, it receives the same
   * response as an unknown code.
   */
  claim(deviceCode: string, now = new Date()): ClaimResult {
    const row = this.db
      .prepare(
        `SELECT user_code AS userCode, username
           FROM device_pairings WHERE device_hash = ? AND expires_at > ?`,
      )
      .get(hashDeviceCode(deviceCode, this.secret), now.toISOString()) as
      { userCode: string; username: string | null } | undefined;

    if (!row) return { status: 'unknown' };
    if (row.username === null) return { status: 'pending' };

    this.forget(row.userCode);
    return { status: 'approved', username: row.username };
  }

  /** Removes a request — claimed, refused, or belonging to a missing account. */
  forget(userCode: string): void {
    this.db.prepare('DELETE FROM device_pairings WHERE user_code = ?').run(userCode);
  }

  purgeExpired(now = new Date()): number {
    return this.db
      .prepare('DELETE FROM device_pairings WHERE expires_at <= ?')
      .run(now.toISOString()).changes;
  }
}

/**
 * Eight randomly drawn characters without bias: `randomInt` rejects draws that
 * would skew the alphabet, unlike taking a byte modulo its length.
 */
function generateUserCode(): string {
  let code = '';
  for (let index = 0; index < USER_CODE_LENGTH; index++) {
    code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  }
  return code;
}
