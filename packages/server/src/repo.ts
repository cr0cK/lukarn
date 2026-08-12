import {
  DEFAULT_GROUP_BY,
  DEFAULT_SORT_ORDER,
  type Album,
  type GroupBy,
  type MediaDetail,
  type MediaItem,
  type MediaKind,
  type SortOrder,
  type SyncStatus,
  type UpdateMediaRequest,
} from '@lukarn/shared';
import type { Db } from './db.js';

/** Raw `media` row with its joined description. */
interface MediaRow {
  album_id: string;
  id: string;
  name: string;
  mime_type: string;
  kind: MediaKind;
  size: number | null;
  width: number | null;
  height: number | null;
  taken_at: string;
  taken_at_from_exif: number;
  modified_time: string;
  duration_ms: number | null;
  camera_make: string | null;
  camera_model: string | null;
  lens: string | null;
  iso_speed: number | null;
  exposure_time: number | null;
  aperture: number | null;
  focal_length: number | null;
  lat: number | null;
  lng: number | null;
  md5: string | null;
  has_thumbnail: number;
  video_codec: string | null;
  description: string | null;
}

export interface MediaUpsert {
  albumId: string;
  id: string;
  name: string;
  mimeType: string;
  kind: MediaKind;
  size: number | null;
  width: number | null;
  height: number | null;
  takenAt: string;
  takenAtFromExif: boolean;
  modifiedTime: string;
  durationMs: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  isoSpeed: number | null;
  exposureTime: number | null;
  aperture: number | null;
  focalLength: number | null;
  lat: number | null;
  lng: number | null;
  md5: string | null;
  /**
   * Drive's `hasThumbnail`: does a preview of the first second exist?
   * Always true for a photo, not always for a video.
   */
  hasThumbnail: boolean;
  /**
   * Video-track codec read from the file header. `null` for a photo as well as a
   * video whose header could not be reached — see migration 14 for the column's
   * three states.
   */
  videoCodec: string | null;
}

function toItem(row: MediaRow): MediaItem {
  return {
    id: row.id,
    albumId: row.album_id,
    name: row.name,
    kind: row.kind,
    mimeType: row.mime_type,
    size: row.size,
    width: row.width,
    height: row.height,
    takenAt: row.taken_at,
    takenAtFromExif: row.taken_at_from_exif === 1,
    durationMs: row.duration_ms,
    // A photo always has a render — the pipeline decodes it and falls back to the
    // Drive preview when libvips cannot read it. A video has one only if Drive
    // produced it: nothing is decoded locally (D92).
    hasPreview: row.kind === 'photo' || row.has_thumbnail === 1,
    // Eight fingerprint characters distinguish successive versions of the same file
    // while keeping the URL readable.
    version: row.md5 ? row.md5.slice(0, 8) : null,
    videoCodec: row.video_codec,
    description: row.description,
  };
}

/**
 * The `media` columns with the description entered for this (album, media) pair.
 *
 * `media.*` rather than `*`: both tables have an `album_id` column, and a bare star
 * would make the row ambiguous to readers — SQLite would accept it, but the next
 * reader would have to guess which one they hold.
 *
 * The join is **one-to-one** on the `media_notes` primary key: it neither duplicates
 * nor loses rows, so it does not affect cursor pagination, which counts returned rows
 * to determine whether another page remains.
 */
const SELECT_ITEMS = `SELECT media.*, media_notes.description AS description
       FROM media
       LEFT JOIN media_notes
         ON media_notes.album_id = media.album_id AND media_notes.media_id = media.id`;

/**
 * Details as known by the index. The comment count comes from elsewhere and is
 * composed at route level: `MediaRepo` need not know that comments exist, otherwise
 * every media query would gain another join.
 */
export type IndexedDetail = Omit<MediaDetail, 'commentCount'>;

function toDetail(row: MediaRow): IndexedDetail {
  return {
    ...toItem(row),
    exif: {
      cameraMake: row.camera_make,
      cameraModel: row.camera_model,
      lens: row.lens,
      isoSpeed: row.iso_speed,
      exposureTime: row.exposure_time,
      aperture: row.aperture,
      focalLength: row.focal_length,
      latitude: row.lat,
      longitude: row.lng,
    },
  };
}

/**
 * Pagination cursor. Sorting is `(taken_at, id)` in the requested direction; the
 * cursor encodes the last returned row to resume strictly after it. A simple OFFSET
 * would skip or duplicate rows if a sync inserts media while the user scrolls.
 *
 * The format does not depend on direction: only the comparison applied on resumption
 * is reversed. A cursor therefore remains readable if direction changes; it simply
 * identifies the other half of the album.
 *
 * The separator is the null byte, written as `\u0000` and **never literally**: a
 * null byte in a source file makes git classify it as binary and stop displaying
 * diffs, preventing review. It remains the right separator because neither an ISO
 * date nor a Drive identifier can contain one, whereas a space would be a gamble on
 * identifier shape.
 */
export function encodeCursor(takenAt: string, id: string): string {
  return Buffer.from(`${takenAt}\u0000${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { takenAt: string; id: string } | null {
  try {
    const [takenAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('\u0000');
    if (!takenAt || !id) return null;
    return { takenAt, id };
  } catch {
    return null;
  }
}

export class MediaRepo {
  constructor(private readonly db: Db) {}

  /**
   * Chronologically sorted media page, newest to oldest by default and oldest to
   * newest with `asc`. Returns `limit` rows and reads one more to determine whether
   * a next page remains without running COUNT.
   */
  listItems(
    albumId: string,
    limit: number,
    cursor: string | null,
    order: SortOrder = DEFAULT_SORT_ORDER,
  ): {
    items: MediaItem[];
    nextCursor: string | null;
  } {
    const position = cursor ? decodeCursor(cursor) : null;

    // `order` is a closed union, never a string from the request, so these two
    // fragments cannot inject SQL. The sort column and cursor comparison must switch
    // together, otherwise resumption would reread the page already served.
    const direction = order === 'asc' ? 'ASC' : 'DESC';
    const after = order === 'asc' ? '>' : '<';

    const rows = position
      ? (this.db
          .prepare(
            `${SELECT_ITEMS}
             WHERE media.album_id = ?
               AND (media.taken_at ${after} ?
                    OR (media.taken_at = ? AND media.id ${after} ?))
             ORDER BY media.taken_at ${direction}, media.id ${direction}
             LIMIT ?`,
          )
          .all(albumId, position.takenAt, position.takenAt, position.id, limit + 1) as MediaRow[])
      : (this.db
          .prepare(
            `${SELECT_ITEMS}
             WHERE media.album_id = ?
             ORDER BY media.taken_at ${direction}, media.id ${direction}
             LIMIT ?`,
          )
          .all(albumId, limit + 1) as MediaRow[]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map(toItem),
      nextCursor: hasMore && last ? encodeCursor(last.taken_at, last.id) : null,
    };
  }

  getDetail(albumId: string, id: string): IndexedDetail | null {
    const row = this.mediaRow(albumId, id);
    return row ? toDetail(row) : null;
  }

  /**
   * Writes a photo's description **in this album** and returns the updated item.
   *
   * Absent field: nothing is touched. `null` — like an empty or whitespace-only
   * string — deletes the row: an empty description says no more than an absent one,
   * and retaining it would grow the table for no reason.
   *
   * Returns `null` if the media is not indexed in this album. The route turns that
   * into a 404; the repository does not decide HTTP status codes.
   */
  setDescription(albumId: string, mediaId: string, patch: UpdateMediaRequest): MediaItem | null {
    const row = this.mediaRow(albumId, mediaId);
    if (!row) return null;
    if (patch.description === undefined) return toItem(row);

    const trimmed = patch.description?.trim();
    const description = trimmed ? trimmed : null;

    if (description === null) {
      this.db
        .prepare('DELETE FROM media_notes WHERE album_id = ? AND media_id = ?')
        .run(albumId, mediaId);
    } else {
      this.db
        .prepare(
          `INSERT INTO media_notes (album_id, media_id, description, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (album_id, media_id) DO UPDATE SET
             description = excluded.description,
             updated_at = excluded.updated_at`,
        )
        .run(albumId, mediaId, description, new Date().toISOString());
    }

    return { ...toItem(row), description };
  }

  private mediaRow(albumId: string, id: string): MediaRow | undefined {
    return this.db
      .prepare(`${SELECT_ITEMS} WHERE media.album_id = ? AND media.id = ?`)
      .get(albumId, id) as MediaRow | undefined;
  }

  /**
   * Albums containing this media item. The same Drive file appears in several albums
   * when their folders are nested, so authorisation must consider the whole set, not
   * one album.
   */
  albumsContaining(id: string): string[] {
    const rows = this.db.prepare('SELECT album_id FROM media WHERE id = ?').all(id) as {
      album_id: string;
    }[];
    return rows.map((row) => row.album_id);
  }

  /**
   * Minimal metadata required to serve the file, without the rest.
   *
   * `md5` identifies content: Drive retains a file's identifier when its content is
   * replaced ("Manage versions"), so the identifier alone cannot distinguish two
   * successive versions.
   *
   * The same file indexed under two albums has two rows, which may diverge between
   * synchronisations. Sorting resolves them by `seen_at`: the most recently observed
   * row carries the `md5` and current Drive file size. Without this sort, SQLite could
   * return the old row and the cache would serve a stale derivative under an ETag
   * declaring it immutable. `album_id` breaks ties so consecutive calls return the
   * same result.
   */
  getFileMeta(id: string): {
    name: string;
    mimeType: string;
    kind: MediaKind;
    size: number | null;
    md5: string | null;
    hasThumbnail: boolean;
  } | null {
    const row = this.db
      .prepare(
        `SELECT name, mime_type, kind, size, md5, has_thumbnail FROM media
         WHERE id = ?
         ORDER BY seen_at DESC, album_id ASC
         LIMIT 1`,
      )
      .get(id) as
      | {
          name: string;
          mime_type: string;
          kind: MediaKind;
          size: number | null;
          md5: string | null;
          has_thumbnail: number;
        }
      | undefined;
    if (!row) return null;
    return {
      name: row.name,
      mimeType: row.mime_type,
      kind: row.kind,
      size: row.size,
      md5: row.md5,
      hasThumbnail: row.has_thumbnail === 1,
    };
  }

  /**
   * What a previous synchronisation dated for this file, and for which content.
   * Supports the video shortcut (D97): while `md5` is unchanged, rereading the file
   * header would return exactly the same date at the cost of several `Range` requests
   * per video on every album resync.
   *
   * Read using the `(album_id, id)` pair, the primary key: the same file indexed under
   * two albums carries two rows that may have been dated at different times.
   */
  fileTakenAt(
    albumId: string,
    id: string,
  ): {
    md5: string | null;
    takenAt: string;
    takenAtFromExif: boolean;
    /** `null` until the header provides a codec: the shortcut then does not apply,
     *  and the file is opened once more. */
    videoCodec: string | null;
  } | null {
    const row = this.db
      .prepare(
        `SELECT md5, taken_at, taken_at_from_exif, video_codec FROM media
          WHERE album_id = ? AND id = ?`,
      )
      .get(albumId, id) as
      | {
          md5: string | null;
          taken_at: string;
          taken_at_from_exif: number;
          video_codec: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      md5: row.md5,
      takenAt: row.taken_at,
      takenAtFromExif: row.taken_at_from_exif === 1,
      videoCodec: row.video_codec,
    };
  }

  /**
   * Count, chronological bounds and effective album cover.
   *
   * `chosenId` is an administrator's choice and only applies while the photo is in
   * the index: a file temporarily moved to Drive's bin would otherwise leave the
   * album without a thumbnail on the home page, with no explanation. The fallback
   * is therefore permanent while the choice remains stored — when the photo returns,
   * it becomes the cover again.
   */
  stats(
    albumId: string,
    chosenId: string | null = null,
  ): {
    itemCount: number;
    coverId: string | null;
    coverVersion: string | null;
    newestAt: string | null;
    oldestAt: string | null;
  } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count, MAX(taken_at) AS newest, MIN(taken_at) AS oldest
         FROM media WHERE album_id = ?`,
      )
      .get(albumId) as { count: number; newest: string | null; oldest: string | null };

    // `kind = 'photo'` on both sides: never a video. Videos have thumbnails since
    // D92, but those belong to Drive and may be missing — while the cover is the one
    // image whose absence is visible from the home page with no fallback.
    const chosen = chosenId
      ? (this.db
          .prepare(`SELECT id, md5 FROM media WHERE album_id = ? AND id = ? AND kind = 'photo'`)
          .get(albumId, chosenId) as { id: string; md5: string | null } | undefined)
      : undefined;

    // Without a usable choice, use the most recent photo.
    const cover =
      chosen ??
      (this.db
        .prepare(
          `SELECT id, md5 FROM media
         WHERE album_id = ? AND kind = 'photo'
         ORDER BY taken_at DESC, id DESC LIMIT 1`,
        )
        .get(albumId) as { id: string; md5: string | null } | undefined);

    return {
      itemCount: row.count,
      coverId: cover?.id ?? null,
      coverVersion: cover?.md5 ? cover.md5.slice(0, 8) : null,
      newestAt: row.newest,
      oldestAt: row.oldest,
    };
  }

  /**
   * Number of media items added to the index since `since`, and insertion date of
   * the most recent one.
   *
   * `added_at` rather than `seen_at`: the latter is rewritten for every media item on
   * every synchronisation, including known ones, and would therefore count the whole
   * album as new on each pass.
   *
   * The returned date becomes the new boundary: using it rather than "now" ensures
   * that media inserted between counting and writing the boundary is announced on
   * the next pass rather than skipped.
   */
  countAddedSince(albumId: string, since: string): { count: number; latest: string | null } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count, MAX(added_at) AS latest FROM media
          WHERE album_id = ? AND added_at > ?`,
      )
      .get(albumId, since) as { count: number; latest: string | null };
    return row;
  }

  /**
   * All known positions in an album in ascending chronological order, with their UTC
   * day. This is the only read used by the pass in `places.ts`, which infers a day's
   * places from it.
   *
   * `substr(taken_at, 1, 10)` rather than a `Date`: `taken_at` is the device time,
   * and slicing the string produces exactly the key calculated by `dayKey()` in the
   * front end. Applying a time zone would move a 23:30 photo to another day, and the
   * annotated day would no longer be correct.
   *
   * Ascending order is not cosmetic: returned clusters follow their first photo and
   * therefore the sequence of the day.
   */
  geolocatedPoints(albumId: string): { day: string; lat: number; lng: number }[] {
    return this.db
      .prepare(
        `SELECT substr(taken_at, 1, 10) AS day, lat, lng FROM media
          WHERE album_id = ? AND lat IS NOT NULL AND lng IS NOT NULL
          ORDER BY taken_at ASC, id ASC`,
      )
      .all(albumId) as { day: string; lat: number; lng: number }[];
  }

  upsertMany(items: MediaUpsert[], seenAt: string): void {
    const statement = this.db.prepare(
      `INSERT INTO media (
         album_id, id, name, mime_type, kind, size, width, height,
         taken_at, taken_at_from_exif, modified_time, duration_ms,
         camera_make, camera_model, lens, iso_speed, exposure_time,
         aperture, focal_length, lat, lng, md5, has_thumbnail, video_codec,
         seen_at, added_at
       ) VALUES (
         @albumId, @id, @name, @mimeType, @kind, @size, @width, @height,
         @takenAt, @takenAtFromExif, @modifiedTime, @durationMs,
         @cameraMake, @cameraModel, @lens, @isoSpeed, @exposureTime,
         @aperture, @focalLength, @lat, @lng, @md5, @hasThumbnail, @videoCodec,
         @seenAt, @seenAt
       )
       ON CONFLICT (album_id, id) DO UPDATE SET
         name = excluded.name,
         mime_type = excluded.mime_type,
         kind = excluded.kind,
         size = excluded.size,
         width = excluded.width,
         height = excluded.height,
         taken_at = excluded.taken_at,
         taken_at_from_exif = excluded.taken_at_from_exif,
         modified_time = excluded.modified_time,
         duration_ms = excluded.duration_ms,
         camera_make = excluded.camera_make,
         camera_model = excluded.camera_model,
         lens = excluded.lens,
         iso_speed = excluded.iso_speed,
         exposure_time = excluded.exposure_time,
         aperture = excluded.aperture,
         focal_length = excluded.focal_length,
         lat = excluded.lat,
         lng = excluded.lng,
         md5 = excluded.md5,
         has_thumbnail = excluded.has_thumbnail,
         video_codec = excluded.video_codec,
         seen_at = excluded.seen_at
         -- added_at is deliberately absent from this DO UPDATE: it is the index
         -- insertion date and never changes. Rewriting it would make a photo indexed
         -- for months appear new on every synchronisation.`,
    );

    const run = this.db.transaction((batch: MediaUpsert[]) => {
      for (const item of batch) {
        statement.run({
          ...item,
          takenAtFromExif: item.takenAtFromExif ? 1 : 0,
          hasThumbnail: item.hasThumbnail ? 1 : 0,
          seenAt,
        });
      }
    });

    run(items);
  }

  /**
   * Removes media the sync did not see again from the index: they were removed from
   * the Drive folder, moved or put in the bin.
   *
   * `media_notes` is **not** touched here or by `clearAlbum` and `pruneAlbums`: the
   * description is written manually and nothing regenerates it, while a photo may
   * leave the index because of a temporary indexing issue. Cleanup only comes from
   * the cascade on `albums`, meaning deletion of the album itself (D83).
   */
  deleteStale(albumId: string, seenAt: string): number {
    return this.db
      .prepare('DELETE FROM media WHERE album_id = ? AND seen_at < ?')
      .run(albumId, seenAt).changes;
  }

  /** Clears an album (after changing `folderId` in configuration, for example). */
  clearAlbum(albumId: string): number {
    return this.db.prepare('DELETE FROM media WHERE album_id = ?').run(albumId).changes;
  }

  /** Removes albums no longer declared in configuration. */
  pruneAlbums(knownIds: string[]): number {
    if (knownIds.length === 0) {
      const removed = this.db.prepare('DELETE FROM media').run().changes;
      this.db.prepare('DELETE FROM sync_state').run();
      return removed;
    }
    const placeholders = knownIds.map(() => '?').join(', ');
    const removed = this.db
      .prepare(`DELETE FROM media WHERE album_id NOT IN (${placeholders})`)
      .run(...knownIds).changes;
    this.db
      .prepare(`DELETE FROM sync_state WHERE album_id NOT IN (${placeholders})`)
      .run(...knownIds);
    return removed;
  }
}

export interface SyncRecord {
  lastSyncAt: string | null;
  status: SyncStatus;
  error: string | null;
}

export class SyncStateRepo {
  constructor(private readonly db: Db) {}

  get(albumId: string): SyncRecord {
    const row = this.db
      .prepare(
        'SELECT last_sync_at AS lastSyncAt, status, error FROM sync_state WHERE album_id = ?',
      )
      .get(albumId) as SyncRecord | undefined;
    return row ?? { lastSyncAt: null, status: 'never', error: null };
  }

  set(albumId: string, record: SyncRecord): void {
    this.db
      .prepare(
        `INSERT INTO sync_state (album_id, last_sync_at, status, error)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (album_id) DO UPDATE SET
           last_sync_at = excluded.last_sync_at,
           status = excluded.status,
           error = excluded.error`,
      )
      .run(albumId, record.lastSyncAt, record.status, record.error);
  }

  /**
   * Date of the latest announced new items, `null` until an announcement has occurred.
   * `set()` never touches it, so it survives synchronisations and errors; otherwise
   * a sync failure would cause everything to be announced again.
   */
  notifiedAt(albumId: string): string | null {
    const row = this.db
      .prepare('SELECT notified_at FROM sync_state WHERE album_id = ?')
      .get(albumId) as { notified_at: string | null } | undefined;
    return row?.notified_at ?? null;
  }

  markNotified(albumId: string, at: string): void {
    this.db.prepare('UPDATE sync_state SET notified_at = ? WHERE album_id = ?').run(at, albumId);
  }
}

/** Assembles the API album view from configuration and the index. */
export function buildAlbum(
  config: {
    id: string;
    title: string;
    description?: string | null;
    groupBy?: GroupBy;
    sortOrder?: SortOrder;
    coverMediaId?: string | null;
  },
  media: MediaRepo,
  sync: SyncStateRepo,
): Album {
  const stats = media.stats(config.id, config.coverMediaId ?? null);
  const state = sync.get(config.id);
  return {
    id: config.id,
    title: config.title,
    description: config.description ?? null,
    groupBy: config.groupBy ?? DEFAULT_GROUP_BY,
    sortOrder: config.sortOrder ?? DEFAULT_SORT_ORDER,
    itemCount: stats.itemCount,
    coverId: stats.coverId,
    coverVersion: stats.coverVersion,
    newestAt: stats.newestAt,
    oldestAt: stats.oldestAt,
    lastSyncAt: state.lastSyncAt,
    syncStatus: state.status,
    syncError: state.error,
  };
}
