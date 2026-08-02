import sharp from 'sharp';
import type { ThumbSize } from '@gdv/shared';
import type { DriveService } from '../drive/service.js';
import type { MediaCache } from './cache.js';

/** Côté le plus long du rendu « plein écran ». Au-delà, le gain est invisible. */
const FULL_MAX_EDGE = 2560;
/**
 * Côté le plus long du rendu de zoom. 4096 px couvre la résolution native de la
 * quasi-totalité des appareils photo et téléphones ; au-delà, l'agrandissement
 * ne montre plus que du grain de capteur.
 *
 * `withoutEnlargement` empêche d'inventer des pixels : une photo de 3000 px
 * reste à 3000 px et le zoom s'arrête à sa résolution réelle.
 */
const HD_MAX_EDGE = 4096;

const THUMB_QUALITY = 78;
const FULL_QUALITY = 82;
/** Plus généreux que `full` : c'est la variante qu'on examine de près. */
const HD_QUALITY = 88;

export type Variant = { kind: 'thumb'; size: ThumbSize } | { kind: 'full' } | { kind: 'hd' };

export interface Rendered {
  path: string;
  contentType: string;
}

interface Logger {
  warn: (msg: string) => void;
  debug?: (msg: string) => void;
}

/**
 * Clé de cache d'un dérivé.
 *
 * L'empreinte du contenu (`md5` fourni par Drive) en fait partie : Drive garde
 * le même identifiant de fichier quand on en remplace le contenu par une
 * nouvelle version, et sans l'empreinte le cache resservirait indéfiniment
 * l'ancienne image. Elle est absente pour de rares fichiers — on retombe alors
 * sur l'identifiant seul, avec le comportement d'avant.
 */
function variantKey(fileId: string, variant: Variant, md5: string | null): string {
  const kind = variant.kind === 'thumb' ? `t${variant.size}` : variant.kind;
  return md5 ? `${fileId}:${md5}:${kind}` : `${fileId}:${kind}`;
}

/** Côté maximal et qualité WebP de chaque variante. */
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

  /** `md5` vient de l'index et identifie la version du fichier. */
  async render(fileId: string, variant: Variant, md5: string | null = null): Promise<Rendered> {
    const key = variantKey(fileId, variant, md5);

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
    const { edge, quality } = encodingFor(variant);

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
        // `effort: 4` est le compromis retenu : au-delà, l'encodage coûte des
        // centaines de millisecondes de plus par image pour quelques pourcents
        // de poids, ce qui se paierait à chaque première ouverture.
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
    const { data } = await this.drive.guard(() =>
      this.drive.api().files.get({
        fileId,
        fields: 'thumbnailLink',
        supportsAllDrives: true,
      }),
    );

    if (!data.thumbnailLink) {
      throw new Error(`Aucune vignette Drive disponible pour ${fileId}`);
    }

    // Le lien se termine par `=s220` : on remplace le suffixe de taille pour
    // obtenir directement la résolution voulue plutôt qu'un timbre-poste.
    const url = data.thumbnailLink.replace(/=s\d+(-[a-z]+)?$/i, `=s${encodingFor(variant).edge}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Vignette Drive indisponible (${response.status}) pour ${fileId}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}
