import type { drive_v3 } from '@googleapis/drive';
import type { MediaRepo, MediaUpsert, SyncStateRepo } from '../repo.js';
import {
  classify,
  FOLDER_MIME,
  parseExifTime,
  toCoordinates,
  toNumber,
  toText,
} from './metadata.js';
import { DriveRevokedError, type DriveService } from './service.js';

const FIELDS =
  'nextPageToken, files(id, name, mimeType, size, modifiedTime, md5Checksum, hasThumbnail, ' +
  'imageMediaMetadata, videoMediaMetadata)';

const PAGE_SIZE = 1000;
/** Garde-fou contre un dossier pointant sur toute une arborescence géante. */
const MAX_FOLDERS = 5000;

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
        this.log.error(`Sync de "${album.id}" en échec : ${(error as Error).message}`);
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

          const item = this.toUpsert(album.id, file);
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

  private toUpsert(albumId: string, file: drive_v3.Schema$File): MediaUpsert | null {
    const kind = classify(file.mimeType);
    if (!kind || !file.id || !file.modifiedTime) return null;

    const image = file.imageMediaMetadata;
    const video = file.videoMediaMetadata;

    const exifTime = parseExifTime(image?.time);
    // Sans date EXIF (vidéos, captures d'écran, photos ré-encodées), la date de
    // modification Drive est le seul repère chronologique disponible.
    const takenAt = exifTime ?? new Date(file.modifiedTime).toISOString();

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
      takenAtFromExif: exifTime !== null,
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
    };
  }
}
