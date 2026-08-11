import { access } from 'node:fs/promises';
import { cpus } from 'node:os';
import sharp from 'sharp';
import type { ThumbSize } from '@nonni/shared';
import type { DriveService } from '../drive/service.js';
import type { MediaCache } from './cache.js';
import { Semaphore, renderConcurrencyFor } from './semaphore.js';

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

/**
 * Au-delà, l'original n'est pas décodé localement : il part directement au
 * repli par l'aperçu Drive.
 *
 * Le limiteur borne le **nombre** de rendus, pas leur taille — et chaque rendu
 * charge son original entier en mémoire pour le donner à sharp. Ses quatre
 * places au maximum (`renderConcurrencyFor`), occupées par des
 * fichiers de 300 Mo, suffisent à faire tomber le processus,
 * emportant la galerie entière pour une poignée de photos. 80 Mo laisse passer
 * tout ce qu'un appareil produit, RAW compris, et arrête ce qui n'est plus une
 * photo : un panorama assemblé, un scan de très grand format, une vidéo mal
 * classée par son type MIME.
 */
const MAX_DECODE_BYTES = 80 * 1024 * 1024;

/**
 * Effort d'encodage WebP. Mesuré sur un JPEG de reflex de 8 Mo réduit à
 * 2560 px, sur la machine de développement :
 *
 * | effort | temps   | poids   |
 * | ------ | ------- | ------- |
 * | 0      |  707 ms | 1262 Ko |
 * | 2      |  898 ms | 1206 Ko |
 * | 4      | 1526 ms | 1186 Ko |
 * | 6      | 3792 ms | 1155 Ko |
 *
 * Passer de 4 à 2 rend 600 ms sur les ~3,5 s d'une première ouverture, contre
 * 1,7 % de poids. Le poids se paie une fois, sur un réseau local ou une fibre ;
 * l'attente se paie à chaque photo jamais ouverte, devant l'écran. Descendre
 * à 0 gagnerait encore 200 ms mais coûterait 6 % — le rapport se dégrade.
 */
const WEBP_EFFORT = 2;

const THUMB_QUALITY = 78;
const FULL_QUALITY = 82;
/** Plus généreux que `full` : c'est la variante qu'on examine de près. */
const HD_QUALITY = 88;

export type Variant = { kind: 'thumb'; size: ThumbSize } | { kind: 'full' } | { kind: 'hd' };

/**
 * D'où part le rendu.
 *
 * `original` décode le fichier Drive, et ne retombe sur l'aperçu Drive que
 * lorsque ce décodage échoue. `poster` va directement à l'aperçu : c'est le cas
 * d'une vidéo, dont rien n'est décodé ici (D92). Sans ce court-circuit, un MP4
 * de 48 Mo serait tiré puis jeté par `MAX_DECODE_BYTES` à chaque vignette.
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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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
  private readonly places: Semaphore;

  constructor(
    private readonly drive: DriveService,
    private readonly cache: MediaCache,
    private readonly log: Logger,
    concurrency = renderConcurrencyFor(cpus().length),
  ) {
    this.places = new Semaphore(concurrency);
  }

  /** Rendus en cours et en attente. Remonté dans /admin pour le diagnostic. */
  get load(): { running: number; waiting: number; limit: number } {
    return {
      running: this.places.enCours,
      waiting: this.places.enAttente,
      limit: this.places.limite,
    };
  }

  /**
   * Ce dérivé est-il déjà en cache ? C'est ainsi que `prepare` saute ce qui
   * existe sans le marquer comme consulté — sans quoi le préchauffage
   * protégerait de l'éviction ce que personne n'a jamais ouvert. La clé de
   * variante ne sort pas de ce module : c'est ici qu'on sait qu'elle contient
   * l'empreinte du contenu.
   */
  isCached(fileId: string, variant: Variant, md5: string | null): boolean {
    return this.cache.has(variantKey(fileId, variant, md5));
  }

  /** `md5` vient de l'index et identifie la version du fichier. */
  async render(
    fileId: string,
    variant: Variant,
    md5: string | null = null,
    origin: RenderOrigin = 'original',
  ): Promise<Rendered> {
    const key = variantKey(fileId, variant, md5);

    const cached = this.cache.hit(key);
    // L'inventaire peut désigner un fichier qui n'est plus là : « vider le
    // cache » depuis /admin efface le répertoire pendant qu'une grille se
    // charge, et rien n'empêche un ménage manuel sur le volume. Sans cette
    // vérification, `createReadStream` échouerait en ENOENT une fois les
    // en-têtes déjà envoyés, donc sur une image cassée et non régénérée.
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
   * Prépare plusieurs variantes d'un même fichier et rend le nombre de dérivés
   * réellement produits — zéro si tout était déjà en cache.
   *
   * Chemin distinct de `render()` pour une raison mesurée : produire un dérivé
   * coûte environ deux secondes de téléchargement Drive pour cinquante
   * millisecondes de rendu. Enchaîner trois `render()` pour les trois tailles de
   * vignette d'une même photo téléchargerait donc trois fois le même original —
   * trois fois le trafic Drive, trois fois la durée du passage — là où un seul
   * téléchargement suffit.
   *
   * Une seule place du limiteur est prise pour l'ensemble : c'est l'original en
   * mémoire qui pèse, et il est le même pour toutes les variantes. Ces rendus ne
   * passent pas par `inFlight` : la déduplication sert aux rafales de la grille
   * sur une même vignette, pas à un passage de fond qui ne visite chaque photo
   * qu'une fois.
   */
  async prepare(
    fileId: string,
    variants: Variant[],
    md5: string | null = null,
    origin: RenderOrigin = 'original',
  ): Promise<number> {
    // Du plus grand au plus petit : c'est la première variante qui sert de
    // gabarit au repli sur l'aperçu Drive, et `withoutEnlargement` figerait
    // toutes les suivantes à sa taille si on commençait par la plus petite.
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
            ? await this.downloadDriveThumbnail(fileId, premiere)
            : await this.download(fileId);
        // Cette première conversion vaut test de décodage : c'est elle qui fait
        // basculer sur l'aperçu Drive les formats que la libvips embarquée ne
        // lit pas, exactement comme pour un rendu demandé.
        await this.store(fileId, premiere, md5, source);
      } catch (error) {
        // En `poster`, l'aperçu Drive **est** le repli : le redemander après un
        // échec ne ferait que rejouer le même appel.
        if (origin === 'poster') throw error;
        this.log.warn(
          `Décodage local impossible pour ${fileId} (${(error as Error).message}), ` +
            'repli sur la vignette Drive',
        );
        source = await this.downloadDriveThumbnail(fileId, premiere);
        await this.store(fileId, premiere, md5, source);
      }

      for (const variant of manquantes.slice(1)) {
        await this.store(fileId, variant, md5, source);
      }
      return manquantes.length;
    });
  }

  /**
   * La place est prise **avant** le téléchargement, pas seulement autour du
   * décodage : c'est l'original en mémoire qui pèse le plus lourd, et attendre
   * son tour avec neuf mégaoctets déjà chargés reviendrait à ne rien limiter.
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
          ? await this.downloadDriveThumbnail(fileId, variant)
          : await this.download(fileId);
      output = await this.transform(source, variant);
    } catch (error) {
      // En `poster`, l'aperçu Drive **est** la source : il n'y a pas d'original
      // à décoder derrière, et le repli n'aurait rien de plus à tenter.
      if (origin === 'poster') throw error;
      // Formats que la libvips embarquée ne décode pas (certains HEIC, RAW
      // propriétaires), et fichiers trop lourds pour être tenus en mémoire :
      // Drive sait produire un aperçu JPEG, on repart de là. Le téléchargement
      // est dans le `try` pour que le second cas emprunte ce chemin — sans
      // quoi la seule issue serait une erreur, pour une photo que Drive sait
      // pourtant afficher.
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
        .webp({ quality, effort: WEBP_EFFORT })
        .toBuffer()
    );
  }

  /**
   * Original en mémoire, refusé au-delà de `MAX_DECODE_BYTES`.
   *
   * La taille annoncée par Drive est contrôlée avant de lire le corps — c'est
   * elle qui évite l'allocation — mais le corps est mesuré à son tour : un
   * en-tête absent ou menteur ne doit pas suffire à faire tomber le processus.
   */
  private async download(fileId: string): Promise<Buffer> {
    const response = await this.drive.fetchFile(fileId);

    const annoncee = Number(response.headers.get('content-length'));
    if (Number.isFinite(annoncee) && annoncee > MAX_DECODE_BYTES) {
      throw new Error(`original de ${Math.round(annoncee / 1024 / 1024)} Mo, trop lourd à décoder`);
    }

    const source = Buffer.from(await response.arrayBuffer());
    if (source.byteLength > MAX_DECODE_BYTES) {
      throw new Error(
        `original de ${Math.round(source.byteLength / 1024 / 1024)} Mo, trop lourd à décoder`,
      );
    }
    return source;
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

    // Le `thumbnailLink` d'un fichier non partagé publiquement — c'est-à-dire
    // le cas normal ici — répond 401/403 à un `fetch` anonyme : le repli censé
    // rattraper les HEIC échouerait précisément quand on en a besoin.
    const response = await this.drive.fetchAuthorized(url, `vignette Drive de ${fileId}`);
    return Buffer.from(await response.arrayBuffer());
  }
}
