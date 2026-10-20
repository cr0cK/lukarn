import { randomBytes } from 'node:crypto';
import type { AdminShareLink, MediaKind, ShareItem, ShareKind, ShareState } from '@lukarn/shared';
import type { Db } from './db.js';

/**
 * Share links: an album, one photograph, or a selection of photos, opened by somebody
 * with no account.
 *
 * A link is the **fourth** credential this instance issues, beside the owner's
 * Google consent, the access key and the person who comments (D260825). Three
 * properties follow, and each is the reason for the design rather than a detail of
 * it.
 *
 * **The token is random and its rights live in the row.** Thirty-two bytes, as a
 * session identifier already is, and never a signed value describing what it
 * grants. The three tokens already minted here — the two unsubscribe links and the
 * code fingerprint — carry no row, which is what makes them impossible to revoke.
 *
 * **`ConfigRepo.canSee` is never asked about a link.** Asking a link what it covers
 * is a different question, and a second predicate over accounts and their albums is
 * how one of the two gets updated alone.
 *
 * **A link that once worked says so.** A revoked or expired link is kept, answers
 * 410 and says which of the two happened; a token that never existed answers 404
 * (D260825b). Only deletion removes it, and that also erases its openings.
 */

/** A link as the server holds it. */
export interface ShareLink {
  token: string;
  /** `null` for cross-album selection links. */
  albumId: string | null;
  /** `null` for an album or selection link. */
  mediaId: string | null;
  label: string | null;
  createdAt: string;
  createdBy: string;
  expiresAt: string | null;
  revokedAt: string | null;
  allowComments: boolean;
  requireIdentity: boolean;
  albumIds?: string[];
}

export interface CreateShareInput {
  albumId?: string | null;
  albumIds?: string[] | null;
  mediaId?: string | null;
  items?: Array<{ albumId: string; mediaId: string }> | null;
  label?: string | null;
  createdBy: string;
  expiresAt?: string | null;
  allowComments?: boolean;
  requireIdentity?: boolean;
}

export interface UpdateShareInput {
  label?: string | null;
  expiresAt?: string | null;
  allowComments?: boolean;
  requireIdentity?: boolean;
  revoked?: boolean;
}

export interface RestoreShareInput {
  expiresAt?: string | null;
}

export interface ShareSubscriber {
  commenterId: number;
  displayName: string;
  email: string | null;
  notifyPhotos: boolean;
  notifyComments: boolean;
  createdAt: string;
}

interface Row {
  token: string;
  album_id: string | null;
  media_id: string | null;
  label: string | null;
  created_at: string;
  created_by: string;
  expires_at: string | null;
  revoked_at: string | null;
  allow_comments: number;
  require_identity: number;
}

interface MediaItemRow {
  id: string;
  album_id: string;
  name: string;
  mime_type: string;
  kind: MediaKind;
  size: number | null;
  width: number | null;
  height: number | null;
  taken_at: string;
  taken_at_from_exif: number;
  duration_ms: number | null;
  md5: string | null;
  has_thumbnail: number;
  video_codec: string | null;
  description: string | null;
}

function toLink(row: Row, albumIds?: string[]): ShareLink {
  return {
    token: row.token,
    albumId: row.album_id,
    mediaId: row.media_id,
    label: row.label,
    createdAt: row.created_at,
    createdBy: row.created_by,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    allowComments: row.allow_comments === 1,
    requireIdentity: row.require_identity === 1,
    ...(albumIds !== undefined ? { albumIds } : {}),
  };
}

/** What a link covers, derived from the row rather than stored twice. */
export function shareKind(link: ShareLink, itemCount = 0, albumCount = 0): ShareKind {
  if (link.mediaId !== null) return 'media';
  if (itemCount > 0 || albumCount > 1) return 'selection';
  if (link.albumId !== null || albumCount === 1) return 'album';
  return 'selection';
}

/**
 * Whether a link still works, and if not which of the two things happened.
 *
 * Revocation wins over expiry when both apply: it is the deliberate act, and
 * "taken back" is what its issuer would expect to be told.
 */
export function shareState(link: ShareLink, now = new Date()): ShareState {
  if (link.revokedAt !== null) return 'revoked';
  if (link.expiresAt !== null && new Date(link.expiresAt).getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'live';
}

/**
 * The bucket an opening falls in: `YYYY-MM-DDTHH` in UTC, the thirteen characters an
 * ISO instant spends on the hour. The same threshold `sessions.last_seen_at` uses,
 * for the same reason — a refreshed page is one visit, not six.
 */
function hourOf(date: Date): string {
  return date.toISOString().slice(0, 13);
}

export class ShareLinkRepo {
  constructor(
    private readonly db: Db,
    private readonly posters: () => boolean = () => false,
  ) {}

  /**
   * Mints a link. The token is the only secret involved and it never leaves this
   * method except in the response that creates it and in `/api/admin` listings.
   */
  create(input: CreateShareInput, now = new Date()): ShareLink {
    const token = randomBytes(32).toString('base64url');
    const hasItems = Boolean(input.items && input.items.length > 0);
    const isSingleMedia = Boolean(input.mediaId) && !hasItems;

    // Collect distinct whole albums from `albumIds` and `albumId` (unless single media).
    const requestedAlbums: string[] = [];
    if (!isSingleMedia) {
      if (input.albumIds && input.albumIds.length > 0) {
        for (const id of input.albumIds) {
          if (id && !requestedAlbums.includes(id)) requestedAlbums.push(id);
        }
      }
      if (input.albumId && !requestedAlbums.includes(input.albumId)) {
        requestedAlbums.push(input.albumId);
      }
    }

    const isSingleAlbum = !isSingleMedia && !hasItems && requestedAlbums.length === 1;
    const albumId = isSingleMedia
      ? (input.albumId ?? null)
      : isSingleAlbum
        ? requestedAlbums[0]!
        : null;
    const mediaId = isSingleMedia ? (input.mediaId ?? null) : null;
    const allowComments = (input.allowComments ?? true) ? 1 : 0;
    const requireIdentity = (input.requireIdentity ?? false) ? 1 : 0;

    const nowIso = now.toISOString();
    const insertLink = this.db.prepare(
      `INSERT INTO share_links (token, album_id, media_id, label, created_at, created_by,
                                expires_at, revoked_at, allow_comments, require_identity,
                                updated_at, notified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    );
    const insertAlbum = this.db.prepare(
      `INSERT INTO share_link_albums (token, album_id, position)
       VALUES (?, ?, ?)`,
    );
    const insertItem = this.db.prepare(
      `INSERT INTO share_link_items (token, album_id, media_id, position, added_at)
       VALUES (?, ?, ?, ?, ?)`,
    );

    const runCreate = this.db.transaction(() => {
      insertLink.run(
        token,
        albumId,
        mediaId,
        input.label ?? null,
        nowIso,
        input.createdBy,
        input.expiresAt ?? null,
        allowComments,
        requireIdentity,
        nowIso,
        nowIso,
      );
      if (requestedAlbums.length > 0) {
        let pos = 0;
        for (const id of requestedAlbums) {
          insertAlbum.run(token, id, pos++);
        }
      }
      if (input.items && input.items.length > 0) {
        let pos = 0;
        const seen = new Set<string>();
        for (const item of input.items) {
          if (!seen.has(item.mediaId)) {
            seen.add(item.mediaId);
            insertItem.run(token, item.albumId, item.mediaId, pos++, nowIso);
          }
        }
      }
    });

    runCreate();
    return this.find(token)!;
  }

  /**
   * The row, whatever state it is in.
   *
   * Expiry and revocation are **not** filtered here: a caller that could not tell a
   * dead link from an unknown one would have to answer both 404, which is exactly
   * what D260825b refuses.
   */
  find(token: string): ShareLink | null {
    const row = this.db.prepare('SELECT * FROM share_links WHERE token = ?').get(token) as
      Row | undefined;
    if (!row) return null;
    const albumIds = this.findAlbumIds(token);
    return toLink(row, albumIds);
  }

  /**
   * Returns ordered album IDs attached to this share link via `share_link_albums`
   * (falling back to `share_links.album_id` for whole-album shares).
   */
  findAlbumIds(token: string): string[] {
    const rows = this.db
      .prepare('SELECT album_id FROM share_link_albums WHERE token = ? ORDER BY position ASC')
      .all(token) as Array<{ album_id: string }>;
    const ids = rows.map((r) => r.album_id);
    if (ids.length === 0) {
      const linkRow = this.db
        .prepare('SELECT album_id, media_id FROM share_links WHERE token = ?')
        .get(token) as { album_id: string | null; media_id: string | null } | undefined;
      if (linkRow && linkRow.album_id !== null && linkRow.media_id === null) {
        ids.push(linkRow.album_id);
      }
    }
    return ids;
  }

  /**
   * Whether this link covers this media item (optionally scoped to `albumId`).
   *
   * An album link covers whatever the album currently indexes, so a photo added by a
   * later synchronisation is covered without the link being reissued — which is what
   * sharing an album means. A photograph link covers exactly one file. A composable
   * link covers any album in `share_link_albums` and any item in `share_link_items`.
   *
   * `canSee` is not consulted and is not taught about links (D260825).
   */
  covers(link: ShareLink, mediaId: string, albumId?: string): boolean {
    if (link.mediaId !== null) {
      if (albumId !== undefined && link.albumId !== null && link.albumId !== albumId) {
        return false;
      }
      return link.mediaId === mediaId;
    }

    if (link.albumId !== null && (albumId === undefined || link.albumId === albumId)) {
      const row = this.db
        .prepare('SELECT 1 AS ok FROM media WHERE album_id = ? AND id = ?')
        .get(link.albumId, mediaId) as { ok: number } | undefined;
      if (row !== undefined) return true;
    }

    const fromAlbum = this.db
      .prepare(
        `SELECT 1 AS ok
           FROM share_link_albums
           JOIN media ON media.album_id = share_link_albums.album_id
          WHERE share_link_albums.token = ?
            AND media.id = ?
            AND (? IS NULL OR share_link_albums.album_id = ?)`,
      )
      .get(link.token, mediaId, albumId ?? null, albumId ?? null) as { ok: number } | undefined;
    if (fromAlbum !== undefined) return true;

    const fromItem = this.db
      .prepare(
        `SELECT 1 AS ok
           FROM share_link_items
           JOIN media ON media.album_id = share_link_items.album_id AND media.id = share_link_items.media_id
          WHERE share_link_items.token = ?
            AND share_link_items.media_id = ?
            AND (? IS NULL OR share_link_items.album_id = ?)`,
      )
      .get(link.token, mediaId, albumId ?? null, albumId ?? null) as { ok: number } | undefined;
    return fromItem !== undefined;
  }

  /**
   * Resolves the album identifier for a media item covered by this link.
   *
   * Checks `share_link_items`, then `share_link_albums`, then `share_links.album_id`.
   */
  findItemAlbumId(token: string, mediaId: string): string | null {
    const itemRow = this.db
      .prepare('SELECT album_id FROM share_link_items WHERE token = ? AND media_id = ?')
      .get(token, mediaId) as { album_id: string } | undefined;
    if (itemRow) return itemRow.album_id;

    const albumRow = this.db
      .prepare(
        `SELECT sla.album_id
           FROM share_link_albums sla
           JOIN media m ON m.album_id = sla.album_id
          WHERE sla.token = ? AND m.id = ?
          ORDER BY sla.position ASC
          LIMIT 1`,
      )
      .get(token, mediaId) as { album_id: string } | undefined;
    if (albumRow) return albumRow.album_id;

    const linkRow = this.db
      .prepare(
        `SELECT s.album_id
           FROM share_links s
           JOIN media m ON m.album_id = s.album_id
          WHERE s.token = ? AND m.id = ?`,
      )
      .get(token, mediaId) as { album_id: string | null } | undefined;
    return linkRow?.album_id ?? null;
  }

  /**
   * Returns the distinct album identifiers covered by a link (across `share_link_albums`,
   * `share_link_items`, and `share_links.album_id`).
   */
  findItemAlbumIds(token: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT album_id FROM (
           SELECT album_id FROM share_link_albums WHERE token = ?
           UNION
           SELECT album_id FROM share_link_items WHERE token = ?
           UNION
           SELECT album_id FROM share_links WHERE token = ? AND album_id IS NOT NULL
         )`,
      )
      .all(token, token, token) as Array<{ album_id: string }>;
    return rows.map((row) => row.album_id);
  }

  /**
   * Returns ordered ShareItem entries for a selection or multi-album link.
   *
   * Media from `share_link_albums` is ordered by album position then `taken_at ASC`,
   * followed by individual `share_link_items` ordered by `position ASC` (deduplicated
   * by media ID). Media that was deleted from the index is omitted.
   */
  findItems(token: string): ShareItem[] {
    const albumMediaRows = this.db
      .prepare(
        `SELECT media.*, media_notes.description AS description
           FROM share_link_albums
           JOIN media ON media.album_id = share_link_albums.album_id
           LEFT JOIN media_notes ON media_notes.album_id = media.album_id AND media_notes.media_id = media.id
          WHERE share_link_albums.token = ?
          ORDER BY share_link_albums.position ASC, media.taken_at ASC, media.id ASC`,
      )
      .all(token) as MediaItemRow[];

    const itemRows = this.db
      .prepare(
        `SELECT media.*, media_notes.description AS description
           FROM share_link_items
           JOIN media ON media.album_id = share_link_items.album_id AND media.id = share_link_items.media_id
           LEFT JOIN media_notes ON media_notes.album_id = media.album_id AND media_notes.media_id = media.id
          WHERE share_link_items.token = ?
          ORDER BY share_link_items.position ASC`,
      )
      .all(token) as MediaItemRow[];

    const seen = new Set<string>();
    const combined: MediaItemRow[] = [];
    for (const row of albumMediaRows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        combined.push(row);
      }
    }
    for (const row of itemRows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        combined.push(row);
      }
    }

    const posters = this.posters();
    return combined.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      mimeType: row.mime_type,
      size: row.size,
      width: row.width,
      height: row.height,
      takenAt: row.taken_at,
      takenAtFromExif: row.taken_at_from_exif === 1,
      durationMs: row.duration_ms,
      hasPreview: row.kind === 'photo' || row.has_thumbnail === 1 || posters,
      version: row.md5 ? row.md5.slice(0, 8) : null,
      videoCodec: row.video_codec,
      description: row.description,
    }));
  }

  /**
   * Appends whole albums and/or individual media items to an existing share link.
   */
  addItems(
    token: string,
    input: { albumIds?: string[]; items?: Array<{ albumId: string; mediaId: string }> },
    now = new Date(),
  ): ShareLink | null {
    const existing = this.find(token);
    if (!existing) return null;

    const nowIso = now.toISOString();
    this.db.transaction(() => {
      // If adding to a single-media link, promote its existing single photo into share_link_items first.
      if (existing.mediaId !== null && existing.albumId !== null) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO share_link_items (token, album_id, media_id, position, added_at)
             VALUES (?, ?, ?, 0, ?)`,
          )
          .run(token, existing.albumId, existing.mediaId, existing.createdAt);
        this.db
          .prepare('UPDATE share_links SET media_id = NULL, album_id = NULL WHERE token = ?')
          .run(token);
      }

      if (input.albumIds && input.albumIds.length > 0) {
        const nextPosRow = this.db
          .prepare(
            'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM share_link_albums WHERE token = ?',
          )
          .get(token) as { next: number };
        let pos = nextPosRow.next;
        const insertAlbum = this.db.prepare(
          `INSERT OR IGNORE INTO share_link_albums (token, album_id, position)
           VALUES (?, ?, ?)`,
        );
        for (const albumId of input.albumIds) {
          if (albumId) insertAlbum.run(token, albumId, pos++);
        }
      }

      if (input.items && input.items.length > 0) {
        const nextPosRow = this.db
          .prepare(
            'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM share_link_items WHERE token = ?',
          )
          .get(token) as { next: number };
        let pos = nextPosRow.next;
        const insertItem = this.db.prepare(
          `INSERT OR IGNORE INTO share_link_items (token, album_id, media_id, position, added_at)
           VALUES (?, ?, ?, ?, ?)`,
        );
        for (const item of input.items) {
          insertItem.run(token, item.albumId, item.mediaId, pos++, nowIso);
        }
      }

      this.db
        .prepare(
          `UPDATE share_links
              SET updated_at = ?,
                  notified_at = COALESCE(notified_at, created_at)
            WHERE token = ?`,
        )
        .run(nowIso, token);

      this.syncSingleAlbumColumn(token);
    })();

    return this.find(token);
  }

  /**
   * Removes whole albums and/or individual media items from an existing share link.
   */
  removeItems(
    token: string,
    input: { albumIds?: string[]; items?: Array<{ albumId?: string; mediaId: string }> },
  ): ShareLink | null {
    const existing = this.find(token);
    if (!existing) return null;

    this.db.transaction(() => {
      if (input.albumIds && input.albumIds.length > 0) {
        const delAlbum = this.db.prepare(
          'DELETE FROM share_link_albums WHERE token = ? AND album_id = ?',
        );
        for (const albumId of input.albumIds) {
          delAlbum.run(token, albumId);
        }
      }

      if (input.items && input.items.length > 0) {
        const delItem = this.db.prepare(
          'DELETE FROM share_link_items WHERE token = ? AND media_id = ?',
        );
        for (const item of input.items) {
          delItem.run(token, item.mediaId);
        }
      }

      this.syncSingleAlbumColumn(token);
    })();

    return this.find(token);
  }

  private syncSingleAlbumColumn(token: string): void {
    const linkRow = this.db
      .prepare('SELECT media_id FROM share_links WHERE token = ?')
      .get(token) as { media_id: string | null } | undefined;
    if (!linkRow || linkRow.media_id !== null) return;

    const albums = this.db
      .prepare('SELECT album_id FROM share_link_albums WHERE token = ? ORDER BY position ASC')
      .all(token) as Array<{ album_id: string }>;
    const itemCount = (
      this.db
        .prepare('SELECT COUNT(*) AS count FROM share_link_items WHERE token = ?')
        .get(token) as { count: number }
    ).count;

    const singleAlbumId = albums.length === 1 && itemCount === 0 ? albums[0]!.album_id : null;
    this.db
      .prepare('UPDATE share_links SET album_id = ? WHERE token = ?')
      .run(singleAlbumId, token);
  }

  /**
   * Records a verified commenter who opened or subscribed to this share link.
   */
  recordSubscriber(commenterId: number, token: string, now = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO commenter_shares (commenter_id, token, notify_photos, notify_comments, created_at)
         VALUES (?, ?, 1, 1, ?)
         ON CONFLICT (commenter_id, token) DO NOTHING`,
      )
      .run(commenterId, token, now.toISOString());
  }

  /**
   * Updates per-share notification preferences for a subscriber.
   */
  setSubscriberPrefs(
    commenterId: number,
    token: string,
    prefs: { notifyPhotos?: boolean; notifyComments?: boolean },
  ): boolean {
    const existing = this.db
      .prepare(
        'SELECT notify_photos, notify_comments FROM commenter_shares WHERE commenter_id = ? AND token = ?',
      )
      .get(commenterId, token) as { notify_photos: number; notify_comments: number } | undefined;
    if (!existing) return false;

    const notifyPhotos =
      prefs.notifyPhotos !== undefined ? (prefs.notifyPhotos ? 1 : 0) : existing.notify_photos;
    const notifyComments =
      prefs.notifyComments !== undefined
        ? prefs.notifyComments
          ? 1
          : 0
        : existing.notify_comments;

    return (
      this.db
        .prepare(
          `UPDATE commenter_shares
              SET notify_photos = ?, notify_comments = ?
            WHERE commenter_id = ? AND token = ?`,
        )
        .run(notifyPhotos, notifyComments, commenterId, token).changes > 0
    );
  }

  /**
   * Lists subscribers associated with a share link.
   */
  listSubscribers(token: string): ShareSubscriber[] {
    const rows = this.db
      .prepare(
        `SELECT cs.commenter_id, c.display_name, c.email, cs.notify_photos, cs.notify_comments, cs.created_at
           FROM commenter_shares cs
           JOIN commenters c ON c.id = cs.commenter_id
          WHERE cs.token = ?
          ORDER BY cs.created_at ASC`,
      )
      .all(token) as Array<{
      commenter_id: number;
      display_name: string;
      email: string | null;
      notify_photos: number;
      notify_comments: number;
      created_at: string;
    }>;

    return rows.map((r) => ({
      commenterId: r.commenter_id,
      displayName: r.display_name,
      email: r.email,
      notifyPhotos: r.notify_photos === 1,
      notifyComments: r.notify_comments === 1,
      createdAt: r.created_at,
    }));
  }

  /**
   * Returns all share tokens associated with a commenter.
   */
  tokensForCommenter(commenterId: number): string[] {
    const rows = this.db
      .prepare('SELECT token FROM commenter_shares WHERE commenter_id = ? ORDER BY created_at DESC')
      .all(commenterId) as Array<{ token: string }>;
    return rows.map((r) => r.token);
  }

  /**
   * Records an opening, at most once per session and hour.
   *
   * `ON CONFLICT DO NOTHING` rather than a read followed by a write: the primary key
   * already states the rule, and two tabs opened together would otherwise both find
   * nothing and both insert.
   */
  recordOpening(token: string, sessionId: string, now = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO share_openings (token, session_id, hour, opened_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (token, session_id, hour) DO NOTHING`,
      )
      .run(token, sessionId, hourOf(now), now.toISOString());
  }

  /** Revokes a link and closes the sessions it opened: an open browser has to stop. */
  revoke(token: string, now = new Date()): boolean {
    const changed = this.db
      .prepare('UPDATE share_links SET revoked_at = ? WHERE token = ? AND revoked_at IS NULL')
      .run(now.toISOString(), token).changes;
    if (changed > 0) this.closeSessions(token);
    return changed > 0;
  }

  /**
   * Updates a share link's mutable attributes (label, expiry, allowComments, requireIdentity, revoked).
   *
   * Returns `null` if the token does not exist.
   */
  update(token: string, input: UpdateShareInput, now = new Date()): ShareLink | null {
    const existing = this.find(token);
    if (!existing) return null;

    const label = input.label !== undefined ? input.label : existing.label;
    const expiresAt = input.expiresAt !== undefined ? input.expiresAt : existing.expiresAt;
    const allowComments =
      input.allowComments !== undefined ? input.allowComments : existing.allowComments;
    const requireIdentity =
      input.requireIdentity !== undefined ? input.requireIdentity : existing.requireIdentity;
    let revokedAt = existing.revokedAt;
    if (input.revoked === true && existing.revokedAt === null) {
      revokedAt = now.toISOString();
    } else if (input.revoked === false) {
      revokedAt = null;
    }

    this.db
      .prepare(
        `UPDATE share_links
            SET label = ?,
                expires_at = ?,
                allow_comments = ?,
                require_identity = ?,
                revoked_at = ?
          WHERE token = ?`,
      )
      .run(label, expiresAt, allowComments ? 1 : 0, requireIdentity ? 1 : 0, revokedAt, token);

    if (input.revoked === true && existing.revokedAt === null) {
      this.closeSessions(token);
    }

    return this.find(token);
  }

  /**
   * Restores a revoked link: clears revoked_at and optionally updates expires_at.
   *
   * Returns null if the token does not exist.
   */
  restore(token: string, input?: RestoreShareInput): ShareLink | null {
    const existing = this.find(token);
    if (!existing || existing.revokedAt === null) return null;

    const expiresAt = input && input.expiresAt !== undefined ? input.expiresAt : existing.expiresAt;

    this.db
      .prepare(
        `UPDATE share_links
            SET revoked_at = NULL,
                expires_at = ?
          WHERE token = ?`,
      )
      .run(expiresAt, token);

    return this.find(token);
  }

  /**
   * Deletes a link outright, taking its openings with it.
   *
   * A separate gesture from revoking, and the only one that erases the history:
   * cutting a link off must not remove what justified the decision (D260825b).
   */
  remove(token: string): boolean {
    this.closeSessions(token);
    return this.db.prepare('DELETE FROM share_links WHERE token = ?').run(token).changes > 0;
  }

  /** Every link this instance has issued, newest first. */
  list(now = new Date()): AdminShareLink[] {
    const rows = this.db
      .prepare(
        `SELECT s.token, s.album_id, s.media_id, s.label, s.created_at, s.created_by,
                s.expires_at, s.revoked_at, s.allow_comments, s.require_identity,
                a.title AS album_title,
                m.name  AS media_name,
                (SELECT COUNT(*) FROM share_openings o WHERE o.token = s.token) AS opening_count,
                (SELECT COUNT(*) FROM share_link_items i WHERE i.token = s.token) AS item_count,
                (SELECT COUNT(*) FROM share_link_albums sla WHERE sla.token = s.token) AS album_count,
                (SELECT COUNT(*) FROM commenter_shares cs WHERE cs.token = s.token) AS subscriber_count
           FROM share_links s
           -- Inner join is wrong here even though the cascade makes it equivalent
           -- today: a listing that silently loses rows is the failure mode this
           -- screen exists to prevent.
           LEFT JOIN albums a ON a.id = s.album_id
           -- No foreign key holds this one, so the outer join is load-bearing: a
           -- photograph a sync missed leaves the link listed without a file name.
           LEFT JOIN media  m ON m.album_id = s.album_id AND m.id = s.media_id
          ORDER BY s.created_at DESC`,
      )
      .all() as (Row & {
      album_title: string | null;
      media_name: string | null;
      opening_count: number;
      item_count: number;
      album_count: number;
      subscriber_count: number;
    })[];

    // Two openings per link rather than all of them: what administration answers is
    // "was this opened, and when last" (D260825c). Everything the table makes
    // possible beyond that belongs to the intent that asked for it.
    const recent = this.db.prepare(
      'SELECT opened_at FROM share_openings WHERE token = ? ORDER BY opened_at DESC LIMIT 2',
    );
    const itemsStmt = this.db.prepare(
      'SELECT album_id, media_id FROM share_link_items WHERE token = ? ORDER BY position ASC',
    );

    return rows.map((row) => {
      const albumIds = this.findAlbumIds(row.token);
      const link = toLink(row, albumIds);
      const kind = shareKind(link, row.item_count, albumIds.length);
      const items = (itemsStmt.all(row.token) as Array<{ album_id: string; media_id: string }>).map(
        (item) => ({ albumId: item.album_id, mediaId: item.media_id }),
      );
      return {
        token: link.token,
        kind,
        state: shareState(link, now),
        albumId: link.albumId,
        albumIds,
        items,
        albumTitle: row.album_title,
        mediaId: link.mediaId,
        mediaName: row.media_name,
        label: link.label,
        createdAt: link.createdAt,
        createdBy: link.createdBy,
        expiresAt: link.expiresAt,
        revokedAt: link.revokedAt,
        allowComments: link.allowComments,
        requireIdentity: link.requireIdentity,
        openings: (recent.all(link.token) as { opened_at: string }[]).map((opening) => ({
          openedAt: opening.opened_at,
        })),
        openingCount: row.opening_count,
        albumCount: albumIds.length,
        subscriberCount: row.subscriber_count,
        ...(kind === 'selection' ? { itemCount: row.item_count } : {}),
      };
    });
  }

  /**
   * Closes every session this link opened. Called by both revoking and deleting: the
   * whole point of taking a link back is that an already-open browser stops.
   */
  private closeSessions(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE share_token = ?').run(token);
  }
}
