import sharp from 'sharp';
import type { ThumbSize } from '@gdv/shared';
import type { DriveService } from '../drive/service.js';
import type { MediaCache } from './cache.js';

/** Côté le plus long du rendu « plein écran ». Au-delà, le gain est invisible. */
const FULL_MAX_EDGE = 2560;
const THUMB_QUALITY = 78;
const FULL_QUALITY = 82;

export type Variant = { kind: 'thumb'; size: ThumbSize } | { kind: 'full' };

export interface Rendered {
  path: string;
  contentType: string;
}

interface Logger {
  warn: (msg: string) => void;
  debug?: (msg: string) => void;
}

function variantKey(fileId: string, variant: Variant): string {
  return variant.kind === 'thumb' ? `${fileId}:t${variant.size}` : `${fileId}:full`;
}

/**
 * Produit les dérivés WebP servis au navigateur, avec cache disque.
 *
 * Le point sensible est le premier chargement d'un album : la grille demande
 * des dizaines de vignettes à la fois, et sans précaution le même fichier
 * pourrait être téléchargé plusieurs fois en parallèle. Les rendus en cours
 * sont donc dédupliqués par clé, si bien qu'une rafale de requêtes sur la même
 * vignette ne déclenche qu'un seul téléchargement Drive.
 */
export class MediaRenderer {
  private readonly inFlight = new Map<string, Promise<Rendered>>();

  constructor(
    private readonly drive: DriveService,
    private readonly cache: MediaCache,
    private readonly log: Logger,
  ) {}

  async render(fileId: string, variant: Variant): Promise<Rendered> {
    const key = variantKey(fileId, variant);

    const cached = this.cache.hit(key);
    if (cached) return { path: cached, contentType: 'image/webp' };

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const task = this.produce(fileId, variant, key).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, task);
    return task;
  }

  private async produce(fileId: string, variant: Variant, key: string): Promise<Rendered> {
    const source = await this.download(fileId);
    let output: Buffer;

    try {
      output = await this.transform(source, variant);
    } catch (error) {
      // Formats que la libvips embarquée ne décode pas (certains HEIC, RAW
      // propriétaires) : Drive sait en produire un aperçu JPEG, on repart de là.
      this.log.warn(
        `Décodage local impossible pour ${fileId} (${(error as Error).message}), ` +
          'repli sur la vignette Drive',
      );
      const fallback = await this.downloadDriveThumbnail(fileId, variant);
      output = await this.transform(fallback, variant);
    }

    const path = await this.cache.put(key, output);
    return { path, contentType: 'image/webp' };
  }

  private async transform(source: Buffer, variant: Variant): Promise<Buffer> {
    const edge = variant.kind === 'thumb' ? variant.size : FULL_MAX_EDGE;
    const quality = variant.kind === 'thumb' ? THUMB_QUALITY : FULL_QUALITY;

    return (
      sharp(source, { failOn: 'error' })
        // `rotate()` sans argument applique l'orientation EXIF : sans lui, les
        // photos prises en portrait s'affichent couchées.
        .rotate()
        .resize({
          width: edge,
          height: edge,
          fit: 'inside',
          // Ne jamais suréchantillonner : une petite image reste à sa taille.
          withoutEnlargement: true,
        })
        .webp({ quality, effort: 4 })
        .toBuffer()
    );
  }

  private async download(fileId: string): Promise<Buffer> {
    const response = await this.drive.fetchFile(fileId);
    return Buffer.from(await response.arrayBuffer());
  }

  /** Aperçu JPEG généré par Google, demandé à la taille du rendu voulu. */
  private async downloadDriveThumbnail(fileId: string, variant: Variant): Promise<Buffer> {
    const { data } = await this.drive.api().files.get({
      fileId,
      fields: 'thumbnailLink',
      supportsAllDrives: true,
    });

    if (!data.thumbnailLink) {
      throw new Error(`Aucune vignette Drive disponible pour ${fileId}`);
    }

    // Le lien se termine par `=s220` : on remplace le suffixe de taille pour
    // obtenir directement la résolution voulue plutôt qu'un timbre-poste.
    const edge = variant.kind === 'thumb' ? variant.size : FULL_MAX_EDGE;
    const url = data.thumbnailLink.replace(/=s\d+(-[a-z]+)?$/i, `=s${edge}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Vignette Drive indisponible (${response.status}) pour ${fileId}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}
