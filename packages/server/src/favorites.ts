import type { Db } from './db.js';

/**
 * Per-user favorite photographs scoped to `(commenter_id, album_id, media_id)`.
 *
 * Stored on `commenter_id` rather than `username` so both password-authenticated
 * users and email-verified share-link visitors have their own favorites.
 */
export class FavoriteRepo {
  private readonly listAlbumStmt;
  private readonly checkStmt;
  private readonly insertStmt;
  private readonly deleteStmt;

  constructor(private readonly db: Db) {
    this.listAlbumStmt = db.prepare<[number, string], { media_id: string }>(
      `SELECT media_id
         FROM commenter_favorites
        WHERE commenter_id = ? AND album_id = ?
        ORDER BY created_at ASC, media_id ASC`,
    );
    this.checkStmt = db.prepare<[number, string, string], { ok: number }>(
      `SELECT 1 AS ok
         FROM commenter_favorites
        WHERE commenter_id = ? AND album_id = ? AND media_id = ?`,
    );
    this.insertStmt = db.prepare(
      `INSERT INTO commenter_favorites (commenter_id, album_id, media_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (commenter_id, album_id, media_id) DO NOTHING`,
    );
    this.deleteStmt = db.prepare(
      `DELETE FROM commenter_favorites
        WHERE commenter_id = ? AND album_id = ? AND media_id = ?`,
    );
  }

  /** Media IDs favorited by `commenterId` within `albumId`. */
  listForAlbum(commenterId: number, albumId: string): string[] {
    return this.listAlbumStmt.all(commenterId, albumId).map((row) => row.media_id);
  }

  /**
   * Media IDs favorited by `commenterId` among an arbitrary `(albumId, mediaId)` list
   * (such as a multi-photo or multi-album selection share).
   */
  listForMediaIds(
    commenterId: number,
    items: ReadonlyArray<string | { albumId: string; mediaId: string }>,
  ): string[] {
    if (items.length === 0) return [];
    const checkMediaOnly = this.db.prepare<[number, string], { ok: number }>(
      `SELECT 1 AS ok
         FROM commenter_favorites
        WHERE commenter_id = ? AND media_id = ?
        LIMIT 1`,
    );
    const result: string[] = [];
    for (const item of items) {
      if (typeof item === 'string') {
        if (checkMediaOnly.get(commenterId, item)) {
          result.push(item);
        }
      } else if (this.checkStmt.get(commenterId, item.albumId, item.mediaId)) {
        result.push(item.mediaId);
      }
    }
    return result;
  }

  /** True when `(commenterId, albumId, mediaId)` is marked as a favorite. */
  isFavorite(commenterId: number, albumId: string, mediaId: string): boolean {
    return this.checkStmt.get(commenterId, albumId, mediaId) !== undefined;
  }

  /** Marks `(albumId, mediaId)` as a favorite for `commenterId` (idempotent). */
  add(commenterId: number, albumId: string, mediaId: string): void {
    this.insertStmt.run(commenterId, albumId, mediaId, new Date().toISOString());
  }

  /** Removes `(albumId, mediaId)` from `commenterId`'s favorites (idempotent). */
  remove(commenterId: number, albumId: string, mediaId: string): void {
    this.deleteStmt.run(commenterId, albumId, mediaId);
  }
}
