import { isLocale, type Locale } from '@lukarn/shared';
import type { Db } from './db.js';

/**
 * Subscriptions to new items in an album.
 *
 * The problem this table solves fits in one sentence: **an identity is not attached
 * to any album.** Access comes from the access key (`users`), identity from the
 * verified address (`commenters`), and nothing links the two — so there is no
 * inherent way to know whom to email when photos arrive.
 *
 * The chosen answer is subscription **when the album is opened**: opening an album
 * is a much better signal of interest than a checkbox nobody selects. Only already
 * verified identities are included — these people knowingly provided their address
 * (D41).
 *
 * Hence storing state rather than the mere presence of a row: because subscription
 * is automatic, a row deleted on unsubscribe would be recreated when the album is
 * opened again the next day.
 */

/** The subscriber data required by the notifier. */
export interface Subscriber {
  id: number;
  email: string;
  displayName: string;
  /** Language this person reads, `null` until one of their requests said so. */
  locale: Locale | null;
}

export type SubscriptionState = 'auto' | 'opted_out';

export class SubscriptionRepo {
  constructor(private readonly db: Db) {}

  /**
   * Subscribes when the album is opened. Does nothing if the identity is not verified
   * or a row already exists — the purpose of `INSERT OR IGNORE`: an `opted_out`
   * remains `opted_out`, otherwise reopening the album would resubscribe someone who
   * just unsubscribed.
   *
   * The verification condition is enforced by SQL rather than the caller: a merely
   * declared address may belong to a third party whom this gallery must not email
   * (D39).
   */
  subscribe(commenterId: number, albumId: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO album_subscriptions (commenter_id, album_id, state, created_at)
         SELECT id, ?, 'auto', ? FROM commenters WHERE id = ? AND verified_at IS NOT NULL`,
      )
      .run(albumId, new Date().toISOString(), commenterId);
  }

  /**
   * Unsubscribes from **this** album without touching others or `commenters.notify`,
   * which governs replies to comments. Finding "Christmas 2019" too busy must not
   * lose replies to one's own messages.
   *
   * Writes the row if it does not exist: the link lives in an email that may be
   * reopened months later, and the subscription may have been deleted in the
   * meantime — it is better to record the refusal than lose it.
   */
  unsubscribe(commenterId: number, albumId: string): void {
    this.db
      .prepare(
        `INSERT INTO album_subscriptions (commenter_id, album_id, state, created_at)
         VALUES (?, ?, 'opted_out', ?)
         ON CONFLICT (commenter_id, album_id) DO UPDATE SET state = 'opted_out'`,
      )
      .run(commenterId, albumId, new Date().toISOString());
  }

  /** Subscription state, `null` if the album has never been opened. */
  state(commenterId: number, albumId: string): SubscriptionState | null {
    const row = this.db
      .prepare('SELECT state FROM album_subscriptions WHERE commenter_id = ? AND album_id = ?')
      .get(commenterId, albumId) as { state: SubscriptionState } | undefined;
    return row?.state ?? null;
  }

  /**
   * Who should receive announcements of this album's new items.
   *
   * `notify = 0` also excludes: it is the only switch that means "no more email
   * from this gallery", and the comment-notification link is the only place it can
   * be activated. Continuing to email someone who disabled it would be the surest
   * route to the spam folder.
   */
  subscribers(albumId: string): Subscriber[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.email, c.display_name, c.locale
           FROM album_subscriptions s
           JOIN commenters c ON c.id = s.commenter_id
          WHERE s.album_id = ? AND s.state = 'auto'
            AND c.verified_at IS NOT NULL AND c.notify = 1
          ORDER BY c.id`,
      )
      .all(albumId) as {
      id: number;
      email: string;
      display_name: string;
      locale: string | null;
    }[];
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      locale: isLocale(row.locale) ? row.locale : null,
    }));
  }
}
