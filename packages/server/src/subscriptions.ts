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
  /**
   * When the subscriber reaches this content through a live share link rather than a
   * direct account grant, carries the share token so notifications link to `/s/<token>`.
   */
  shareToken?: string | null;
}

export interface CommentSubscriber {
  id: number;
  email: string;
  displayName: string;
  locale: Locale | null;
  share: { token: string; namesAlbum: boolean } | null;
}

export interface PendingShareUpdate {
  token: string;
  label: string | null;
  count: number;
  latest: string;
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
        `INSERT OR IGNORE INTO album_subscriptions (commenter_id, album_id, state, notify_photos, notify_comments, created_at)
         SELECT id, ?, 'auto', 1, 1, ? FROM commenters WHERE id = ? AND verified_at IS NOT NULL AND email IS NOT NULL`,
      )
      .run(albumId, new Date().toISOString(), commenterId);
  }

  /**
   * Unsubscribes from **this** album without touching others or `commenters.notify_comments`,
   * which governs replies to comments. Finding "Christmas 2019" too busy must not
   * lose replies to one's own messages.
   *
   * Writes the row if it does not exist: the link lives in an email that may be
   * reopened months later, and the subscription may have been deleted in the
   * meantime — it is better to record the refusal than lose it.
   */
  unsubscribe(commenterId: number, albumId: string): void {
    if (albumId.startsWith('share:')) {
      const token = albumId.slice('share:'.length);
      this.db
        .prepare(
          'UPDATE commenter_shares SET notify_photos = 0 WHERE commenter_id = ? AND token = ?',
        )
        .run(commenterId, token);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO album_subscriptions (commenter_id, album_id, state, notify_photos, notify_comments, created_at)
         VALUES (?, ?, 'opted_out', 0, 0, ?)
         ON CONFLICT (commenter_id, album_id) DO UPDATE
           SET state = 'opted_out',
               notify_photos = 0,
               notify_comments = 0`,
      )
      .run(commenterId, albumId, new Date().toISOString());
  }

  /**
   * Updates granular notification switches for an album subscription.
   */
  setPreferences(
    commenterId: number,
    albumId: string,
    prefs: { notifyPhotos?: boolean; notifyComments?: boolean },
  ): void {
    const existing = this.db
      .prepare(
        'SELECT notify_photos, notify_comments FROM album_subscriptions WHERE commenter_id = ? AND album_id = ?',
      )
      .get(commenterId, albumId) as { notify_photos: number; notify_comments: number } | undefined;
    const notifyPhotos =
      prefs.notifyPhotos !== undefined
        ? prefs.notifyPhotos
          ? 1
          : 0
        : (existing?.notify_photos ?? 1);
    const notifyComments =
      prefs.notifyComments !== undefined
        ? prefs.notifyComments
          ? 1
          : 0
        : (existing?.notify_comments ?? 1);
    const state: SubscriptionState =
      notifyPhotos === 0 && notifyComments === 0 ? 'opted_out' : 'auto';

    this.db
      .prepare(
        `INSERT INTO album_subscriptions (commenter_id, album_id, state, notify_photos, notify_comments, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (commenter_id, album_id) DO UPDATE
           SET state = excluded.state,
               notify_photos = excluded.notify_photos,
               notify_comments = excluded.notify_comments`,
      )
      .run(commenterId, albumId, state, notifyPhotos, notifyComments, new Date().toISOString());
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
   * Includes both `album_subscriptions` and `commenter_shares` for live whole-album or
   * multi-album share links covering `albumId`. When a subscriber reaches the album via
   * a share link rather than a direct account grant, `shareToken` is populated so the
   * notification links to `/s/<token>?order=desc`.
   */
  subscribers(albumId: string, nowIso = new Date().toISOString()): Subscriber[] {
    const candidates = this.db
      .prepare(
        `SELECT DISTINCT c.id, c.email, c.display_name, c.locale
           FROM commenters c
          WHERE c.verified_at IS NOT NULL
            AND c.email IS NOT NULL
            AND c.notify_photos = 1
            AND NOT EXISTS (
              SELECT 1 FROM album_subscriptions a
               WHERE a.commenter_id = c.id
                 AND a.album_id = @albumId
                 AND (a.state = 'opted_out' OR a.notify_photos = 0)
            )
            AND (
              EXISTS (
                SELECT 1 FROM album_subscriptions a
                 WHERE a.commenter_id = c.id
                   AND a.album_id = @albumId
                   AND a.state = 'auto'
                   AND a.notify_photos = 1
              )
              OR EXISTS (
                SELECT 1 FROM commenter_shares cs
                  JOIN share_links sl ON sl.token = cs.token
                 WHERE cs.commenter_id = c.id
                   AND cs.notify_photos = 1
                   AND sl.revoked_at IS NULL
                   AND (sl.expires_at IS NULL OR sl.expires_at > @nowIso)
                   AND sl.media_id IS NULL
                   AND (
                     sl.album_id = @albumId
                     OR EXISTS (
                       SELECT 1 FROM share_link_albums sla
                        WHERE sla.token = sl.token AND sla.album_id = @albumId
                     )
                   )
              )
            )
          ORDER BY c.id`,
      )
      .all({ albumId, nowIso }) as Array<{
      id: number;
      email: string;
      display_name: string;
      locale: string | null;
    }>;

    const result: Subscriber[] = [];
    for (const row of candidates) {
      const access = this.resolveAlbumAccess(row.id, albumId, 'photos', nowIso);
      if (!access.allowed) continue;
      result.push({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        locale: isLocale(row.locale) ? row.locale : null,
        ...(access.shareToken ? { shareToken: access.shareToken } : {}),
      });
    }
    return result;
  }

  /**
   * Who should receive notifications of a new comment on `(albumId, mediaId)`.
   *
   * Includes album subscribers and share subscribers with `notify_comments = 1`
   * (excluding `excludeCommenterId`).
   */
  commentSubscribers(
    albumId: string,
    mediaId: string,
    excludeCommenterId: number,
    nowIso = new Date().toISOString(),
  ): CommentSubscriber[] {
    const candidates = this.db
      .prepare(
        `SELECT DISTINCT c.id, c.email, c.display_name, c.locale
           FROM commenters c
          WHERE c.verified_at IS NOT NULL
            AND c.email IS NOT NULL
            AND c.notify_comments = 1
            AND c.id <> @excludeCommenterId
            AND NOT EXISTS (
              SELECT 1 FROM album_subscriptions a
               WHERE a.commenter_id = c.id
                 AND a.album_id = @albumId
                 AND (a.state = 'opted_out' OR a.notify_comments = 0)
            )
            AND (
              EXISTS (
                SELECT 1 FROM album_subscriptions a
                 WHERE a.commenter_id = c.id
                   AND a.album_id = @albumId
                   AND a.state = 'auto'
                   AND a.notify_comments = 1
              )
              OR EXISTS (
                SELECT 1 FROM commenter_shares cs
                  JOIN share_links sl ON sl.token = cs.token
                 WHERE cs.commenter_id = c.id
                   AND cs.notify_comments = 1
                   AND sl.revoked_at IS NULL
                   AND (sl.expires_at IS NULL OR sl.expires_at > @nowIso)
                   AND sl.allow_comments = 1
                   AND (
                     (sl.media_id = @mediaId AND sl.album_id = @albumId)
                     OR (
                       sl.media_id IS NULL
                       AND (
                         sl.album_id = @albumId
                         OR EXISTS (
                           SELECT 1 FROM share_link_albums sla
                            WHERE sla.token = sl.token AND sla.album_id = @albumId
                         )
                         OR EXISTS (
                           SELECT 1 FROM share_link_items sli
                            WHERE sli.token = sl.token
                              AND sli.album_id = @albumId
                              AND sli.media_id = @mediaId
                         )
                       )
                     )
                   )
              )
            )
          ORDER BY c.id`,
      )
      .all({ albumId, mediaId, excludeCommenterId, nowIso }) as Array<{
      id: number;
      email: string;
      display_name: string;
      locale: string | null;
    }>;

    const result: CommentSubscriber[] = [];
    for (const row of candidates) {
      const access = this.resolveCommentAccess(row.id, albumId, mediaId, nowIso);
      if (!access.allowed) continue;
      result.push({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        locale: isLocale(row.locale) ? row.locale : null,
        share: access.share,
      });
    }
    return result;
  }

  /**
   * Live composable/selection shares that have had individual items added since their
   * last notification boundary and have settled past `settleBeforeIso`.
   */
  pendingShareItemUpdates(
    settleBeforeIso: string,
    nowIso = new Date().toISOString(),
  ): PendingShareUpdate[] {
    const shares = this.db
      .prepare(
        `SELECT sl.token, sl.label, COALESCE(sl.notified_at, sl.created_at) AS boundary
           FROM share_links sl
          WHERE sl.revoked_at IS NULL
            AND (sl.expires_at IS NULL OR sl.expires_at > @nowIso)
            AND sl.updated_at IS NOT NULL
            AND sl.updated_at <= @settleBeforeIso`,
      )
      .all({ settleBeforeIso, nowIso }) as Array<{
      token: string;
      label: string | null;
      boundary: string;
    }>;

    const countStmt = this.db.prepare(
      `SELECT COUNT(*) AS count, MAX(added_at) AS latest
         FROM share_link_items
        WHERE token = ? AND added_at IS NOT NULL AND added_at > ?`,
    );

    const updates: PendingShareUpdate[] = [];
    for (const share of shares) {
      const row = countStmt.get(share.token, share.boundary) as {
        count: number;
        latest: string | null;
      };
      if (row.count > 0 && row.latest !== null) {
        updates.push({
          token: share.token,
          label: share.label,
          count: row.count,
          latest: row.latest,
        });
      }
    }
    return updates;
  }

  /**
   * Subscribers to a specific share link with `notify_photos = 1`.
   */
  shareSubscribers(token: string): Subscriber[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.email, c.display_name, c.locale
           FROM commenter_shares cs
           JOIN commenters c ON c.id = cs.commenter_id
          WHERE cs.token = ?
            AND cs.notify_photos = 1
            AND c.verified_at IS NOT NULL
            AND c.email IS NOT NULL
            AND c.notify_photos = 1
          ORDER BY c.id`,
      )
      .all(token) as Array<{
      id: number;
      email: string;
      display_name: string;
      locale: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      locale: isLocale(row.locale) ? row.locale : null,
      shareToken: token,
    }));
  }

  /**
   * Advances the notification boundary for a share link.
   */
  markShareNotified(token: string, at: string): void {
    this.db.prepare('UPDATE share_links SET notified_at = ? WHERE token = ?').run(at, token);
  }

  private resolveAlbumAccess(
    commenterId: number,
    albumId: string,
    kind: 'photos' | 'comments',
    nowIso: string,
  ): { allowed: boolean; shareToken: string | null } {
    const userRow = this.db
      .prepare('SELECT username, admin, role_viewer, all_albums FROM users WHERE commenter_id = ?')
      .get(commenterId) as
      { username: string; admin: number; role_viewer: number; all_albums: number } | undefined;

    if (userRow) {
      const canView = userRow.admin === 1 || userRow.role_viewer === 1;
      if (canView) {
        if (userRow.all_albums === 1) return { allowed: true, shareToken: null };
        const grant = this.db
          .prepare('SELECT 1 AS ok FROM user_albums WHERE username = ? AND album_id = ?')
          .get(userRow.username, albumId) as { ok: number } | undefined;
        if (grant) return { allowed: true, shareToken: null };
      }
    }

    const notifyCol = kind === 'photos' ? 'notify_photos' : 'notify_comments';
    const liveShare = this.db
      .prepare(
        `SELECT sl.token
           FROM commenter_shares cs
           JOIN share_links sl ON sl.token = cs.token
          WHERE cs.commenter_id = @commenterId
            AND cs.${notifyCol} = 1
            AND sl.revoked_at IS NULL
            AND (sl.expires_at IS NULL OR sl.expires_at > @nowIso)
            AND sl.media_id IS NULL
            AND (
              sl.album_id = @albumId
              OR EXISTS (
                SELECT 1 FROM share_link_albums sla
                 WHERE sla.token = sl.token AND sla.album_id = @albumId
              )
            )
          ORDER BY cs.created_at DESC
          LIMIT 1`,
      )
      .get({ commenterId, albumId, nowIso }) as { token: string } | undefined;

    if (liveShare) {
      return { allowed: true, shareToken: liveShare.token };
    }

    const anyExplicitShareForAlbum = this.db
      .prepare(
        `SELECT 1 AS ok
           FROM commenter_shares cs
           JOIN share_links sl ON sl.token = cs.token
          WHERE cs.commenter_id = @commenterId
            AND sl.media_id IS NULL
            AND (
              sl.album_id = @albumId
              OR EXISTS (
                SELECT 1 FROM share_link_albums sla
                 WHERE sla.token = sl.token AND sla.album_id = @albumId
              )
            )
          LIMIT 1`,
      )
      .get({ commenterId, albumId }) as { ok: number } | undefined;

    if (anyExplicitShareForAlbum) {
      return { allowed: false, shareToken: null };
    }

    const fallbackLiveShare = this.db
      .prepare(
        `SELECT sl.token
           FROM share_links sl
          WHERE sl.revoked_at IS NULL
            AND (sl.expires_at IS NULL OR sl.expires_at > @nowIso)
            AND sl.media_id IS NULL
            AND (
              sl.album_id = @albumId
              OR EXISTS (
                SELECT 1 FROM share_link_albums sla
                 WHERE sla.token = sl.token AND sla.album_id = @albumId
              )
            )
          ORDER BY sl.created_at DESC
          LIMIT 1`,
      )
      .get({ albumId, nowIso }) as { token: string } | undefined;

    if (fallbackLiveShare) {
      return { allowed: true, shareToken: fallbackLiveShare.token };
    }

    if (userRow) {
      return { allowed: false, shareToken: null };
    }

    // Unbound commenter in `album_subscriptions` (shared access-key visitor).
    return { allowed: true, shareToken: null };
  }

  private resolveCommentAccess(
    commenterId: number,
    albumId: string,
    mediaId: string,
    nowIso: string,
  ): { allowed: boolean; share: { token: string; namesAlbum: boolean } | null } {
    const userRow = this.db
      .prepare('SELECT username, admin, role_viewer, all_albums FROM users WHERE commenter_id = ?')
      .get(commenterId) as
      { username: string; admin: number; role_viewer: number; all_albums: number } | undefined;

    if (userRow) {
      const canView = userRow.admin === 1 || userRow.role_viewer === 1;
      if (canView) {
        if (userRow.all_albums === 1) return { allowed: true, share: null };
        const grant = this.db
          .prepare('SELECT 1 AS ok FROM user_albums WHERE username = ? AND album_id = ?')
          .get(userRow.username, albumId) as { ok: number } | undefined;
        if (grant) return { allowed: true, share: null };
      }
    }

    const liveShare = this.db
      .prepare(
        `SELECT sl.token, sl.album_id, sl.media_id,
                (SELECT COUNT(*) FROM share_link_albums sla WHERE sla.token = sl.token) AS album_count,
                (SELECT COUNT(*) FROM share_link_items sli WHERE sli.token = sl.token) AS item_count
           FROM commenter_shares cs
           JOIN share_links sl ON sl.token = cs.token
          WHERE cs.commenter_id = @commenterId
            AND cs.notify_comments = 1
            AND sl.revoked_at IS NULL
            AND (sl.expires_at IS NULL OR sl.expires_at > @nowIso)
            AND sl.allow_comments = 1
            AND (
              (sl.media_id = @mediaId AND sl.album_id = @albumId)
              OR (
                sl.media_id IS NULL
                AND (
                  sl.album_id = @albumId
                  OR EXISTS (
                    SELECT 1 FROM share_link_albums sla
                     WHERE sla.token = sl.token AND sla.album_id = @albumId
                  )
                  OR EXISTS (
                    SELECT 1 FROM share_link_items sli
                     WHERE sli.token = sl.token
                       AND sli.album_id = @albumId
                       AND sli.media_id = @mediaId
                  )
                )
              )
            )
          ORDER BY cs.created_at DESC
          LIMIT 1`,
      )
      .get({ commenterId, albumId, mediaId, nowIso }) as
      | {
          token: string;
          album_id: string | null;
          media_id: string | null;
          album_count: number;
          item_count: number;
        }
      | undefined;

    if (liveShare) {
      const namesAlbum =
        liveShare.media_id === null &&
        liveShare.item_count === 0 &&
        (liveShare.album_count === 1 ||
          (liveShare.album_count === 0 && liveShare.album_id !== null));
      return {
        allowed: true,
        share: { token: liveShare.token, namesAlbum },
      };
    }

    if (userRow) {
      return { allowed: false, share: null };
    }

    const anyShare = this.db
      .prepare('SELECT 1 AS ok FROM commenter_shares WHERE commenter_id = ? LIMIT 1')
      .get(commenterId) as { ok: number } | undefined;
    if (anyShare) {
      return { allowed: false, share: null };
    }

    return { allowed: true, share: null };
  }
}
