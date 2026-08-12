import type { drive_v3 } from '@googleapis/drive';
import type { MediaRepo, MediaUpsert, SyncStateRepo } from '../repo.js';
import {
  classify,
  FOLDER_MIME,
  parseExifTime,
  resolveVideoTakenAt,
  toCoordinates,
  toNumber,
  toText,
  type VideoTakenAt,
} from './metadata.js';
import { findMoovOffset, readCreationTime, readVideoCodec } from './mp4.js';
import { DriveRevokedError, type DriveService } from './service.js';

const FIELDS =
  'nextPageToken, files(id, name, mimeType, size, modifiedTime, md5Checksum, hasThumbnail, ' +
  'imageMediaMetadata, videoMediaMetadata)';

const PAGE_SIZE = 1000;
/** Guard against a folder pointing to an entire, enormous tree. */
const MAX_FOLDERS = 5000;

/**
 * Video-header read window. 64 KB covers the full `moov` of observed files in one
 * read while remaining negligible beside files tens of megabytes in size.
 */
const HEADER_WINDOW_BYTES = 64 * 1024;

/**
 * Maximum windows opened to reach `moov`. A real import averaged 2.3 because phone
 * recordings place `moov` after `mdat`. Beyond this, the date falls back to the file
 * name rather than extending the sync.
 */
const HEADER_MAX_WINDOWS = 4;

/**
 * Header-read timeout. `fetchFile` sets none for a `Range` request because it relays
 * video to a browser consuming at its own pace. Here, a silent connection would block
 * the whole sync and leave the album `running` indefinitely.
 */
const HEADER_TIMEOUT_MS = 20_000;

/** What window traversal learns from a video header. */
interface ContainerHeader {
  /** `creation_time` from `moov`, `null` if absent or unreachable. */
  time: string | null;
  /**
   * Video-track codec. Empty string when `moov` was read but no video track was
   * recognised; `null` when the header was not reached. The distinction decides what
   * the next sync reopens — see migration 12.
   */
  codec: string | null;
}

/** What sync retains about a video: its date and how to make it playable. */
type VideoHeader = VideoTakenAt & { videoCodec: string | null };

/**
 * Exactly what synchronisation needs from an album: it depends on neither the
 * configuration file nor the database storage shape.
 */
export interface SyncAlbum {
  id: string;
  folderId: string;
  recursive: boolean;
}

export interface SyncResult {
  albumId: string;
  indexed: number;
  removed: number;
  folders: number;
  durationMs: number;
  /**
   * True when the album was reconfigured during traversal: this pass stopped without
   * writing, yielding to its replacement.
   */
  superseded: boolean;
}

/**
 * Abandons a pass made obsolete by reconfiguration. Internal to `Syncer`: it never
 * reaches the caller, which receives a `SyncResult` marked `superseded`.
 */
class SyncSupersededError extends Error {
  constructor(albumId: string) {
    super(`Sync of "${albumId}" abandoned: the album was reconfigured in the meantime`);
  }
}

export interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

function noop(): void {}

/**
 * Configuration actually traversed by a sync. Two syncs of one album are interchangeable
 * only when they target the same folder at the same depth.
 */
function fingerprint(album: SyncAlbum): string {
  return `${album.folderId}:${album.recursive ? 'recursif' : 'plat'}`;
}

/**
 * Album indexing: traverses the Drive folder and copies metadata into the database.
 * Nothing is downloaded — `imageMediaMetadata` supplies dimensions, capture date and
 * EXIF data directly in the `files.list` response, making sync of several thousand
 * photos almost instantaneous and cheap in quota.
 */
export class Syncer {
  /** Albums currently syncing, preventing manual resync from duplicating work. */
  private readonly running = new Map<
    string,
    { fingerprint: string; task: Promise<SyncResult>; generation: number }
  >();

  /**
   * Distinguishes two passes over one album. `fingerprint` is insufficient: returning
   * to the original folder during a sync would make the passes indistinguishable and
   * let the first regain control of the index.
   */
  private generations = 0;

  constructor(
    private readonly drive: DriveService,
    private readonly media: MediaRepo,
    private readonly syncState: SyncStateRepo,
    private readonly log: Logger,
  ) {}

  isRunning(albumId: string): boolean {
    return this.running.has(albumId);
  }

  /**
   * Starts sync or returns the one already running for this album **with the same
   * configuration**. Changing the Drive folder during sync makes the old pass unusable:
   * returning it would give the caller a promise that repopulates the album from the
   * folder just left.
   */
  sync(album: SyncAlbum): Promise<SyncResult> {
    const wanted = fingerprint(album);
    const current = this.running.get(album.id);
    if (current?.fingerprint === wanted) return current.task;

    // The new sync waits for the previous one rather than running beside it: both write
    // under the same `album_id`, and the last one's `deleteStale` decides what remains.
    // Without sequencing, completion order would decide album content.
    const previous = current ? current.task.then(noop, noop) : Promise.resolve();
    const generation = ++this.generations;
    const task = previous.then(() => this.run(album, generation));

    void task.catch(noop).finally(() => {
      // Remove only its own entry: if reconfiguration already replaced it, deleting
      // that entry would make the next sync believe none is running.
      if (this.running.get(album.id)?.task === task) this.running.delete(album.id);
    });
    this.running.set(album.id, { fingerprint: wanted, task, generation });
    return task;
  }

  /** Sequential sync of all albums to conserve Drive API quota. */
  async syncAll(albums: SyncAlbum[]): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    for (const album of albums) {
      try {
        results.push(await this.sync(album));
      } catch (error) {
        this.log.error(`Sync of "${album.id}" failed: ${(error as Error).message}`);
        // Authorisation revoked: every following album would fail identically. Stop;
        // the error already written to `sync_state` explains what happened.
        if (error instanceof DriveRevokedError) break;
      }
    }
    return results;
  }

  /**
   * Does this pass still control the album? False once reconfiguration starts another,
   * after which nothing may be written: the route purged the index when changing the
   * folder, and reinserting here would expose photos the owner just removed.
   */
  private ensureCurrent(albumId: string, generation: number): void {
    if (this.running.get(albumId)?.generation !== generation) {
      throw new SyncSupersededError(albumId);
    }
  }

  private async run(album: SyncAlbum, generation: number): Promise<SyncResult> {
    const startedAt = Date.now();
    // Pass stamp: media not seen with this value has left the folder and is removed
    // from the index at the end.
    const seenAt = new Date().toISOString();

    const previous = this.syncState.get(album.id);
    this.syncState.set(album.id, { ...previous, status: 'running', error: null });

    const visited = new Set<string>();

    try {
      const api = this.drive.api();
      const pending = [album.folderId];
      let indexed = 0;
      let batch: MediaUpsert[] = [];

      while (pending.length > 0) {
        const folderId = pending.pop()!;
        // Drive shortcuts can form cycles; without this guard traversal would not end.
        if (visited.has(folderId)) continue;
        visited.add(folderId);

        if (visited.size > MAX_FOLDERS) {
          throw new Error(
            `More than ${MAX_FOLDERS} folders walked for album "${album.id}" — ` +
              'target a more specific folder, or set `recursive: false`.',
          );
        }

        for await (const file of this.listFolder(api, folderId)) {
          if (file.mimeType === FOLDER_MIME) {
            if (album.recursive && file.id) pending.push(file.id);
            continue;
          }

          const item = await this.toUpsert(album.id, file);
          if (!item) continue;

          batch.push(item);
          indexed++;

          // Batched writes: one transaction per thousand files rather than per file,
          // while the album becomes browsable during sync.
          if (batch.length >= 500) {
            this.ensureCurrent(album.id, generation);
            this.media.upsertMany(batch, seenAt);
            batch = [];
          }
        }
      }

      // Final check before writes that decide visible content.
      this.ensureCurrent(album.id, generation);
      if (batch.length > 0) this.media.upsertMany(batch, seenAt);

      const removed = this.media.deleteStale(album.id, seenAt);
      const durationMs = Date.now() - startedAt;

      this.syncState.set(album.id, { lastSyncAt: seenAt, status: 'ok', error: null });
      this.log.info(
        `Album "${album.id}": ${indexed} media, ${removed} removed, ` +
          `${visited.size} folders, ${durationMs} ms`,
      );

      return {
        albumId: album.id,
        indexed,
        removed,
        folders: visited.size,
        durationMs,
        superseded: false,
      };
    } catch (error) {
      if (error instanceof SyncSupersededError) {
        // Neither the index nor `sync_state` is touched: both now belong to the
        // replacement pass. Writing "error" here would show a failure in /admin when
        // nothing failed — configuration merely changed beneath this pass.
        this.log.info(error.message);
        return {
          albumId: album.id,
          indexed: 0,
          removed: 0,
          folders: visited.size,
          durationMs: Date.now() - startedAt,
          superseded: true,
        };
      }

      const message = (error as Error).message;
      /**
       * Already written batches are committed — one transaction per batch of 500,
       * not for the whole sync — so the index mixes old and new content. Since
       * `deleteStale` did not run, nothing was removed, and newly written items exist
       * in Drive. The album remains browsable and consistent, merely incomplete.
       *
       * `lastSyncAt` retains the last **successful** pass: this is what /admin shows,
       * and claiming sync happened now would hide that it did not complete.
       */
      if (this.running.get(album.id)?.generation === generation) {
        this.syncState.set(album.id, {
          lastSyncAt: previous.lastSyncAt,
          status: 'error',
          error: message,
        });
      }
      throw error;
    }
  }

  private async *listFolder(
    api: drive_v3.Drive,
    folderId: string,
  ): AsyncGenerator<drive_v3.Schema$File> {
    let pageToken: string | undefined;

    do {
      // `guard` translates `invalid_grant` into DriveRevokedError and marks the
      // connection revoked; otherwise every album would fail with a technical message
      // that never says access must be reauthorised.
      const { data } = await this.drive.guard(() =>
        api.files.list({
          q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
          fields: FIELDS,
          pageSize: PAGE_SIZE,
          pageToken,
          // Required for shared Drives to be visible.
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          orderBy: 'name',
        }),
      );

      for (const file of data.files ?? []) {
        yield file;
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  private async toUpsert(albumId: string, file: drive_v3.Schema$File): Promise<MediaUpsert | null> {
    const kind = classify(file.mimeType);
    if (!kind || !file.id || !file.modifiedTime) return null;

    const image = file.imageMediaMetadata;
    const video = file.videoMediaMetadata;

    const exifTime = parseExifTime(image?.time);
    // Without an EXIF date (screenshots, re-encoded photos), Drive modification time
    // is the only chronological reference. Videos never have one and are dated from
    // their file (D97), which also yields the codec in the same window pass (D260809b).
    const { takenAt, fromFile, videoCodec } =
      kind === 'video'
        ? await this.videoHeader(albumId, file)
        : {
            takenAt: exifTime ?? new Date(file.modifiedTime).toISOString(),
            fromFile: exifTime !== null,
            videoCodec: null,
          };

    const width = toNumber(image?.width) ?? toNumber(video?.width);
    const height = toNumber(image?.height) ?? toNumber(video?.height);

    // Drive supplies sensor dimensions: on a portrait photo they are reversed and
    // `rotation` (EXIF 5–8) restores the order. The grid calculates rows from these
    // values, so correcting them here prevents distorted thumbnails before loading.
    const rotated = typeof image?.rotation === 'number' && image.rotation % 2 === 1;

    const { lat, lng } = toCoordinates(image?.location?.latitude, image?.location?.longitude);

    return {
      albumId,
      id: file.id,
      name: file.name ?? file.id,
      mimeType: file.mimeType ?? 'application/octet-stream',
      kind,
      size: toNumber(file.size),
      width: rotated ? height : width,
      height: rotated ? width : height,
      takenAt,
      takenAtFromExif: fromFile,
      modifiedTime: new Date(file.modifiedTime).toISOString(),
      durationMs: toNumber(video?.durationMillis),
      cameraMake: toText(image?.cameraMake),
      cameraModel: toText(image?.cameraModel),
      lens: toText(image?.lens),
      isoSpeed: toNumber(image?.isoSpeed),
      exposureTime: toNumber(image?.exposureTime),
      aperture: toNumber(image?.aperture),
      focalLength: toNumber(image?.focalLength),
      lat,
      lng,
      md5: toText(file.md5Checksum),
      // Drive produces an image from a video's first second, but not always: an
      // unreadable codec or newly uploaded file may lack one. Storing this prevents the
      // grid requesting a non-existent preview on every page load (D92).
      hasThumbnail: file.hasThumbnail === true,
      videoCodec,
    };
  }

  /**
   * Video capture date (D97) and video-track codec (D260809b), reconstructed from the
   * file in one read.
   *
   * The `md5` shortcut makes video-album sync repeatable: a video already dated from
   * its unchanged file keeps that date without rereading a byte. A video left on
   * `modifiedTime` because its header or Drive was unavailable is retried next pass.
   *
   * `videoCodec` participates in the condition, populating the column without a data
   * migration: older rows have a file-derived date but no codec, so they are reread
   * **once** and then shortcut like the others.
   */
  private async videoHeader(albumId: string, file: drive_v3.Schema$File): Promise<VideoHeader> {
    const md5 = toText(file.md5Checksum);
    const known = this.media.fileTakenAt(albumId, file.id!);
    if (known?.takenAtFromExif && md5 !== null && known.md5 === md5 && known.videoCodec !== null) {
      return { takenAt: known.takenAt, fromFile: true, videoCodec: known.videoCodec };
    }

    const header = await this.containerHeader(file.id!, toNumber(file.size));
    return {
      ...resolveVideoTakenAt({
        name: file.name,
        containerTime: header.time,
        durationMs: toNumber(file.videoMediaMetadata?.durationMillis),
        modifiedTime: file.modifiedTime!,
      }),
      videoCodec: header.codec,
    };
  }

  /**
   * What `moov` carries, following top-level boxes across windows. Everything is
   * `null` when the file cannot be read — non-ISOBMFF, unreachable `moov`, unavailable
   * Drive — so the caller falls back to name, then modification date.
   *
   * Both reads share a window because they share a box: separating them would double
   * `Range` requests for a video-album sync to reread the same bytes.
   */
  private async containerHeader(fileId: string, fileSize: number | null): Promise<ContainerHeader> {
    const absent: ContainerHeader = { time: null, codec: null };

    // Without a reported size the chain cannot be bounded: a zero-size box runs "to
    // the end", which would be unknown.
    if (fileSize === null || fileSize <= 0) return absent;

    let start = 0;

    for (let fenetre = 0; fenetre < HEADER_MAX_WINDOWS; fenetre++) {
      const buffer = await this.readWindow(fileId, start, fileSize);
      if (buffer === null) return absent;

      const { moovOffset, nextOffset } = findMoovOffset(buffer, start, fileSize);

      if (moovOffset !== null) {
        const time = readCreationTime(buffer, moovOffset - start);
        // `moov` was reached: a missing codec is an answer, not missing data, and the
        // empty string avoids reopening the file on every sync to reread its absence.
        const codec = readVideoCodec(buffer, moovOffset - start) ?? '';
        if (time !== null) return { time, codec };
        // `moov` is present but its `mvhd` exceeds the window: reopen on the box itself.
        // If the window already began there, nothing more can be read and retrying loops.
        if (moovOffset === start) return { time: null, codec };
        start = moovOffset;
        continue;
      }

      if (nextOffset === null) return absent;
      start = nextOffset;
    }

    return absent;
  }

  /** One header window, or `null` if Drive did not return it. */
  private async readWindow(
    fileId: string,
    start: number,
    fileSize: number,
  ): Promise<Buffer | null> {
    const end = Math.min(start + HEADER_WINDOW_BYTES, fileSize) - 1;
    if (end < start) return null;

    try {
      const response = await this.drive.guard(() =>
        this.drive.fetchFile(
          fileId,
          `bytes=${start}-${end}`,
          AbortSignal.timeout(HEADER_TIMEOUT_MS),
        ),
      );
      if (!response.ok && response.status !== 206) return null;
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      // Revoked authorisation fails the rest of sync; propagating it avoids dating 300
      // videos by upload time before noticing.
      if (error instanceof DriveRevokedError) throw error;
      this.log.warn(
        `Header of video ${fileId} unreadable: ${(error as Error).message} — ` +
          'the date comes from the file name or its modification date.',
      );
      return null;
    }
  }
}
