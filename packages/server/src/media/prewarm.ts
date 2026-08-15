import { THUMB_SIZES } from '@lukarn/shared';
import type { MediaRepo } from '../repo.js';
import type { StorageProvider } from '../storage/provider.js';
import type { MediaCache } from './cache.js';
import type { MediaRenderer, Variant } from './renderer.js';

/**
 * Prepares thumbnails before the album is opened — photos and videos for which the
 * storage provides a preview.
 *
 * The observation behind it: a never-rendered photo costs around two seconds on first
 * display — almost all spent downloading the original, since thumbnail rendering is
 * negligible — versus five milliseconds once cached. A cold grid requests dozens at
 * once, while the limiter serves only two to four depending on core count, making the
 * album take tens of seconds to appear. Prewarming moves this wait away from a viewer;
 * it consumes a storage's quota earlier, not more of it.
 *
 * The precautions that make it acceptable explain its deliberate slowness — see D45.
 */

/**
 * What prewarming prepares: the three thumbnail sizes and **nothing else**.
 *
 * The grid causes the wait and requests only these — the chosen one depends on tile
 * width and screen density, so all three must be ready. Full-page rendering never
 * happens here: it weighs around ten thumbnails, and preloading neighbours in the
 * viewer already covers browsing.
 */
const VARIANTS: Variant[] = THUMB_SIZES.map((size) => ({ kind: 'thumb', size }));

/**
 * One photo at a time. The render limiter has two to four slots; by using only one,
 * prewarming always leaves room for someone browsing.
 */
const PAUSE_MS = 1_000;

/**
 * Share of the cache prewarming may occupy. Eviction is **global** LRU, not per album:
 * without this reserve, preparing a whole album would evict thumbnails from albums
 * people actually view.
 */
const BUDGET_RATIO = 0.7;

/**
 * Renders per pass. Housekeeping is hourly; beyond this, one pass would overlap the
 * next without benefit, as the album fills hour by hour anyway.
 */
const MAX_PER_RUN = 400;

/** Photos read from the index at once. Bounded because `listItems` is synchronous. */
const PAGE_SIZE = 200;

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  debug: (msg: string) => void;
}

export interface PrewarmDeps {
  /** Read again on every pass so an album created since startup is included too. */
  albums: () => { id: string; connectionId: string }[];
  media: MediaRepo;
  cache: MediaCache;
  renderer: MediaRenderer;
  /** The storage an album reads. Resolved per album, once. */
  storage: (connectionId: string) => StorageProvider;
  /** Read on every pass so disabling the setting stops the current pass. */
  enabled: () => boolean;
  log: Logger;
}

export interface PrewarmResult {
  rendered: number;
  skipped: number;
  failed: number;
  stopped: 'finished' | 'budget' | 'ceiling' | 'stopped';
}

export class CachePrewarmer {
  private running = false;
  private stopping = false;

  constructor(private readonly deps: PrewarmDeps) {}

  /** Requests that the current pass stop. Called during server shutdown. */
  stop(): void {
    this.stopping = true;
  }

  /**
   * One pass, newest to oldest.
   *
   * Order is not cosmetic: people open photos from recent albums, and LRU removes old
   * ones itself. Prewarming chronologically would fill the cache with what nobody
   * views anymore.
   */
  async run(): Promise<PrewarmResult> {
    const result: PrewarmResult = { rendered: 0, skipped: 0, failed: 0, stopped: 'finished' };

    // Two concurrent passes would double limiter occupancy and storage traffic, exactly
    // what the design avoids.
    if (this.running || !this.deps.enabled()) return result;
    this.running = true;
    this.stopping = false;

    try {
      for (const album of this.deps.albums()) {
        let storage: StorageProvider;
        try {
          storage = this.deps.storage(album.connectionId);
        } catch (error) {
          // A connection this version cannot build, or one an album still names after
          // a hand-edited database: the other albums have nothing to do with it.
          this.deps.log.warn(`Prewarming skips "${album.id}": ${(error as Error).message}`);
          continue;
        }

        let cursor: string | null = null;

        do {
          const page = this.deps.media.listItems(album.id, PAGE_SIZE, cursor, 'desc');
          cursor = page.nextCursor;

          for (const item of page.items) {
            if (this.stopping) return { ...result, stopped: 'stopped' };
            if (!this.deps.enabled()) return { ...result, stopped: 'stopped' };
            if (result.rendered >= MAX_PER_RUN) return { ...result, stopped: 'ceiling' };

            const { bytes, maxBytes } = this.deps.cache.stats();
            if (bytes >= maxBytes * BUDGET_RATIO) return { ...result, stopped: 'budget' };

            // A video whose storage holds no preview has no image to prepare — the
            // route returns 415. `hasPreview` is always true for photos, so none are
            // excluded.
            if (!item.hasPreview) continue;

            const md5 = this.deps.media.getFileMeta(item.id)?.md5 ?? null;

            try {
              // All three sizes from one download: downloading is expensive, and doing
              // it per variant would triple the traffic and the pass duration. A video
              // costs less than a photo: the preview its storage holds weighs tens of
              // KB, versus several MB for an original.
              const produits = await this.deps.renderer.prepare(
                storage,
                item.id,
                VARIANTS,
                md5,
                item.kind === 'video' ? 'poster' : 'original',
              );
              // Nothing to do: the photo was ready, so there is no reason to pause —
              // otherwise an already prewarmed album would consume a whole pass doing
              // nothing for one second per photo.
              if (produits === 0) {
                result.skipped++;
                continue;
              }
              result.rendered++;
            } catch (error) {
              // An unreadable file or a refusal from the storage must not stop the
              // pass: subsequent photos are unrelated, and the next pass retries this one.
              result.failed++;
              this.deps.log.debug(`Prewarming ${item.id} failed: ${(error as Error).message}`);
            }

            await this.wait(PAUSE_MS);
          }
        } while (cursor !== null);
      }

      return result;
    } finally {
      this.running = false;
      if (result.rendered > 0 || result.failed > 0) {
        this.deps.log.info(
          `Prewarm: ${result.rendered} rendered, ${result.skipped} already cached, ` +
            `${result.failed} failed (${result.stopped})`,
        );
      }
    }
  }

  /**
   * `protected` for the same reason as in `DriveService`: this seam lets tests verify
   * the cadence without waiting through it.
   */
  protected wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
