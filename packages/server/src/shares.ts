import { randomBytes } from 'node:crypto';
import type { AdminShareLink, ShareKind, ShareState } from '@lukarn/shared';
import type { Db } from './db.js';

/**
 * Share links: an album, or one photograph, opened by somebody with no account.
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
  albumId: string;
  /** `null` for an album link. */
  mediaId: string | null;
  label: string | null;
  createdAt: string;
  createdBy: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface CreateShareInput {
  albumId: string;
  mediaId: string | null;
  label: string | null;
  createdBy: string;
  expiresAt: string | null;
}

export interface UpdateShareInput {
  label?: string | null;
  expiresAt?: string | null;
}

interface Row {
  token: string;
  album_id: string;
  media_id: string | null;
  label: string | null;
  created_at: string;
  created_by: string;
  expires_at: string | null;
  revoked_at: string | null;
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
export function shareKind(link: ShareLink): ShareKind {
  return link.mediaId === null ? 'album' : 'media';
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
  constructor(private readonly db: Db) {}

  /**
   * Mints a link. The token is the only secret involved and it never leaves this
   * method except in the response that creates it and in `/api/admin` listings.
   */
  create(input: CreateShareInput, now = new Date()): ShareLink {
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare(
        `INSERT INTO share_links (token, album_id, media_id, label, created_at, created_by,
                                  expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        token,
        input.albumId,
        input.mediaId,
        input.label,
        now.toISOString(),
        input.createdBy,
        input.expiresAt,
      );
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
   * sharing an album means. A photograph link covers exactly one file.
   *
   * `canSee` is not consulted and is not taught about links (D260825).
   */
  covers(link: ShareLink, mediaId: string): boolean {
    if (link.mediaId !== null) return link.mediaId === mediaId;
    const row = this.db
      .prepare('SELECT 1 AS ok FROM media WHERE album_id = ? AND id = ?')
      .get(link.albumId, mediaId) as { ok: number } | undefined;
    return row !== undefined;
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
                (SELECT COUNT(*) FROM share_openings o WHERE o.token = s.token) AS opening_count
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
    })[];

    // Two openings per link rather than all of them: what administration answers is
    // "was this opened, and when last" (D260825c). Everything the table makes
    // possible beyond that belongs to the intent that asked for it.
    const recent = this.db.prepare(
      'SELECT opened_at FROM share_openings WHERE token = ? ORDER BY opened_at DESC LIMIT 2',
    );

    return rows.map((row) => {
      const link = toLink(row);
      return {
        token: link.token,
        kind: shareKind(link),
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
