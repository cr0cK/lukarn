import { access } from 'node:fs/promises';
import { cpus } from 'node:os';
import sharp from 'sharp';
import type { ThumbSize } from '@lukarn/shared';
import type { StorageProvider } from '../storage/provider.js';
import type { MediaCache } from './cache.js';
import { Semaphore, renderConcurrencyFor } from './semaphore.js';

/** Longest edge of the "full-screen" render. Further resolution is invisible. */
const FULL_MAX_EDGE = 2560;
/**
 * Longest edge of the zoom render. 4096 px covers the native resolution of almost all
 * cameras and phones; beyond that, enlargement only reveals sensor noise.
 *
 * `withoutEnlargement` avoids inventing pixels: a 3000 px photo remains 3000 px and
 * zoom stops at its actual resolution.
 */
const HD_MAX_EDGE = 4096;

/**
 * Beyond this, the original is not decoded locally and goes straight to the backend
 * preview fallback.
 *
 * The limiter bounds the **number** of renders, not their size, and each render loads
 * its entire original into memory for sharp. Its maximum four slots
 * (`renderConcurrencyFor`) filled with 300 MB files can crash the process and take
 * down the whole gallery for a handful of photos. 80 MB admits everything a camera
 * produces, including RAW, while stopping content no longer resembling a photo: a
 * stitched panorama, a very large scan or a video misclassified by MIME type.
 */
const MAX_DECODE_BYTES = 80 * 1024 * 1024;

/**
 * WebP encoding effort. Measured on an 8 MB DSLR JPEG reduced to 2560 px on the
 * development machine:
 *
 * | effort | time    | size    |
 * | ------ | ------- | ------- |
 * | 0      |  707 ms | 1262 Ko |
 * | 2      |  898 ms | 1206 Ko |
 * | 4      | 1526 ms | 1186 Ko |
 * | 6      | 3792 ms | 1155 Ko |
 *
 * Moving from 4 to 2 saves 600 ms from a ~3.5 s first opening for 1.7% more size.
 * Size is paid once over a local network or fibre; waiting is paid on every never-opened
 * photo in front of the screen. Dropping to 0 saves another 200 ms but costs 6% — a
 * worse tradeoff.
 */
const WEBP_EFFORT = 2;

const THUMB_QUALITY = 78;
const FULL_QUALITY = 82;
/** More generous than `full`: this is the variant viewed closely. */
const HD_QUALITY = 88;

export type Variant = { kind: 'thumb'; size: ThumbSize } | { kind: 'full' } | { kind: 'hd' };

/**
 * Where rendering starts.
 *
 * `original` decodes the stored file and falls back to the backend's own preview only
 * if that fails. `poster` goes straight to the preview: this is the video case, which
 * is not decoded here (D92). Without this shortcut, every thumbnail would fetch a
 * 48 MB MP4 only for `MAX_DECODE_BYTES` to discard it.
 */
export type RenderOrigin = 'original' | 'poster';

export interface Rendered {
  path: string;
  contentType: string;
}

interface Logger {
  warn: (msg: string) => void;
  debug?: (msg: string) => void;
}

/**
 * Cache key for a derivative.
 *
 * The content fingerprint (`md5`, whatever the backend guarantees changes with the
 * bytes) is included: a storage keeps a file's identifier when content is replaced
 * with a new version, and without the fingerprint the cache would serve the old image
 * indefinitely. Rare files lack it and fall back to the identifier alone, preserving
 * previous behaviour.
 */
function variantKey(fileId: string, variant: Variant, md5: string | null): string {
  const kind = variant.kind === 'thumb' ? `t${variant.size}` : variant.kind;
  return md5 ? `${fileId}:${md5}:${kind}` : `${fileId}:${kind}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Maximum edge and WebP quality for each variant. */
function encodingFor(variant: Variant): { edge: number; quality: number } {
  switch (variant.kind) {
    case 'thumb':
      return { edge: variant.size, quality: THUMB_QUALITY };
    case 'full':
      return { edge: FULL_MAX_EDGE, quality: FULL_QUALITY };
    case 'hd':
      return { edge: HD_MAX_EDGE, quality: HD_QUALITY };
  }
}

/**
 * Produces WebP derivatives served to the browser, with a disk cache.
 *
 * The sensitive point is an album's first load: the grid requests dozens of thumbnails
 * at once, and without care the same file could be downloaded concurrently several
 * times. Active renders are deduplicated by key, so a burst for one thumbnail triggers
 * only one download from the storage.
 */
export class MediaRenderer {
  private readonly inFlight = new Map<string, Promise<Rendered>>();
  private readonly places: Semaphore;

  constructor(
    private readonly storage: StorageProvider,
    private readonly cache: MediaCache,
    private readonly log: Logger,
    concurrency = renderConcurrencyFor(cpus().length),
  ) {
    this.places = new Semaphore(concurrency);
  }

  /** Active and queued renders. Exposed in /admin for diagnostics. */
  get load(): { running: number; waiting: number; limit: number } {
    return {
      running: this.places.enCours,
      waiting: this.places.enAttente,
      limit: this.places.limite,
    };
  }

  /**
   * Is this derivative already cached? This lets `prepare` skip existing content
   * without marking it viewed — otherwise prewarming would protect from eviction what
   * nobody opened. Variant keys stay in this module, which knows they include the
   * content fingerprint.
   */
  isCached(fileId: string, variant: Variant, md5: string | null): boolean {
    return this.cache.has(variantKey(fileId, variant, md5));
  }

  /** `md5` comes from the index and identifies the file version. */
  async render(
    fileId: string,
    variant: Variant,
    md5: string | null = null,
    origin: RenderOrigin = 'original',
  ): Promise<Rendered> {
    const key = variantKey(fileId, variant, md5);

    const cached = this.cache.hit(key);
    // Inventory may reference a missing file: "clear cache" from /admin removes the
    // directory while a grid loads, and the volume may be cleaned manually. Without
    // this check, `createReadStream` would fail with ENOENT after headers were sent,
    // leaving a broken image that is not regenerated.
    if (cached && (await exists(cached))) return { path: cached, contentType: 'image/webp' };

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const task = this.produce(fileId, variant, key, origin).finally(() =>
      this.inFlight.delete(key),
    );
    this.inFlight.set(key, task);
    return task;
  }

  /**
   * Prepares several variants of one file and returns the number of derivatives
   * actually produced — zero if everything was cached.
   *
   * A separate path from `render()` for a measured reason: producing a derivative
   * costs around two seconds of download for fifty milliseconds of rendering. Three
   * `render()` calls for one photo's sizes would download the same original three
   * times — three times the traffic and pass duration — when one download suffices.
   *
   * One limiter slot covers the set: the in-memory original is the expensive part and
   * is shared by all variants. These renders bypass `inFlight`: deduplication serves
   * grid bursts for one thumbnail, not a background pass visiting each photo once.
   */
  async prepare(
    fileId: string,
    variants: Variant[],
    md5: string | null = null,
    origin: RenderOrigin = 'original',
  ): Promise<number> {
    // Largest to smallest: the first variant is the template for the backend-preview
    // fallback, and starting smallest would make `withoutEnlargement` fix all later
    // variants at that size.
    const manquantes = variants
      .filter((variant) => !this.isCached(fileId, variant, md5))
      .sort((a, b) => encodingFor(b).edge - encodingFor(a).edge);
    if (manquantes.length === 0) return 0;

    return this.places.run(async () => {
      const premiere = manquantes[0]!;
      let source: Buffer;

      try {
        source =
          origin === 'poster'
            ? await this.providerPreview(fileId, premiere)
            : await this.download(fileId);
        // The first conversion doubles as a decode test: it switches formats bundled
        // libvips cannot read to the backend preview, exactly like a requested render.
        await this.store(fileId, premiere, md5, source);
      } catch (error) {
        // In `poster`, the backend preview **is** the fallback; requesting it again
        // after failure would only repeat the same call.
        if (origin === 'poster') throw error;
        this.log.warn(
          `Local decoding impossible for ${fileId} (${(error as Error).message}), ` +
            'falling back to the preview held by the storage',
        );
        source = await this.providerPreview(fileId, premiere);
        await this.store(fileId, premiere, md5, source);
      }

      for (const variant of manquantes.slice(1)) {
        await this.store(fileId, variant, md5, source);
      }
      return manquantes.length;
    });
  }

  /**
   * The slot is taken **before** downloading, not only around decoding: the in-memory
   * original is heaviest, and waiting with nine megabytes already loaded would limit
   * nothing.
   */
  private produce(
    fileId: string,
    variant: Variant,
    key: string,
    origin: RenderOrigin,
  ): Promise<Rendered> {
    return this.places.run(() => this.build(fileId, variant, key, origin));
  }

  private async store(
    fileId: string,
    variant: Variant,
    md5: string | null,
    source: Buffer,
  ): Promise<void> {
    await this.cache.put(variantKey(fileId, variant, md5), await this.transform(source, variant));
  }

  private async build(
    fileId: string,
    variant: Variant,
    key: string,
    origin: RenderOrigin,
  ): Promise<Rendered> {
    let output: Buffer;

    try {
      const source =
        origin === 'poster'
          ? await this.providerPreview(fileId, variant)
          : await this.download(fileId);
      output = await this.transform(source, variant);
    } catch (error) {
      // In `poster`, the backend preview **is** the source: there is no original behind
      // it to decode and nothing more for fallback to attempt.
      if (origin === 'poster') throw error;
      // Formats bundled libvips cannot decode (some HEIC and proprietary RAW), and
      // files too large for memory: a backend that holds a JPEG preview can serve it,
      // so restart there. Downloading is inside `try` so the second case takes this
      // path — otherwise a photo the storage can display would only return an error.
      this.log.warn(
        `Local decoding impossible for ${fileId} (${(error as Error).message}), ` +
          'falling back to the preview held by the storage',
      );
      const fallback = await this.providerPreview(fileId, variant);
      output = await this.transform(fallback, variant);
    }

    const path = await this.cache.put(key, output);
    return { path, contentType: 'image/webp' };
  }

  private async transform(source: Buffer, variant: Variant): Promise<Buffer> {
    const { edge, quality } = encodingFor(variant);

    return (
      sharp(source, { failOn: 'error' })
        // `rotate()` without arguments applies EXIF orientation; without it, portrait
        // photos appear sideways.
        .rotate()
        .resize({
          width: edge,
          height: edge,
          fit: 'inside',
          // Never upsample: a small image remains at its own size.
          withoutEnlargement: true,
        })
        .webp({ quality, effort: WEBP_EFFORT })
        .toBuffer()
    );
  }

  /**
   * In-memory original, refused above `MAX_DECODE_BYTES`.
   *
   * The size announced by the storage is checked before reading the body to avoid
   * allocation, but the body is measured too: a missing or false header must not crash
   * the process.
   */
  private async download(fileId: string): Promise<Buffer> {
    // `guard` is what turns a withdrawn authorisation into a 503 the browser retries:
    // without it, opening a photo after a revoked token produced a bare 500.
    const response = await this.storage.guard(() => this.storage.fetch(fileId));

    const annoncee = Number(response.headers.get('content-length'));
    if (Number.isFinite(annoncee) && annoncee > MAX_DECODE_BYTES) {
      throw new Error(`original of ${Math.round(annoncee / 1024 / 1024)} MB, too heavy to decode`);
    }

    const source = Buffer.from(await response.arrayBuffer());
    if (source.byteLength > MAX_DECODE_BYTES) {
      throw new Error(
        `original of ${Math.round(source.byteLength / 1024 / 1024)} MB, too heavy to decode`,
      );
    }
    return source;
  }

  /**
   * The preview the backend already holds, at the requested render size.
   *
   * A backend that holds none answers `null`, and that is a failure here: this path is
   * only ever taken because the original could not be decoded, so there is nothing
   * left to serve. The message says which file, because the alternative — a HEIC
   * silently missing from the grid — is what makes it hard to diagnose.
   */
  private async providerPreview(fileId: string, variant: Variant): Promise<Buffer> {
    const response = await this.storage.guard(() =>
      this.storage.preview(fileId, encodingFor(variant).edge),
    );

    if (!response) {
      throw new Error(`The storage holds no preview for ${fileId}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}
