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
/** Garde-fou contre un dossier pointant sur toute une arborescence géante. */
const MAX_FOLDERS = 5000;

/**
 * Fenêtre de lecture de l'en-tête d'une vidéo. 64 Ko couvrent d'un coup le
 * `moov` entier des fichiers observés, et restent négligeables devant les
 * dizaines de Mo du fichier.
 */
const HEADER_WINDOW_BYTES = 64 * 1024;

/**
 * Nombre de fenêtres ouvertes au plus pour atteindre le `moov`. Mesuré sur un
 * import réel : 2,3 en moyenne, le `moov` d'un enregistrement de téléphone étant
 * placé après le `mdat`. Au-delà, la date retombe sur le nom du fichier plutôt
 * que de faire durer la sync.
 */
const HEADER_MAX_WINDOWS = 4;

/**
 * Échéance d'une lecture d'en-tête. `fetchFile` n'en pose aucune sur une requête
 * `Range` — c'est le relais d'une vidéo vers le navigateur, qui la consomme à son
 * rythme. Ici, une connexion muette bloquerait la sync entière, et l'album
 * resterait `running` indéfiniment.
 */
const HEADER_TIMEOUT_MS = 20_000;

/** Ce qu'un passage de fenêtres apprend de l'en-tête d'une vidéo. */
interface ContainerHeader {
  /** `creation_time` du `moov`, `null` s'il est absent ou hors d'atteinte. */
  time: string | null;
  /**
   * Codec de la piste image. Chaîne vide quand le `moov` a bien été lu sans
   * qu'on y reconnaisse de piste image, `null` quand l'en-tête n'a pas été
   * atteint. La distinction décide de ce que la sync suivante rouvrira — voir
   * la migration 12.
   */
  codec: string | null;
}

/** Ce que la sync retient d'une vidéo : sa date, et de quoi la rendre lisible. */
type VideoHeader = VideoTakenAt & { videoCodec: string | null };

/**
 * Ce dont la synchronisation a besoin d'un album, et rien de plus : elle ne
 * dépend ni du fichier de configuration, ni de la forme stockée en base.
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
   * Vrai quand l'album a été reconfiguré pendant le parcours : ce passage s'est
   * arrêté sans rien écrire, laissant la main à celui qui l'a remplacé.
   */
  superseded: boolean;
}

/**
 * Abandon d'un passage rendu caduc par une reconfiguration. Interne au
 * `Syncer` : elle ne remonte jamais à l'appelant, qui reçoit un `SyncResult`
 * marqué `superseded`.
 */
class SyncSupersededError extends Error {
  constructor(albumId: string) {
    super(`Sync de "${albumId}" abandonnée : l'album a été reconfiguré entre-temps`);
  }
}

export interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

function noop(): void {}

/**
 * Configuration effectivement parcourue par une sync. Deux syncs du même album
 * ne sont interchangeables que si elles visent le même dossier avec la même
 * profondeur.
 */
function fingerprint(album: SyncAlbum): string {
  return `${album.folderId}:${album.recursive ? 'recursif' : 'plat'}`;
}

/**
 * Indexation d'un album : parcours du dossier Drive et recopie des métadonnées
 * en base. Rien n'est téléchargé — `imageMediaMetadata` fournit dimensions,
 * date de prise de vue et données EXIF directement dans la réponse de
 * `files.list`, ce qui rend la sync d'un album de plusieurs milliers de photos
 * quasi instantanée et bon marché en quota.
 */
export class Syncer {
  /** Albums en cours de sync : évite qu'une resync manuelle double le travail. */
  private readonly running = new Map<
    string,
    { fingerprint: string; task: Promise<SyncResult>; generation: number }
  >();

  /**
   * Distingue deux passages sur le même album. Le `fingerprint` ne suffirait
   * pas : revenir au dossier de départ pendant une sync rendrait les deux
   * passages indiscernables, et le premier reprendrait la main sur l'index.
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
   * Lance la sync, ou renvoie celle déjà en cours pour cet album **à la même
   * configuration**. Changer le dossier Drive pendant une sync rend l'ancienne
   * inutilisable : la resservir renverrait à l'appelant une promesse qui va
   * repeupler l'album avec les fichiers du dossier qu'on vient de quitter.
   */
  sync(album: SyncAlbum): Promise<SyncResult> {
    const wanted = fingerprint(album);
    const current = this.running.get(album.id);
    if (current?.fingerprint === wanted) return current.task;

    // La nouvelle sync attend la précédente au lieu de tourner à côté : les deux
    // écrivent sous le même `album_id`, et c'est le `deleteStale` du dernier
    // arrivé qui décide de ce qui reste. Sans cet enchaînement, l'ordre de fin
    // déciderait du contenu de l'album.
    const previous = current ? current.task.then(noop, noop) : Promise.resolve();
    const generation = ++this.generations;
    const task = previous.then(() => this.run(album, generation));

    void task.catch(noop).finally(() => {
      // Ne retirer que sa propre entrée : si une reconfiguration a déjà pris la
      // place, l'effacer laisserait la sync suivante croire qu'aucune ne tourne.
      if (this.running.get(album.id)?.task === task) this.running.delete(album.id);
    });
    this.running.set(album.id, { fingerprint: wanted, task, generation });
    return task;
  }

  /** Sync séquentielle de tous les albums : ménage le quota API de Drive. */
  async syncAll(albums: SyncAlbum[]): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    for (const album of albums) {
      try {
        results.push(await this.sync(album));
      } catch (error) {
        this.log.error(`Sync of "${album.id}" failed : ${(error as Error).message}`);
        // Autorisation révoquée : les albums suivants échoueraient tous de la
        // même façon. On s'arrête, l'erreur déjà inscrite dans `sync_state`
        // expliquant à chacun ce qui s'est passé.
        if (error instanceof DriveRevokedError) break;
      }
    }
    return results;
  }

  /**
   * Ce passage a-t-il encore la main sur l'album ? Faux dès qu'une
   * reconfiguration en a lancé un autre — auquel cas plus rien ne doit être
   * écrit : la route a purgé l'index en changeant le dossier, et réinsérer ici
   * rendrait visibles les photos que le propriétaire vient de retirer.
   */
  private ensureCurrent(albumId: string, generation: number): void {
    if (this.running.get(albumId)?.generation !== generation) {
      throw new SyncSupersededError(albumId);
    }
  }

  private async run(album: SyncAlbum, generation: number): Promise<SyncResult> {
    const startedAt = Date.now();
    // Estampille du passage : tout média non revu avec cette valeur a disparu
    // du dossier et sera retiré de l'index à la fin.
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
        // Les raccourcis Drive peuvent créer des cycles ; sans ce garde le
        // parcours ne se terminerait pas.
        if (visited.has(folderId)) continue;
        visited.add(folderId);

        if (visited.size > MAX_FOLDERS) {
          throw new Error(
            `Plus de ${MAX_FOLDERS} dossiers parcourus pour l'album "${album.id}" — ` +
              'cible un dossier plus précis ou passe `recursive: false`.',
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

          // Écriture par lots : une transaction par millier de fichiers plutôt
          // qu'une par fichier, et l'album devient consultable en cours de sync.
          if (batch.length >= 500) {
            this.ensureCurrent(album.id, generation);
            this.media.upsertMany(batch, seenAt);
            batch = [];
          }
        }
      }

      // Dernier contrôle avant les écritures qui décident du contenu visible.
      this.ensureCurrent(album.id, generation);
      if (batch.length > 0) this.media.upsertMany(batch, seenAt);

      const removed = this.media.deleteStale(album.id, seenAt);
      const durationMs = Date.now() - startedAt;

      this.syncState.set(album.id, { lastSyncAt: seenAt, status: 'ok', error: null });
      this.log.info(
        `Album "${album.id}" : ${indexed} médias, ${removed} retirés, ` +
          `${visited.size} dossiers, ${durationMs} ms`,
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
        // Ni l'index ni `sync_state` ne sont touchés : les deux appartiennent
        // désormais au passage qui a pris la place. Écrire « erreur » ici
        // afficherait un échec dans /admin alors que rien n'a échoué — la
        // configuration a simplement changé sous les pieds de ce passage-ci.
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
       * Les lots déjà écrits sont validés — une transaction par lot de 500,
       * pas une pour toute la sync : l'index mélange donc l'ancien et le
       * nouveau contenu. `deleteStale` n'ayant pas eu lieu, rien n'a été
       * retiré, et ce qui vient d'être écrit existe bien dans Drive. L'album
       * reste consultable et cohérent, simplement incomplet.
       *
       * `lastSyncAt` garde la valeur du dernier passage **réussi** : c'est ce
       * que /admin affiche, et prétendre que la sync date de maintenant
       * masquerait qu'elle n'est pas allée au bout.
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
      // `guard` traduit un refus `invalid_grant` en DriveRevokedError et marque
      // la connexion comme révoquée : sans lui, chaque album échouerait sur un
      // message technique sans dire qu'il faut réautoriser l'accès.
      const { data } = await this.drive.guard(() =>
        api.files.list({
          q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
          fields: FIELDS,
          pageSize: PAGE_SIZE,
          pageToken,
          // Nécessaire pour que les Drive partagés soient visibles.
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
    // Sans date EXIF (captures d'écran, photos ré-encodées), la date de
    // modification Drive est le seul repère chronologique disponible. Une vidéo,
    // elle, n'en a jamais et se date sur son fichier (D97) — d'où elle rapporte
    // aussi son codec, dans le même passage de fenêtres (D260809b).
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

    // Drive donne les dimensions du capteur : sur une photo portrait, elles
    // sont inversées et c'est `rotation` (5-8 en EXIF) qui rétablit l'ordre.
    // La grille calcule ses lignes à partir de ces valeurs, donc les corriger
    // ici évite des vignettes déformées avant même leur chargement.
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
      // Drive produit une image de la première seconde d'une vidéo, mais pas
      // toujours : un codec qu'il ne lit pas, ou un fichier déposé il y a
      // quelques secondes, n'en ont pas encore. Le stocker évite que la grille
      // redemande à chaque chargement de page un aperçu qui n'existe pas (D92).
      hasThumbnail: file.hasThumbnail === true,
      videoCodec,
    };
  }

  /**
   * Date de prise de vue d'une vidéo (D97) et codec de sa piste image (D260809b),
   * reconstruits depuis le fichier en une seule lecture.
   *
   * Le court-circuit sur le `md5` est ce qui rend la sync d'un album de vidéos
   * répétable : une vidéo déjà datée depuis son fichier et dont le contenu n'a
   * pas bougé garde sa date sans qu'un seul octet soit relu. Une vidéo restée
   * sur `modifiedTime` — en-tête illisible, Drive indisponible au moment de la
   * lecture — est réessayée au passage suivant.
   *
   * `videoCodec` entre dans la condition, et c'est ce qui peuple la colonne sans
   * migration de données : les lignes écrites avant elle portent une date venue
   * du fichier mais pas de codec, donc elles sont relues **une fois**, puis
   * court-circuitées comme les autres.
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
   * Ce que porte le `moov`, en suivant la chaîne des boîtes de premier niveau
   * d'une fenêtre à l'autre. Tout est `null` dès que le fichier ne se laisse pas
   * lire — format non ISOBMFF, `moov` hors d'atteinte, Drive indisponible :
   * l'appelant se rabat alors sur le nom, puis sur la date de modification.
   *
   * Les deux lectures partagent la fenêtre parce qu'elles partagent la boîte :
   * les séparer doublerait le nombre de requêtes `Range` d'une sync d'album de
   * vidéos, pour relire exactement les mêmes octets.
   */
  private async containerHeader(fileId: string, fileSize: number | null): Promise<ContainerHeader> {
    const absent: ContainerHeader = { time: null, codec: null };

    // Sans taille annoncée, la chaîne ne peut pas être bornée : une boîte de
    // taille nulle court « jusqu'à la fin », qu'on ne connaîtrait pas.
    if (fileSize === null || fileSize <= 0) return absent;

    let start = 0;

    for (let fenetre = 0; fenetre < HEADER_MAX_WINDOWS; fenetre++) {
      const buffer = await this.readWindow(fileId, start, fileSize);
      if (buffer === null) return absent;

      const { moovOffset, nextOffset } = findMoovOffset(buffer, start, fileSize);

      if (moovOffset !== null) {
        const time = readCreationTime(buffer, moovOffset - start);
        // Le `moov` a été atteint : un codec introuvable est une réponse, pas
        // un manque, et la chaîne vide évite de rouvrir le fichier à chaque
        // synchronisation pour relire ce qu'il n'a pas.
        const codec = readVideoCodec(buffer, moovOffset - start) ?? '';
        if (time !== null) return { time, codec };
        // Le `moov` est là mais son `mvhd` déborde de la fenêtre : rouvrir sur
        // la boîte elle-même. Si elle y commençait déjà, il n'y a plus rien à
        // en tirer et insister ferait boucler.
        if (moovOffset === start) return { time: null, codec };
        start = moovOffset;
        continue;
      }

      if (nextOffset === null) return absent;
      start = nextOffset;
    }

    return absent;
  }

  /** Une fenêtre de l'en-tête, ou `null` si Drive ne l'a pas rendue. */
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
      // Une autorisation révoquée fait échouer tout le reste de la sync : la
      // laisser remonter évite de dater 300 vidéos sur leur date de
      // téléversement avant de s'en apercevoir.
      if (error instanceof DriveRevokedError) throw error;
      this.log.warn(
        `En-tête de la vidéo ${fileId} illisible : ${(error as Error).message} — ` +
          'la date vient du nom du fichier ou de sa date de modification.',
      );
      return null;
    }
  }
}
