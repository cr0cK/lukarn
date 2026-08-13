import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ICON_VARIANTS, type IconName } from '@lukarn/shared';
import sharp from 'sharp';
import { Semaphore } from '../media/semaphore.js';
import { renderMark } from './mark.js';

/**
 * The instance's logo on disk, and the icons derived from it.
 *
 * Lives under `DATA_DIR/branding/`, which `deploy/backup.sh` archives whole: a
 * custom logo survives a restore with no change to the script. Deliberately not
 * `CACHE_DIR` — the cache is disposable by design, and the upload is not.
 *
 * **Uploads are rasterised to PNG on the way in, whatever arrived** (D260813b).
 * That is the security answer, rather than a `Content-Type` check: no
 * operator-supplied SVG is ever served, so `<script>`, `onload=` and
 * `<foreignObject>` never reach a same-origin document that would run them.
 * sharp already reads SVG, so accepting one costs nothing.
 */

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

/** Widest side kept for an upload: enough for the 512 px manifest icon, no more. */
const STORED_EDGE = 512;

/** The mark's own viewBox side, from which its rasterisation density is derived. */
const MARK_EDGE = 256;

/** What a branding route sends: bytes, their type, and what identifies them. */
export interface BrandingAsset {
  body: Buffer;
  contentType: string;
  /** Quoted ETag, already in header form. */
  etag: string;
}

export class BrandingStore {
  private readonly logoPath: string;
  private readonly generatedDir: string;
  /**
   * Fingerprint of the stored upload, `null` when there is none. Held in memory
   * because it goes into every `ETag`: hashing the file per request would read it
   * from disk to answer a conditional request whose whole point is not to.
   */
  private uploaded: string | null = null;
  /**
   * One image at a time. Same reason as `MediaRenderer`: rasterising holds the whole
   * bitmap in memory, and a cold home screen requests four icons at once.
   */
  private readonly places = new Semaphore(1);

  constructor(
    private readonly root: string,
    private readonly log: Logger,
  ) {
    this.logoPath = join(root, 'logo.png');
    this.generatedDir = join(root, 'generated');
  }

  /**
   * Notes whether an upload is present. Called once at startup, like the media
   * cache's inventory: every later change goes through this object.
   */
  async load(): Promise<void> {
    if (!existsSync(this.logoPath)) return;
    try {
      this.uploaded = fingerprint(await readFile(this.logoPath));
      this.log.info('Custom logo loaded from the branding directory.');
    } catch (error) {
      // A logo that cannot be read must not prevent startup: the built-in mark is
      // a complete fallback, and the gallery matters more than its badge.
      this.log.warn(
        `Unreadable custom logo, falling back to the mark: ${(error as Error).message}`,
      );
    }
  }

  /** `true` when an operator has uploaded a logo of their own. */
  get custom(): boolean {
    return this.uploaded !== null;
  }

  /**
   * The logo as served: the upload's PNG, or the built-in mark as SVG.
   *
   * SVG for the mark rather than a rasterisation: it is the favicon, the sign-in
   * badge and the top-bar mark all at once, at four different sizes, and it is four
   * shapes — a vector costs less than the smallest of those PNGs.
   */
  async logo(primary: string): Promise<BrandingAsset> {
    if (!this.uploaded) {
      const mark = renderMark(primary);
      return {
        body: Buffer.from(mark),
        contentType: 'image/svg+xml; charset=utf-8',
        etag: `"${fingerprint(mark)}"`,
      };
    }
    return {
      body: await readFile(this.logoPath),
      contentType: 'image/png',
      etag: `"${this.uploaded}"`,
    };
  }

  /**
   * A generated icon, rendered on first miss and kept on disk.
   *
   * The whole directory is discarded whenever branding changes rather than one
   * entry being replaced: four small files are cheaper to rebuild than a rule
   * deciding which of them a colour change invalidated.
   */
  async icon(name: IconName, primary: string): Promise<BrandingAsset> {
    const variant = ICON_VARIANTS[name];
    const path = join(this.generatedDir, name);
    const etag = `"${fingerprint(`${this.uploaded ?? 'mark'}-${primary}-${name}`)}"`;

    if (existsSync(path)) {
      return { body: await readFile(path), contentType: 'image/png', etag };
    }

    const body = await this.places.run(async () => {
      const inner = Math.round(variant.size * variant.inset);
      const scaled = await sharp(await this.source(primary), {
        failOn: 'error',
        // The mark is a vector: rasterise it **at** the size it will be used at.
        // Left at the default 72 dpi it would render at its declared 256 px and
        // then be enlarged to 512, softening the corners and the dot. Ignored for
        // an uploaded PNG, which carries its own pixels.
        ...(this.uploaded ? {} : { density: Math.ceil((72 * inner) / MARK_EDGE) }),
      })
        .resize({ width: inner, height: inner, fit: 'inside' })
        .png()
        .toBuffer();

      return sharp({
        create: {
          width: variant.size,
          height: variant.size,
          channels: 4,
          background: variant.background ?? { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{ input: scaled, gravity: 'center' }])
        .png({ compressionLevel: 9 })
        .toBuffer();
    });

    await mkdir(this.generatedDir, { recursive: true });
    await writeFile(path, body);
    return { body, contentType: 'image/png', etag };
  }

  /**
   * Replaces the logo with the image supplied, rasterised to PNG.
   *
   * Throws when sharp cannot read it: the caller turns that into a 400. An
   * unreadable upload silently ignored would leave the previous logo in place with
   * a success reported to the person who just replaced it.
   */
  async replace(input: Buffer): Promise<void> {
    const png = await this.places.run(() =>
      sharp(input, {
        failOn: 'error',
        // An SVG carries no pixels: without a density it rasterises at 72 dpi,
        // which turns a 24-unit icon into 24 px before anything can enlarge it.
        density: 384,
      })
        .resize({
          width: STORED_EDGE,
          height: STORED_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    );

    await mkdir(this.root, { recursive: true });
    await writeFile(this.logoPath, png);
    this.uploaded = fingerprint(png);
    await this.clearGenerated();
  }

  /** Returns to the built-in mark. `false` when there was nothing to remove. */
  async reset(): Promise<boolean> {
    if (!this.uploaded) return false;
    await rm(this.logoPath, { force: true });
    this.uploaded = null;
    await this.clearGenerated();
    return true;
  }

  /**
   * Discards every derived size. Also called when settings change: the built-in
   * mark's dot carries the primary colour, so a colour change makes all four stale.
   */
  async clearGenerated(): Promise<void> {
    await rm(this.generatedDir, { recursive: true, force: true });
  }

  /** What a generation starts from: the upload, or the mark as it stands. */
  private async source(primary: string): Promise<Buffer> {
    return this.uploaded ? readFile(this.logoPath) : Buffer.from(renderMark(primary));
  }
}

/** Short content fingerprint, in the form an `ETag` needs. */
function fingerprint(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('base64url').slice(0, 16);
}
