import {
  DEFAULT_GROUP_BY,
  DEFAULT_SORT_ORDER,
  type Album,
  type GroupBy,
  type MediaDetail,
  type MediaItem,
  type MediaKind,
  type SortOrder,
  type SyncStatus,
  type UpdateMediaRequest,
} from '@gdv/shared';
import type { Db } from './db.js';

/** Ligne brute de `media`, augmentée de la description jointe. */
interface MediaRow {
  album_id: string;
  id: string;
  name: string;
  mime_type: string;
  kind: MediaKind;
  size: number | null;
  width: number | null;
  height: number | null;
  taken_at: string;
  taken_at_from_exif: number;
  modified_time: string;
  duration_ms: number | null;
  camera_make: string | null;
  camera_model: string | null;
  lens: string | null;
  iso_speed: number | null;
  exposure_time: number | null;
  aperture: number | null;
  focal_length: number | null;
  lat: number | null;
  lng: number | null;
  md5: string | null;
  has_thumbnail: number;
  description: string | null;
}

export interface MediaUpsert {
  albumId: string;
  id: string;
  name: string;
  mimeType: string;
  kind: MediaKind;
  size: number | null;
  width: number | null;
  height: number | null;
  takenAt: string;
  takenAtFromExif: boolean;
  modifiedTime: string;
  durationMs: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  isoSpeed: number | null;
  exposureTime: number | null;
  aperture: number | null;
  focalLength: number | null;
  lat: number | null;
  lng: number | null;
  md5: string | null;
  /**
   * `hasThumbnail` de Drive : l'aperçu de la première seconde existe-t-il ?
   * Toujours vrai sur une photo, pas toujours sur une vidéo.
   */
  hasThumbnail: boolean;
}

function toItem(row: MediaRow): MediaItem {
  return {
    id: row.id,
    albumId: row.album_id,
    name: row.name,
    kind: row.kind,
    mimeType: row.mime_type,
    size: row.size,
    width: row.width,
    height: row.height,
    takenAt: row.taken_at,
    takenAtFromExif: row.taken_at_from_exif === 1,
    durationMs: row.duration_ms,
    // Une photo a toujours un rendu — le pipeline la décode, et retombe sur
    // l'aperçu Drive quand libvips ne la lit pas. Une vidéo n'en a un que si
    // Drive a produit le sien : rien n'est décodé localement (D92).
    hasPreview: row.kind === 'photo' || row.has_thumbnail === 1,
    // Huit caractères de l'empreinte suffisent à distinguer deux versions
    // successives d'un même fichier ; l'URL reste lisible.
    version: row.md5 ? row.md5.slice(0, 8) : null,
    description: row.description,
  };
}

/**
 * Les colonnes de `media`, augmentées de la description saisie sur ce couple
 * (album, média).
 *
 * `media.*` et non `*` : les deux tables portent une colonne `album_id`, et une
 * étoile nue rendrait la ligne ambiguë à la lecture — SQLite l'accepterait, le
 * lecteur suivant devrait deviner laquelle des deux il tient.
 *
 * La jointure est **1-pour-1** sur la clé primaire de `media_notes` : elle ne
 * duplique ni ne perd de ligne, donc elle ne touche pas à la pagination par
 * curseur, qui compte les lignes rendues pour savoir s'il reste une page.
 */
const SELECT_ITEMS = `SELECT media.*, media_notes.description AS description
       FROM media
       LEFT JOIN media_notes
         ON media_notes.album_id = media.album_id AND media_notes.media_id = media.id`;

/**
 * Détail tel que l'index le connaît. Le nombre de commentaires vient d'ailleurs
 * et se compose au niveau de la route : `MediaRepo` n'a pas à savoir que les
 * commentaires existent, sans quoi la moindre requête média deviendrait une
 * jointure de plus.
 */
export type IndexedDetail = Omit<MediaDetail, 'commentCount'>;

function toDetail(row: MediaRow): IndexedDetail {
  return {
    ...toItem(row),
    exif: {
      cameraMake: row.camera_make,
      cameraModel: row.camera_model,
      lens: row.lens,
      isoSpeed: row.iso_speed,
      exposureTime: row.exposure_time,
      aperture: row.aperture,
      focalLength: row.focal_length,
      latitude: row.lat,
      longitude: row.lng,
    },
  };
}

/**
 * Curseur de pagination. Le tri est `(taken_at, id)`, dans le sens demandé ; le
 * curseur encode la dernière ligne rendue pour reprendre strictement après
 * elle. Un simple OFFSET sauterait ou dupliquerait des lignes si une sync
 * insère des médias pendant que l'utilisateur défile.
 *
 * Le format ne dépend pas du sens : seule la comparaison appliquée à la
 * reprise s'inverse. Un curseur reste donc lisible même si le sens change,
 * il désigne simplement l'autre moitié de l'album.
 *
 * Le séparateur est l'octet nul, écrit `\u0000` et **jamais littéralement** :
 * un octet nul dans un fichier source le fait classer comme binaire par git,
 * qui cesse alors d'en afficher les diffs — donc de permettre toute revue. Il
 * reste le bon séparateur pour autant : ni une date ISO ni un identifiant Drive
 * ne peuvent en contenir, là où l'espace resterait un pari sur la forme des
 * identifiants.
 */
export function encodeCursor(takenAt: string, id: string): string {
  return Buffer.from(`${takenAt}\u0000${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { takenAt: string; id: string } | null {
  try {
    const [takenAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('\u0000');
    if (!takenAt || !id) return null;
    return { takenAt, id };
  } catch {
    return null;
  }
}

export class MediaRepo {
  constructor(private readonly db: Db) {}

  /**
   * Page de médias triée chronologiquement, du plus récent au plus ancien par
   * défaut, du plus ancien au plus récent en `asc`.
   * `limit` lignes sont rendues ; on en lit une de plus pour savoir s'il reste
   * une page suivante sans faire de COUNT.
   */
  listItems(
    albumId: string,
    limit: number,
    cursor: string | null,
    order: SortOrder = DEFAULT_SORT_ORDER,
  ): {
    items: MediaItem[];
    nextCursor: string | null;
  } {
    const position = cursor ? decodeCursor(cursor) : null;

    // `order` est une union fermée, jamais une chaîne venue de la requête :
    // ces deux fragments ne peuvent pas injecter de SQL. La colonne de tri et
    // la comparaison du curseur doivent basculer ensemble, sans quoi la reprise
    // relirait la page déjà servie.
    const direction = order === 'asc' ? 'ASC' : 'DESC';
    const after = order === 'asc' ? '>' : '<';

    const rows = position
      ? (this.db
          .prepare(
            `${SELECT_ITEMS}
             WHERE media.album_id = ?
               AND (media.taken_at ${after} ?
                    OR (media.taken_at = ? AND media.id ${after} ?))
             ORDER BY media.taken_at ${direction}, media.id ${direction}
             LIMIT ?`,
          )
          .all(albumId, position.takenAt, position.takenAt, position.id, limit + 1) as MediaRow[])
      : (this.db
          .prepare(
            `${SELECT_ITEMS}
             WHERE media.album_id = ?
             ORDER BY media.taken_at ${direction}, media.id ${direction}
             LIMIT ?`,
          )
          .all(albumId, limit + 1) as MediaRow[]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map(toItem),
      nextCursor: hasMore && last ? encodeCursor(last.taken_at, last.id) : null,
    };
  }

  getDetail(albumId: string, id: string): IndexedDetail | null {
    const row = this.mediaRow(albumId, id);
    return row ? toDetail(row) : null;
  }

  /**
   * Écrit la description d'une photo **dans cet album**, et rend l'item à jour.
   *
   * Champ absent : rien n'est touché. `null` — comme une chaîne vide ou blanche
   * — efface la ligne : une description vide ne dit rien de plus qu'une
   * description absente, et la garder ferait grossir la table pour rien.
   *
   * `null` en retour si le média n'est pas indexé dans cet album. C'est la
   * route qui en fait un 404 : le dépôt ne décide pas des codes HTTP.
   */
  setDescription(albumId: string, mediaId: string, patch: UpdateMediaRequest): MediaItem | null {
    const row = this.mediaRow(albumId, mediaId);
    if (!row) return null;
    if (patch.description === undefined) return toItem(row);

    const trimmed = patch.description?.trim();
    const description = trimmed ? trimmed : null;

    if (description === null) {
      this.db
        .prepare('DELETE FROM media_notes WHERE album_id = ? AND media_id = ?')
        .run(albumId, mediaId);
    } else {
      this.db
        .prepare(
          `INSERT INTO media_notes (album_id, media_id, description, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (album_id, media_id) DO UPDATE SET
             description = excluded.description,
             updated_at = excluded.updated_at`,
        )
        .run(albumId, mediaId, description, new Date().toISOString());
    }

    return { ...toItem(row), description };
  }

  private mediaRow(albumId: string, id: string): MediaRow | undefined {
    return this.db
      .prepare(`${SELECT_ITEMS} WHERE media.album_id = ? AND media.id = ?`)
      .get(albumId, id) as MediaRow | undefined;
  }

  /**
   * Albums contenant ce média. Un même fichier Drive apparaît dans plusieurs
   * albums si leurs dossiers sont imbriqués — l'autorisation doit donc regarder
   * l'ensemble, pas un album unique.
   */
  albumsContaining(id: string): string[] {
    const rows = this.db.prepare('SELECT album_id FROM media WHERE id = ?').all(id) as {
      album_id: string;
    }[];
    return rows.map((row) => row.album_id);
  }

  /**
   * Métadonnées minimales nécessaires pour servir le fichier, sans le reste.
   *
   * `md5` identifie le contenu : Drive conserve l'identifiant d'un fichier
   * lorsqu'on en remplace le contenu (« Gérer les versions »), si bien que
   * l'identifiant seul ne suffit pas à distinguer deux versions successives.
   *
   * Un même fichier indexé sous deux albums a deux lignes, qui peuvent diverger
   * entre deux synchronisations. Le tri les départage sur `seen_at` : c'est la
   * ligne revue le plus récemment qui porte le `md5` et la taille du fichier
   * tel qu'il est aujourd'hui dans Drive. Sans ce tri, SQLite pourrait rendre
   * l'ancienne, et le cache servirait alors un dérivé périmé sous un ETag qui
   * le déclare immuable. `album_id` départage les ex æquo, pour que deux appels
   * consécutifs répondent la même chose.
   */
  getFileMeta(id: string): {
    name: string;
    mimeType: string;
    kind: MediaKind;
    size: number | null;
    md5: string | null;
    hasThumbnail: boolean;
  } | null {
    const row = this.db
      .prepare(
        `SELECT name, mime_type, kind, size, md5, has_thumbnail FROM media
         WHERE id = ?
         ORDER BY seen_at DESC, album_id ASC
         LIMIT 1`,
      )
      .get(id) as
      | {
          name: string;
          mime_type: string;
          kind: MediaKind;
          size: number | null;
          md5: string | null;
          has_thumbnail: number;
        }
      | undefined;
    if (!row) return null;
    return {
      name: row.name,
      mimeType: row.mime_type,
      kind: row.kind,
      size: row.size,
      md5: row.md5,
      hasThumbnail: row.has_thumbnail === 1,
    };
  }

  /**
   * Compteur, bornes chronologiques et couverture effective de l'album.
   *
   * `chosenId` est le choix d'un administrateur, et il ne vaut que tant que la
   * photo est dans l'index : un fichier passé à la corbeille Drive le temps
   * d'un retour en arrière laisserait sinon l'album sans vignette sur la page
   * d'accueil, sans que rien ne dise pourquoi. Le repli est donc permanent, et
   * le choix reste stocké — la photo revenue redevient la couverture.
   */
  stats(
    albumId: string,
    chosenId: string | null = null,
  ): {
    itemCount: number;
    coverId: string | null;
    coverVersion: string | null;
    newestAt: string | null;
    oldestAt: string | null;
  } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count, MAX(taken_at) AS newest, MIN(taken_at) AS oldest
         FROM media WHERE album_id = ?`,
      )
      .get(albumId) as { count: number; newest: string | null; oldest: string | null };

    // `kind = 'photo'` des deux côtés : jamais une vidéo. Elle a bien une
    // vignette depuis D92, mais celle-ci appartient à Drive et peut manquer —
    // or la couverture est la seule image dont l'absence se voit depuis la page
    // d'accueil, sans repli.
    const chosen = chosenId
      ? (this.db
          .prepare(`SELECT id, md5 FROM media WHERE album_id = ? AND id = ? AND kind = 'photo'`)
          .get(albumId, chosenId) as { id: string; md5: string | null } | undefined)
      : undefined;

    // À défaut de choix utilisable, la photo la plus récente.
    const cover =
      chosen ??
      (this.db
        .prepare(
          `SELECT id, md5 FROM media
         WHERE album_id = ? AND kind = 'photo'
         ORDER BY taken_at DESC, id DESC LIMIT 1`,
        )
        .get(albumId) as { id: string; md5: string | null } | undefined);

    return {
      itemCount: row.count,
      coverId: cover?.id ?? null,
      coverVersion: cover?.md5 ? cover.md5.slice(0, 8) : null,
      newestAt: row.newest,
      oldestAt: row.oldest,
    };
  }

  /**
   * Nombre de médias entrés dans l'index depuis `since`, et date d'entrée du
   * plus récent d'entre eux.
   *
   * `added_at` et non `seen_at` : ce dernier est réécrit sur tous les médias à
   * chaque synchronisation, y compris ceux déjà connus, et compterait donc
   * l'album entier comme nouveau à chaque passage.
   *
   * La date rendue sert de nouvelle borne : la prendre plutôt que « maintenant »
   * garantit qu'un média inséré entre le comptage et l'écriture de la borne
   * reste annoncé au passage suivant au lieu d'être sauté.
   */
  countAddedSince(albumId: string, since: string): { count: number; latest: string | null } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count, MAX(added_at) AS latest FROM media
          WHERE album_id = ? AND added_at > ?`,
      )
      .get(albumId, since) as { count: number; latest: string | null };
    return row;
  }

  /**
   * Toutes les positions connues d'un album, par ordre chronologique croissant,
   * avec le jour UTC qui les porte. C'est la seule lecture du passage de
   * `places.ts`, qui en déduit les lieux d'une journée.
   *
   * `substr(taken_at, 1, 10)` et non un `Date` : `taken_at` est l'heure de
   * l'appareil, et la découper sur la chaîne donne exactement la clé que
   * `dayKey()` calcule côté front. Passer par un fuseau ferait basculer de jour
   * une photo de 23 h 30, et la journée annotée ne serait plus la bonne.
   *
   * Le tri croissant n'est pas cosmétique : l'ordre des grappes rendues est
   * celui de leur première photo, donc celui du déroulé de la journée.
   */
  geolocatedPoints(albumId: string): { day: string; lat: number; lng: number }[] {
    return this.db
      .prepare(
        `SELECT substr(taken_at, 1, 10) AS day, lat, lng FROM media
          WHERE album_id = ? AND lat IS NOT NULL AND lng IS NOT NULL
          ORDER BY taken_at ASC, id ASC`,
      )
      .all(albumId) as { day: string; lat: number; lng: number }[];
  }

  upsertMany(items: MediaUpsert[], seenAt: string): void {
    const statement = this.db.prepare(
      `INSERT INTO media (
         album_id, id, name, mime_type, kind, size, width, height,
         taken_at, taken_at_from_exif, modified_time, duration_ms,
         camera_make, camera_model, lens, iso_speed, exposure_time,
         aperture, focal_length, lat, lng, md5, has_thumbnail, seen_at, added_at
       ) VALUES (
         @albumId, @id, @name, @mimeType, @kind, @size, @width, @height,
         @takenAt, @takenAtFromExif, @modifiedTime, @durationMs,
         @cameraMake, @cameraModel, @lens, @isoSpeed, @exposureTime,
         @aperture, @focalLength, @lat, @lng, @md5, @hasThumbnail, @seenAt, @seenAt
       )
       ON CONFLICT (album_id, id) DO UPDATE SET
         name = excluded.name,
         mime_type = excluded.mime_type,
         kind = excluded.kind,
         size = excluded.size,
         width = excluded.width,
         height = excluded.height,
         taken_at = excluded.taken_at,
         taken_at_from_exif = excluded.taken_at_from_exif,
         modified_time = excluded.modified_time,
         duration_ms = excluded.duration_ms,
         camera_make = excluded.camera_make,
         camera_model = excluded.camera_model,
         lens = excluded.lens,
         iso_speed = excluded.iso_speed,
         exposure_time = excluded.exposure_time,
         aperture = excluded.aperture,
         focal_length = excluded.focal_length,
         lat = excluded.lat,
         lng = excluded.lng,
         md5 = excluded.md5,
         has_thumbnail = excluded.has_thumbnail,
         seen_at = excluded.seen_at
         -- added_at est délibérément absent de ce DO UPDATE : c'est la date
         -- d'entrée dans l'index, elle ne bouge plus. La réécrire ferait
         -- réapparaître comme nouvelle, à chaque synchronisation, une photo
         -- indexée depuis des mois.`,
    );

    const run = this.db.transaction((batch: MediaUpsert[]) => {
      for (const item of batch) {
        statement.run({
          ...item,
          takenAtFromExif: item.takenAtFromExif ? 1 : 0,
          hasThumbnail: item.hasThumbnail ? 1 : 0,
          seenAt,
        });
      }
    });

    run(items);
  }

  /**
   * Supprime de l'index les médias que la sync n'a pas revus : ils ont été
   * retirés du dossier Drive, déplacés, ou mis à la corbeille.
   *
   * `media_notes` n'est **pas** touchée, ni ici ni par `clearAlbum` et
   * `pruneAlbums` : la description est écrite à la main et rien ne la
   * régénère, alors qu'une photo quitte l'index sur un simple contretemps
   * d'indexation. Le seul ménage vient de la cascade sur `albums`, c'est-à-dire
   * de la suppression de l'album lui-même (D83).
   */
  deleteStale(albumId: string, seenAt: string): number {
    return this.db
      .prepare('DELETE FROM media WHERE album_id = ? AND seen_at < ?')
      .run(albumId, seenAt).changes;
  }

  /** Vide un album (changement de `folderId` dans la config, par exemple). */
  clearAlbum(albumId: string): number {
    return this.db.prepare('DELETE FROM media WHERE album_id = ?').run(albumId).changes;
  }

  /** Retire les albums qui ne sont plus déclarés dans la config. */
  pruneAlbums(knownIds: string[]): number {
    if (knownIds.length === 0) {
      const removed = this.db.prepare('DELETE FROM media').run().changes;
      this.db.prepare('DELETE FROM sync_state').run();
      return removed;
    }
    const placeholders = knownIds.map(() => '?').join(', ');
    const removed = this.db
      .prepare(`DELETE FROM media WHERE album_id NOT IN (${placeholders})`)
      .run(...knownIds).changes;
    this.db
      .prepare(`DELETE FROM sync_state WHERE album_id NOT IN (${placeholders})`)
      .run(...knownIds);
    return removed;
  }
}

export interface SyncRecord {
  lastSyncAt: string | null;
  status: SyncStatus;
  error: string | null;
}

export class SyncStateRepo {
  constructor(private readonly db: Db) {}

  get(albumId: string): SyncRecord {
    const row = this.db
      .prepare(
        'SELECT last_sync_at AS lastSyncAt, status, error FROM sync_state WHERE album_id = ?',
      )
      .get(albumId) as SyncRecord | undefined;
    return row ?? { lastSyncAt: null, status: 'never', error: null };
  }

  set(albumId: string, record: SyncRecord): void {
    this.db
      .prepare(
        `INSERT INTO sync_state (album_id, last_sync_at, status, error)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (album_id) DO UPDATE SET
           last_sync_at = excluded.last_sync_at,
           status = excluded.status,
           error = excluded.error`,
      )
      .run(albumId, record.lastSyncAt, record.status, record.error);
  }

  /**
   * Date des dernières nouveautés annoncées, `null` tant qu'aucune annonce n'a
   * eu lieu. `set()` ne la touche jamais : elle survit donc aux synchronisations
   * comme aux erreurs, sans quoi un échec de sync ferait tout réannoncer.
   */
  notifiedAt(albumId: string): string | null {
    const row = this.db
      .prepare('SELECT notified_at FROM sync_state WHERE album_id = ?')
      .get(albumId) as { notified_at: string | null } | undefined;
    return row?.notified_at ?? null;
  }

  markNotified(albumId: string, at: string): void {
    this.db.prepare('UPDATE sync_state SET notified_at = ? WHERE album_id = ?').run(at, albumId);
  }
}

/** Assemble la vue album exposée par l'API à partir de la config et de l'index. */
export function buildAlbum(
  config: {
    id: string;
    title: string;
    description?: string | null;
    groupBy?: GroupBy;
    coverMediaId?: string | null;
  },
  media: MediaRepo,
  sync: SyncStateRepo,
): Album {
  const stats = media.stats(config.id, config.coverMediaId ?? null);
  const state = sync.get(config.id);
  return {
    id: config.id,
    title: config.title,
    description: config.description ?? null,
    groupBy: config.groupBy ?? DEFAULT_GROUP_BY,
    itemCount: stats.itemCount,
    coverId: stats.coverId,
    coverVersion: stats.coverVersion,
    newestAt: stats.newestAt,
    oldestAt: stats.oldestAt,
    lastSyncAt: state.lastSyncAt,
    syncStatus: state.status,
    syncError: state.error,
  };
}
