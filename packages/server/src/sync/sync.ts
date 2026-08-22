import type { MediaRepo, MediaUpsert, SyncStateRepo } from '../repo.js';
import {
  StorageRevokedError,
  type ProviderMediaMetadata,
  type StorageEntry,
  type StoragePage,
  type StorageProvider,
} from '../storage/provider.js';
import { findExifSegment } from './exif.js';
import {
  classify,
  fromExifBlock,
  mediaId,
  resolveVideoTakenAt,
  type VideoTakenAt,
} from './metadata.js';
import { findMoovOffset, readCreationTime, readVideoCodec } from './mp4.js';

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
 * Header-read timeout. `StorageProvider.fetch` sets none for a `Range` request because
 * it relays video to a browser consuming at its own pace. Here, a silent connection
 * would block the whole sync and leave the album `running` indefinitely.
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
  /** Which storage connection holds this album's container. */
  connectionId: string;
  folderId: string;
  recursive: boolean;
}

/**
 * What the syncer needs from the registry, and nothing more: the provider an album
 * reads. Declared here rather than imported so a test can hand over one function.
 */
export interface ProviderSource {
  get(connectionId: string): StorageProvider;
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
  return `${album.connectionId}:${album.folderId}:${album.recursive ? 'recursif' : 'plat'}`;
}

/**
 * Album indexing: traverses a storage container and copies metadata into the database.
 *
 * Nothing is downloaded when the backend already knows what the picture holds —
 * Drive returns dimensions, capture date and EXIF data in the listing itself, making
 * the sync of several thousand photos almost instantaneous and cheap in quota (D3).
 * What the backend does not supply, `StorageEntry.media` reports as `null`.
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
    private readonly storage: ProviderSource,
    private readonly media: MediaRepo,
    private readonly syncState: SyncStateRepo,
    private readonly log: Logger,
  ) {}

  isRunning(albumId: string): boolean {
    return this.running.has(albumId);
  }

  /**
   * Starts sync or returns the one already running for this album **with the same
   * configuration**. Changing the folder during sync makes the old pass unusable:
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

  /**
   * Sequential sync of all albums, to conserve whatever quota each storage counts.
   *
   * A withdrawn authorisation skips the **rest of that connection** rather than
   * stopping everything: every following album on it would fail identically, but an
   * album on another storage has nothing to do with the token Google refused. Before
   * there were several connections this was a `break`, which is now the wrong answer.
   */
  async syncAll(albums: SyncAlbum[]): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    const revoked = new Set<string>();

    for (const album of albums) {
      if (revoked.has(album.connectionId)) continue;
      try {
        results.push(await this.sync(album));
      } catch (error) {
        this.log.error(`Sync of "${album.id}" failed: ${(error as Error).message}`);
        // The error already written to `sync_state` explains what happened.
        if (error instanceof StorageRevokedError) revoked.add(album.connectionId);
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
      // Resolved once per pass: the provider holds an authorised client, and asking
      // the registry per folder would rebuild nothing but would hide where the
      // album's storage is decided.
      const storage = this.storage.get(album.connectionId);
      const pending = [album.folderId];
      let indexed = 0;
      let batch: MediaUpsert[] = [];

      while (pending.length > 0) {
        const container = pending.pop()!;
        // Drive shortcuts can form cycles; without this guard traversal would not end.
        if (visited.has(container)) continue;
        visited.add(container);

        if (visited.size > MAX_FOLDERS) {
          throw new Error(
            `More than ${MAX_FOLDERS} folders walked for album "${album.id}" — ` +
              'target a more specific folder, or set `recursive: false`.',
          );
        }

        for await (const entry of this.listFolder(storage, container)) {
          if (entry.folder) {
            if (album.recursive) pending.push(entry.ref);
            continue;
          }

          const item = await this.toUpsert(storage, album, entry);
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
       * in the storage. The album remains browsable and consistent, merely incomplete.
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
    storage: StorageProvider,
    container: string,
  ): AsyncGenerator<StorageEntry> {
    let cursor: string | null = null;

    do {
      // `guard` translates a withdrawn authorisation into StorageRevokedError and marks
      // the connection revoked; otherwise every album would fail with a technical
      // message that never says access must be reauthorised.
      const page: StoragePage = await storage.guard(() => storage.list(container, cursor));

      for (const entry of page.entries) {
        yield entry;
      }
      cursor = page.cursor;
    } while (cursor !== null);
  }

  private async toUpsert(
    storage: StorageProvider,
    album: SyncAlbum,
    entry: StorageEntry,
  ): Promise<MediaUpsert | null> {
    const kind = classify(entry.mimeType);
    if (!kind) return null;

    // A backend whose references are locations cannot use one as an identifier: two
    // connections may hold the same path, and it changes the day the file is renamed.
    // The path is kept so the media routes can still ask for the bytes.
    const path = storage.refKind === 'path';
    const id = path ? mediaId(album.connectionId, entry.ref) : entry.ref;

    // Drive delivers this in the listing itself; every other backend hands over bytes
    // and the EXIF block is read from the front of the file (D260816b).
    const media =
      entry.media ??
      (kind === 'photo' ? await this.photoMetadata(storage, album.id, id, entry) : null);

    // Without a capture date (screenshots, re-encoded photos), the file's modification
    // time is the only chronological reference. Videos never carry one and are dated
    // from their file (D97), which also yields the codec in the same window pass
    // (D6).
    const { takenAt, fromFile, videoCodec } =
      kind === 'video'
        ? await this.videoHeader(storage, album.id, id, entry)
        : {
            takenAt: media?.takenAt ?? entry.modifiedTime,
            fromFile: media?.takenAt != null,
            videoCodec: null,
          };

    // The grid calculates rows from these dimensions, so restoring the order of a
    // rotated photo here prevents distorted thumbnails before loading.
    const rotated = media?.rotated === true;
    const width = media?.width ?? null;
    const height = media?.height ?? null;

    return {
      albumId: album.id,
      id,
      sourcePath: path ? entry.ref : null,
      name: entry.name,
      mimeType: entry.mimeType ?? 'application/octet-stream',
      kind,
      size: entry.size,
      width: rotated ? height : width,
      height: rotated ? width : height,
      takenAt,
      takenAtFromExif: fromFile,
      modifiedTime: entry.modifiedTime,
      durationMs: media?.durationMs ?? null,
      cameraMake: media?.cameraMake ?? null,
      cameraModel: media?.cameraModel ?? null,
      lens: media?.lens ?? null,
      isoSpeed: media?.isoSpeed ?? null,
      exposureTime: media?.exposureTime ?? null,
      aperture: media?.aperture ?? null,
      focalLength: media?.focalLength ?? null,
      lat: media?.lat ?? null,
      lng: media?.lng ?? null,
      md5: entry.version,
      hasThumbnail: entry.hasPreview,
      videoCodec,
    };
  }

  /**
   * A photograph's metadata, read out of the first bytes of the file.
   *
   * One ranged request per **new** photograph, and none afterwards: while the version
   * the backend reports is unchanged the bytes are unchanged, so rereading them would
   * return exactly what the index already holds. Without that shortcut, resyncing a
   * library of five thousand photographs would fetch three hundred megabytes an hour to
   * learn nothing.
   *
   * `null` is the ordinary answer for a screenshot or a re-encoded photograph, and for
   * a window that did not reach the block. The caller then dates the file by its
   * modification time, exactly as before any of this existed.
   */
  private async photoMetadata(
    storage: StorageProvider,
    albumId: string,
    id: string,
    entry: StorageEntry,
  ): Promise<ProviderMediaMetadata | null> {
    const known = this.media.indexedMedia(albumId, id);
    if (known && entry.version !== null && known.md5 === entry.version) return known.media;

    const window = await this.readWindow(storage, entry.ref, 0, entry.size ?? HEADER_WINDOW_BYTES);
    if (window === null) return null;

    const block = findExifSegment(window);
    return block ? fromExifBlock(block) : null;
  }

  /**
   * Video capture date (D97) and video-track codec (D6), reconstructed from the
   * file in one read.
   *
   * The version shortcut makes video-album sync repeatable: a video already dated from
   * its unchanged file keeps that date without rereading a byte. A video left on
   * `modifiedTime` because its header or the storage was unavailable is retried next
   * pass.
   *
   * `videoCodec` participates in the condition, populating the column without a data
   * migration: older rows have a file-derived date but no codec, so they are reread
   * **once** and then shortcut like the others.
   */
  private async videoHeader(
    storage: StorageProvider,
    albumId: string,
    id: string,
    entry: StorageEntry,
  ): Promise<VideoHeader> {
    const version = entry.version;
    // The index is keyed by identifier, the storage by reference: on a path-based
    // backend they differ, and asking the index for `entry.ref` would find nothing and
    // reread every video header on every pass.
    const known = this.media.fileTakenAt(albumId, id);
    if (
      known?.takenAtFromExif &&
      version !== null &&
      known.md5 === version &&
      known.videoCodec !== null
    ) {
      return { takenAt: known.takenAt, fromFile: true, videoCodec: known.videoCodec };
    }

    const header = await this.containerHeader(storage, entry.ref, entry.size);
    return {
      ...resolveVideoTakenAt({
        name: entry.name,
        containerTime: header.time,
        durationMs: entry.media?.durationMs ?? null,
        modifiedTime: entry.modifiedTime,
      }),
      videoCodec: header.codec,
    };
  }

  /**
   * What `moov` carries, following top-level boxes across windows. Everything is
   * `null` when the file cannot be read — non-ISOBMFF, unreachable `moov`, unavailable
   * storage — so the caller falls back to name, then modification date.
   *
   * Both reads share a window because they share a box: separating them would double
   * `Range` requests for a video-album sync to reread the same bytes.
   */
  private async containerHeader(
    storage: StorageProvider,
    ref: string,
    fileSize: number | null,
  ): Promise<ContainerHeader> {
    const absent: ContainerHeader = { time: null, codec: null };

    // Without a reported size the chain cannot be bounded: a zero-size box runs "to
    // the end", which would be unknown.
    if (fileSize === null || fileSize <= 0) return absent;

    let start = 0;

    for (let fenetre = 0; fenetre < HEADER_MAX_WINDOWS; fenetre++) {
      const buffer = await this.readWindow(storage, ref, start, fileSize);
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

  /** One header window, or `null` if the storage did not return it. */
  private async readWindow(
    storage: StorageProvider,
    ref: string,
    start: number,
    fileSize: number,
  ): Promise<Buffer | null> {
    const end = Math.min(start + HEADER_WINDOW_BYTES, fileSize) - 1;
    if (end < start) return null;

    try {
      const response = await storage.guard(() =>
        storage.fetch(ref, `bytes=${start}-${end}`, AbortSignal.timeout(HEADER_TIMEOUT_MS)),
      );
      if (!response.ok && response.status !== 206) return null;
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      // Revoked authorisation fails the rest of sync; propagating it avoids dating 300
      // videos by upload time before noticing.
      if (error instanceof StorageRevokedError) throw error;
      this.log.warn(
        `Header of ${ref} unreadable: ${(error as Error).message} — ` +
          'the date comes from the file name or its modification date.',
      );
      return null;
    }
  }
}
