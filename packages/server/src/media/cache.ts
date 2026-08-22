import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface CacheStats {
  entryCount: number;
  bytes: number;
  maxBytes: number;
}

interface Entry {
  size: number;
  /** Last-access timestamp held in memory — `atime` is unreliable on a `relatime`
   *  mount, the default on most VPSs. */
  lastAccess: number;
  /**
   * Strictly increasing stamp reassigned on every access. Eviction records it for
   * entries about to be deleted, then compares it again immediately before `rm`: this
   * is the only way to know an entry was touched meanwhile. `lastAccess` is insufficient —
   * two accesses in the same millisecond leave the same value.
   */
  stamp: number;
}

/** What the cache needs to report, and nothing more. */
interface CacheLogger {
  warn: (msg: string) => void;
}

const SILENT: CacheLogger = { warn: () => {} };

/**
 * Name of a cache shard: the first two hexadecimal characters of a key hash
 * (see `pathFor`).
 *
 * Inventory descends only into these, and clearing deletes only these. Without this
 * boundary, a cache mounted on `CACHE_DIR` would inventory the video store at
 * `CACHE_DIR/video` as its own — counting those bytes in its budget, while "clear
 * cache" from /admin would remove hours of transcoding with the thumbnails (D6).
 */
const RAYON = /^[0-9a-f]{2}$/;

/**
 * Disk cache for image derivatives (thumbnails and full-width renders). Each entry
 * is a file; the size inventory is held in memory to decide eviction without
 * traversing the directory tree again.
 *
 * An entry never needs invalidation: its key contains the Drive file ID, which changes
 * when the file is replaced.
 */
export class MediaCache {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  private evicting: Promise<void> | null = null;
  /** Source of access stamps. Never reset during the process lifetime. */
  private clock = 0;

  constructor(
    private readonly root: string,
    private maxBytes: number,
    private readonly log: CacheLogger = SILENT,
  ) {}

  /**
   * New size limit applied live from settings. Lowering it triggers eviction
   * immediately rather than on the next write: recovering space is precisely why the
   * limit is lowered.
   */
  setMaxBytes(bytes: number): void {
    this.maxBytes = bytes;
    this.evictInBackground();
  }

  /** Rebuilds inventory from disk. Call at startup. */
  async load(): Promise<void> {
    this.entries.clear();
    this.bytes = 0;
    await mkdir(this.root, { recursive: true });
    await this.scan(this.root);
  }

  private async scan(dir: string): Promise<void> {
    let listing;
    try {
      listing = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of listing) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        // A directory that is not a shard belongs to something else.
        if (RAYON.test(entry.name)) await this.scan(path);
        continue;
      }
      // Temporary files left by an interrupted write.
      if (entry.name.endsWith('.tmp')) {
        await rm(path, { force: true });
        continue;
      }
      try {
        const info = await stat(path);
        this.entries.set(path, { size: info.size, lastAccess: info.mtimeMs, stamp: ++this.clock });
        this.bytes += info.size;
      } catch {
        // File disappeared between readdir and stat: nothing to inventory.
      }
    }
  }

  /**
   * Path to the entry if cached, otherwise `null`. Marks the entry as used to delay
   * it in eviction order.
   */
  hit(key: string): string | null {
    const path = this.pathFor(key);
    const entry = this.entries.get(path);
    if (!entry) return null;
    entry.lastAccess = Date.now();
    entry.stamp = ++this.clock;
    return path;
  }

  /**
   * Is the entry inventoried? Unlike `hit`, does **not** affect eviction order:
   * prewarming checks the cache without pretending the photo was viewed, otherwise it
   * would protect from eviction content nobody opened.
   */
  has(key: string): boolean {
    return this.entries.has(this.pathFor(key));
  }

  /** Writes an entry and returns its path. Triggers eviction if needed. */
  async put(key: string, data: Buffer): Promise<string> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });

    // Write then rename: a concurrent reader never sees a partial file because rename
    // is atomic on the same file system.
    const temp = `${path}.${process.pid}.${this.entries.size}.tmp`;
    await writeFile(temp, data);
    await rename(temp, path);

    const previous = this.entries.get(path);
    if (previous) this.bytes -= previous.size;
    this.entries.set(path, {
      size: data.byteLength,
      lastAccess: Date.now(),
      stamp: ++this.clock,
    });
    this.bytes += data.byteLength;

    this.evictInBackground();
    return path;
  }

  /**
   * Stores a file **already written to disk** through a simple rename and returns its
   * cache path.
   *
   * `put` loads content into memory: harmless for a thumbnail of tens of KB, but not
   * for a 30 MB video derivative whose producer already writes a file.
   *
   * `source` must be on the **same file system** as the cache — hence transcoding writes
   * temporary files under the store root; otherwise `rename` would fail with `EXDEV`
   * after several minutes of work.
   */
  async putFile(key: string, source: string): Promise<string> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });

    // Size is read before renaming: afterwards the source path no longer exists, and
    // a `stat` on the destination would cost another syscall for the same value.
    const { size } = await stat(source);
    await rename(source, path);

    const previous = this.entries.get(path);
    if (previous) this.bytes -= previous.size;
    this.entries.set(path, { size, lastAccess: Date.now(), stamp: ++this.clock });
    this.bytes += size;

    this.evictInBackground();
    return path;
  }

  stats(): CacheStats {
    return { entryCount: this.entries.size, bytes: this.bytes, maxBytes: this.maxBytes };
  }

  /**
   * Clears only the cache's shards: `rm -rf` on the root would remove what another
   * store placed there — the video store lives under `CACHE_DIR/video`, and "clear
   * cache" must not cost hours of transcoding when recovering a few gigabytes of
   * thumbnails.
   */
  async clear(): Promise<void> {
    await mkdir(this.root, { recursive: true });

    const listing = await readdir(this.root, { withFileTypes: true });
    for (const entry of listing) {
      if (!entry.isDirectory() || !RAYON.test(entry.name)) continue;
      await rm(join(this.root, entry.name), { recursive: true, force: true });
    }

    this.entries.clear();
    this.bytes = 0;
  }

  /**
   * Eviction starts without being awaited — the caller has just written and need not
   * wait for cleanup. The `catch` is essential: without it, a failed `rm` (read-only
   * remount or I/O error) produces an unhandled rejection and Node terminates the
   * process. The whole gallery would go down because one cache file could not be removed.
   */
  private evictInBackground(): void {
    void this.evictIfNeeded().catch((error: unknown) => {
      this.log.warn(`Cache eviction interrupted: ${(error as Error).message}`);
    });
  }

  /**
   * Removes least recently used entries until usage falls to 90% of the limit:
   * evicting exactly to the limit would trigger eviction on every subsequent write.
   */
  private evictIfNeeded(): Promise<void> {
    if (this.bytes <= this.maxBytes) return Promise.resolve();
    // Only one eviction pass at a time, otherwise concurrent passes would each remove
    // enough to return below the limit.
    this.evicting ??= this.evict().finally(() => {
      this.evicting = null;
    });
    return this.evicting;
  }

  private async evict(): Promise<void> {
    const target = this.maxBytes * 0.9;
    // Order is fixed here, but every candidate is checked again before deletion: `rm`
    // yields to the event loop, so a request may serve the entry between sorting and `rm`.
    const ordered = [...this.entries.entries()]
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess)
      .map(([path, entry]) => ({ path, stamp: entry.stamp }));

    for (const candidate of ordered) {
      if (this.bytes <= target) break;

      const entry = this.entries.get(candidate.path);
      // Already gone or rewritten: nothing remains to evict at this path.
      if (!entry) continue;
      // Touched since sorting. Deleting it would make `createReadStream` fail with
      // `ENOENT` for the request that just asked for it.
      if (entry.stamp !== candidate.stamp) continue;

      try {
        await rm(candidate.path, { force: true });
      } catch (error) {
        // The entry remains inventoried: the file still exists, and forgetting it
        // would make `stats()` inaccurate and lose its size for later evictions.
        this.log.warn(`Cache entry not removable (${candidate.path}): ${(error as Error).message}`);
        continue;
      }

      this.entries.delete(candidate.path);
      this.bytes -= entry.size;
    }
  }

  /**
   * `cache/ab/<hash>.bin` — the hash avoids sanitising Drive IDs for file names, and
   * the two-character prefix distributes entries over 256 subdirectories rather than
   * creating one directory with 100,000 files.
   */
  private pathFor(key: string): string {
    const hash = createHash('sha256').update(key).digest('hex');
    return join(this.root, hash.slice(0, 2), `${hash.slice(2)}.bin`);
  }
}
