import type { drive_v3 } from '@googleapis/drive';
import type { ConfigAlbum } from '../config.js';
import type { MediaRepo, MediaUpsert, SyncStateRepo } from '../repo.js';
import {
  classify,
  FOLDER_MIME,
  parseExifTime,
  toCoordinate,
  toNumber,
  toText,
} from './metadata.js';
import { DriveRevokedError, type DriveService } from './service.js';

const FIELDS =
  'nextPageToken, files(id, name, mimeType, size, modifiedTime, md5Checksum, imageMediaMetadata, videoMediaMetadata)';

const PAGE_SIZE = 1000;
/** Garde-fou contre un dossier pointant sur toute une arborescence géante. */
const MAX_FOLDERS = 5000;

export interface SyncResult {
  albumId: string;
  indexed: number;
  removed: number;
  folders: number;
  durationMs: number;
}

export interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
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
  private readonly running = new Map<string, Promise<SyncResult>>();

  constructor(
    private readonly drive: DriveService,
    private readonly media: MediaRepo,
    private readonly syncState: SyncStateRepo,
    private readonly log: Logger,
  ) {}

  isRunning(albumId: string): boolean {
    return this.running.has(albumId);
  }

  /** Lance la sync, ou renvoie celle déjà en cours pour cet album. */
  sync(album: ConfigAlbum): Promise<SyncResult> {
    const existing = this.running.get(album.id);
    if (existing) return existing;

    const task = this.run(album).finally(() => this.running.delete(album.id));
    this.running.set(album.id, task);
    return task;
  }

  /** Sync séquentielle de tous les albums : ménage le quota API de Drive. */
  async syncAll(albums: ConfigAlbum[]): Promise<SyncResult[]> {
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

  private async run(album: ConfigAlbum): Promise<SyncResult> {
    const startedAt = Date.now();
    // Estampille du passage : tout média non revu avec cette valeur a disparu
    // du dossier et sera retiré de l'index à la fin.
    const seenAt = new Date().toISOString();

    const previous = this.syncState.get(album.id);
    this.syncState.set(album.id, { ...previous, status: 'running', error: null });

    try {
      const api = this.drive.api();
      const pending = [album.folderId];
      const visited = new Set<string>();
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
            this.media.upsertMany(batch, seenAt);
            batch = [];
          }
        }
      }

      if (batch.length > 0) this.media.upsertMany(batch, seenAt);

      const removed = this.media.deleteStale(album.id, seenAt);
      const durationMs = Date.now() - startedAt;

      this.syncState.set(album.id, { lastSyncAt: seenAt, status: 'ok', error: null });
      this.log.info(
        `Album "${album.id}" : ${indexed} médias, ${removed} retirés, ` +
          `${visited.size} dossiers, ${durationMs} ms`,
      );

      return { albumId: album.id, indexed, removed, folders: visited.size, durationMs };
    } catch (error) {
      const message = (error as Error).message;
      // On garde `lastSyncAt` de la sync réussie précédente : l'index reste
      // servi, l'erreur est simplement remontée dans /admin.
      this.syncState.set(album.id, {
        lastSyncAt: previous.lastSyncAt,
        status: 'error',
        error: message,
      });
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
      lat: toCoordinate(image?.location?.latitude),
      lng: toCoordinate(image?.location?.longitude),
      md5: toText(file.md5Checksum),
    };
  }
}
