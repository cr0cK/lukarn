import { isLocale, type CommenterIdentity, type Locale } from '@lukarn/shared';
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
 * to a third party's inbox. The code itself lives in `verification-codes.ts`: what
 * is left here is what a person is.
 */

const MAX_DISPLAY_NAME = 64;

export interface StoredCommenter {
  id: number;
  email: string | null;
  displayName: string;
  notify: boolean;
  notifyPhotos: boolean;
  notifyComments: boolean;
  verifiedAt: string | null;
  /**
   * Language this person reads, recorded from their browser. `null` until one of
   * their requests announces a supported one, in which case the instance default
   * applies (D260812d).
   */
  locale: Locale | null;
}

interface CommenterRow {
  id: number;
  email: string | null;
  display_name: string;
  notify_photos: number;
  notify_comments: number;
  verified_at: string | null;
  pending_display_name: string | null;
  locale: string | null;
}

function toCommenter(row: CommenterRow): StoredCommenter {
  const notifyPhotos = row.notify_photos === 1;
  const notifyComments = row.notify_comments === 1;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    notify: notifyPhotos || notifyComments,
    notifyPhotos,
    notifyComments,
    verifiedAt: row.verified_at,
    locale: isLocale(row.locale) ? row.locale : null,
  };
}

/** Shape exposed to its holder. Reduced because the rest is not their concern. */
export function toIdentity(commenter: StoredCommenter): CommenterIdentity {
  return {
    email: commenter.email,
    displayName: commenter.displayName,
    notify: commenter.notify,
    notifyPhotos: commenter.notifyPhotos,
    notifyComments: commenter.notifyComments,
    locale: commenter.locale,
  };
}

export class CommenterRepo {
  constructor(private readonly db: Db) {}

  byEmail(email: string): StoredCommenter | null {
    const row = this.db.prepare('SELECT * FROM commenters WHERE email = ?').get(email.trim()) as
      CommenterRow | undefined;
    return row ? toCommenter(row) : null;
  }

  /**
   * Creates a verified commenter row for a unified user account (with or without an email).
   * If a commenter with the same email already exists, returns that row and marks it verified.
   */
  createForUser(
    displayName: string,
    email: string | null = null,
    locale: Locale | null = null,
  ): StoredCommenter {
    const trimmedName = displayName.trim().slice(0, MAX_DISPLAY_NAME) || 'User';
    const normalizedEmail = email ? email.trim() : null;
    const nowIso = new Date().toISOString();

    if (normalizedEmail) {
      const existing = this.byEmail(normalizedEmail);
      if (existing) {
        this.db
          .prepare(
            `UPDATE commenters
                SET verified_at = COALESCE(verified_at, ?),
                    display_name = COALESCE(NULLIF(?, ''), display_name),
                    locale = COALESCE(locale, ?)
              WHERE id = ?`,
          )
          .run(nowIso, trimmedName, locale, existing.id);
        return this.byId(existing.id)!;
      }
    }

    const result = this.db
      .prepare(
        `INSERT INTO commenters (email, display_name, notify_photos, notify_comments, verified_at, locale, created_at)
         VALUES (?, ?, 1, 1, ?, ?, ?)`,
      )
      .run(normalizedEmail, trimmedName, nowIso, locale, nowIso);
    return this.byId(Number(result.lastInsertRowid))!;
  }

  /** Updates a commenter's display name directly. */
  setDisplayName(id: number, displayName: string): void {
    const trimmed = displayName.trim().slice(0, MAX_DISPLAY_NAME);
    if (!trimmed) return;
    this.db.prepare('UPDATE commenters SET display_name = ? WHERE id = ?').run(trimmed, id);
  }

  /** Updates a commenter's email address. */
  setEmail(id: number, email: string | null, verified = false): void {
    const normalized = email ? email.trim() : null;
    if (verified && normalized) {
      this.db
        .prepare(
          'UPDATE commenters SET email = ?, verified_at = COALESCE(verified_at, ?) WHERE id = ?',
        )
        .run(normalized, new Date().toISOString(), id);
    } else {
      this.db.prepare('UPDATE commenters SET email = ? WHERE id = ?').run(normalized, id);
    }
  }

  /**
   * Records the language this person reads, and does nothing when it has not
   * changed.
   *
   * Called on every authenticated request (`plugins/locale.ts`), hence the guard:
   * a comparison in memory costs nothing, while an UPDATE per thumbnail would put
   * a write on the critical path of a cold grid.
   */
  setLocale(id: number, locale: Locale): void {
    this.db.prepare('UPDATE commenters SET locale = ? WHERE id = ?').run(locale, id);
  }

  /**
   * Gives a language to an identity that has none, and leaves an existing one alone.
   *
   * Somebody accepting an invitation gets the language that invitation was written
   * in, so the first email after they join is already readable to them rather than
   * waiting for a request to announce one. The `IS NULL` is the whole rule: a value
   * already stored came from that person's own browser, which D260812d makes
   * authoritative, and a choice made on their behalf must not displace it.
   */
  seedLocale(id: number, locale: Locale): void {
    this.db
      .prepare('UPDATE commenters SET locale = ? WHERE id = ? AND locale IS NULL')
      .run(locale, id);
  }

  byId(id: number): StoredCommenter | null {
    const row = this.db.prepare('SELECT * FROM commenters WHERE id = ?').get(id) as
      CommenterRow | undefined;
    return row ? toCommenter(row) : null;
  }

  /**
   * Records the identity behind an address before its code is checked: creates it
   * if the address is unknown, and takes note of the name declared with it.
   *
   * The supplied name is **not applied immediately** to an already verified identity:
   * it waits in `pending_display_name` until control of the inbox is proved. Without
   * this delay, knowing someone's address would be enough to rename them — and
   * because comment signatures are read on every request, their entire history would
   * change names instantly without any code being entered (D42).
   *
   * An identity that is not yet verified is written directly: nothing is signed by
   * it yet, so there is nothing to hijack.
   */
  declare(email: string, displayName: string): StoredCommenter {
    const normalized = email.trim();
    const name = displayName.trim().slice(0, MAX_DISPLAY_NAME);
    const existing = this.db.prepare('SELECT * FROM commenters WHERE email = ?').get(normalized) as
      CommenterRow | undefined;

    if (existing) {
      // The column name is selected from two literals in this file, never built from
      // the request, so nothing can be injected through it.
      const column = existing.verified_at === null ? 'display_name' : 'pending_display_name';
      this.db.prepare(`UPDATE commenters SET ${column} = ? WHERE id = ?`).run(name, existing.id);
      return this.byId(existing.id)!;
    }

    const nowIso = new Date().toISOString();
    const result = this.db
      .prepare('INSERT INTO commenters (email, display_name, created_at) VALUES (?, ?, ?)')
      .run(normalized, name, nowIso);
    return this.byId(Number(result.lastInsertRowid))!;
  }

  /**
   * Marks an address verified and applies the rename that was waiting on proof.
   *
   * This is where, and nowhere else, a name takes effect: control of the inbox has
   * just been shown. `verified_at` keeps its first value, because the date somebody
   * became a person is not rewritten by their signing in again.
   *
   * Returns `null` for an address this table does not know, which a caller holding a
   * valid code should treat as it treats an unknown one.
   */
  markVerified(email: string): StoredCommenter | null {
    const row = this.db.prepare('SELECT * FROM commenters WHERE email = ?').get(email.trim()) as
      CommenterRow | undefined;
    if (!row) return null;

    this.db
      .prepare(
        `UPDATE commenters
            SET verified_at = COALESCE(verified_at, ?),
                display_name = COALESCE(pending_display_name, display_name),
                pending_display_name = NULL
          WHERE id = ?`,
      )
      .run(new Date().toISOString(), row.id);

    return this.byId(row.id)!;
  }

  /** Sets both photo and comment notification switches together. */
  setNotify(id: number, notify: boolean): void {
    const flag = notify ? 1 : 0;
    this.db
      .prepare('UPDATE commenters SET notify_photos = ?, notify_comments = ? WHERE id = ?')
      .run(flag, flag, id);
  }

  /** Sets granular photo and/or comment notification preferences. */
  setNotifyPreferences(
    id: number,
    prefs: { notifyPhotos?: boolean; notifyComments?: boolean },
  ): void {
    const current = this.byId(id);
    if (!current) return;
    const notifyPhotos = prefs.notifyPhotos ?? current.notifyPhotos;
    const notifyComments = prefs.notifyComments ?? current.notifyComments;
    this.db
      .prepare('UPDATE commenters SET notify_photos = ?, notify_comments = ? WHERE id = ?')
      .run(notifyPhotos ? 1 : 0, notifyComments ? 1 : 0, id);
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
          WHERE p.id = ? AND c.id <> ? AND c.notify_comments = 1
            AND c.email IS NOT NULL AND c.verified_at IS NOT NULL`,
      )
      .get(parentCommentId, authorId) as CommenterRow | undefined;
    return row ? toCommenter(row) : null;
  }
}
