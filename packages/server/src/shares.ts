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
}

export interface CreateShareInput {
  albumId?: string | null;
  mediaId?: string | null;
  items?: Array<{ albumId: string; mediaId: string }> | null;
  label?: string | null;
  createdBy: string;
  expiresAt?: string | null;
}

export interface UpdateShareInput {
  label?: string | null;
  expiresAt?: string | null;
}

export interface RestoreShareInput {
  expiresAt?: string | null;
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

function toLink(row: Row): ShareLink {
  return {
    token: row.token,
    albumId: row.album_id,
    mediaId: row.media_id,
    label: row.label,
    createdAt: row.created_at,
    createdBy: row.created_by,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

/** What a link covers, derived from the row rather than stored twice. */
export function shareKind(link: ShareLink, itemCount = 0): ShareKind {
  if (link.mediaId !== null) return 'media';
  if (link.albumId === null || itemCount > 0) return 'selection';
  return 'album';
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
    const isSelection = Boolean(input.items && input.items.length > 0);
    const albumId = isSelection ? null : (input.albumId ?? null);
    const mediaId = isSelection ? null : (input.mediaId ?? null);

    const insertLink = this.db.prepare(
      `INSERT INTO share_links (token, album_id, media_id, label, created_at, created_by,
                                expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    const insertItem = this.db.prepare(
      `INSERT INTO share_link_items (token, album_id, media_id, position)
       VALUES (?, ?, ?, ?)`,
    );

    const runCreate = this.db.transaction(() => {
      insertLink.run(
        token,
        albumId,
        mediaId,
        input.label ?? null,
        now.toISOString(),
        input.createdBy,
        input.expiresAt ?? null,
      );
      if (input.items && input.items.length > 0) {
        let pos = 0;
        const seen = new Set<string>();
        for (const item of input.items) {
          if (!seen.has(item.mediaId)) {
            seen.add(item.mediaId);
            insertItem.run(token, item.albumId, item.mediaId, pos++);
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
    return row ? toLink(row) : null;
  }

  /**
   * Whether this link covers this media item.
   *
   * An album link covers whatever the album currently indexes, so a photo added by a
   * later synchronisation is covered without the link being reissued — which is what
   * sharing an album means. A photograph link covers exactly one file. A selection link
   * covers the items in `share_link_items`.
   *
   * `canSee` is not consulted and is not taught about links (D260825).
   */
  covers(link: ShareLink, mediaId: string): boolean {
    if (link.mediaId !== null) return link.mediaId === mediaId;
    if (link.albumId === null) {
      const item = this.db
        .prepare(
          `SELECT 1 AS ok
             FROM share_link_items
             JOIN media ON media.album_id = share_link_items.album_id AND media.id = share_link_items.media_id
            WHERE share_link_items.token = ? AND share_link_items.media_id = ?`,
        )
        .get(link.token, mediaId) as { ok: number } | undefined;
      return item !== undefined;
    }

    const row = this.db
      .prepare('SELECT 1 AS ok FROM media WHERE album_id = ? AND id = ?')
      .get(link.albumId, mediaId) as { ok: number } | undefined;
    return row !== undefined;
  }

  /**
   * Resolves the album identifier for a media item covered by this link.
   *
   * For an album link this is `link.albumId`. For a selection link this looks up
   * `share_link_items`.
   */
  findItemAlbumId(token: string, mediaId: string): string | null {
    const row = this.db
      .prepare('SELECT album_id FROM share_link_items WHERE token = ? AND media_id = ?')
      .get(token, mediaId) as { album_id: string } | undefined;
    return row ? row.album_id : null;
  }

  /**
   * Returns the distinct album identifiers covered by a selection link.
   */
  findItemAlbumIds(token: string): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT album_id FROM share_link_items WHERE token = ?')
      .all(token) as Array<{ album_id: string }>;
    return rows.map((row) => row.album_id);
  }

  /**
   * Returns ordered ShareItem entries for a selection link.
   *
   * Ordered by `position` ascending. Media that was deleted from the index is
   * omitted; the viewer reflects what is currently indexed.
   */
  findItems(token: string): ShareItem[] {
    const rows = this.db
      .prepare(
        `SELECT media.*, media_notes.description AS description
           FROM share_link_items
           JOIN media ON media.album_id = share_link_items.album_id AND media.id = share_link_items.media_id
           LEFT JOIN media_notes ON media_notes.album_id = media.album_id AND media_notes.media_id = media.id
          WHERE share_link_items.token = ?
          ORDER BY share_link_items.position ASC`,
      )
      .all(token) as MediaItemRow[];

    const posters = this.posters();
    return rows.map((row) => ({
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
   * Updates a share link's mutable attributes (label, expiry).
   *
   * Returns `null` if the token does not exist.
   */
  update(token: string, input: UpdateShareInput): ShareLink | null {
    const existing = this.find(token);
    if (!existing) return null;

    const label = input.label !== undefined ? input.label : existing.label;
    const expiresAt = input.expiresAt !== undefined ? input.expiresAt : existing.expiresAt;

    this.db
      .prepare(
        `UPDATE share_links
            SET label = ?,
                expires_at = ?
          WHERE token = ?`,
      )
      .run(label, expiresAt, token);

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
                s.expires_at, s.revoked_at,
                a.title AS album_title,
                m.name  AS media_name,
                (SELECT COUNT(*) FROM share_openings o WHERE o.token = s.token) AS opening_count,
                (SELECT COUNT(*) FROM share_link_items i WHERE i.token = s.token) AS item_count
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
    })[];

    // Two openings per link rather than all of them: what administration answers is
    // "was this opened, and when last" (D260825c). Everything the table makes
    // possible beyond that belongs to the intent that asked for it.
    const recent = this.db.prepare(
      'SELECT opened_at FROM share_openings WHERE token = ? ORDER BY opened_at DESC LIMIT 2',
    );

    return rows.map((row) => {
      const link = toLink(row);
      const kind = shareKind(link, row.item_count);
      return {
        token: link.token,
        kind,
        state: shareState(link, now),
        albumId: link.albumId,
        albumTitle: row.album_title,
        mediaId: link.mediaId,
        mediaName: row.media_name,
        label: link.label,
        createdAt: link.createdAt,
        createdBy: link.createdBy,
        expiresAt: link.expiresAt,
        revokedAt: link.revokedAt,
        openings: (recent.all(link.token) as { opened_at: string }[]).map((opening) => ({
          openedAt: opening.opened_at,
        })),
        openingCount: row.opening_count,
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
