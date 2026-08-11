import type { AlbumDay, UpdateAlbumDayRequest } from '@nonni/shared';
import type { Db } from './db.js';
import type { Geocoder } from './geocoder.js';
import type { MediaRepo } from './repo.js';

/**
 * Les journées d'un album : la note qu'on y a écrite, et le lieu que ses
 * photos portent déjà.
 *
 * **Pourquoi deux moitiés séparées.** L'agrégation des positions en grappes est
 * déterministe, instantanée et hors réseau ; le géocodage inverse est lent,
 * plafonné à une requête par seconde et faillible. Les mélanger obligerait à
 * choisir entre ne jamais recalculer les journées et rappeler Nominatim à
 * chaque passage. Séparées, le recalcul est gratuit et les libellés s'allument
 * tout seuls quand ils arrivent (D48).
 *
 * L'invariant qui compte : **le recalcul n'écrase jamais une saisie.** Seule la
 * colonne `cells` est réécrite ; `description` et `place` appartiennent à
 * l'administrateur, pas au passage de fond.
 */

/** Cellule de ~1,1 km : la maille en deçà de laquelle le nom de lieu est le même. */
const CELL_DECIMALS = 2;

/**
 * Distance d'agglomération. Quinze kilomètres, c'est le rayon dans lequel on dit
 * « on était à Bonifacio » sans mentir ; au-delà on a bougé, et la journée porte
 * deux lieux.
 */
const CLUSTER_RADIUS_KM = 15;

/**
 * Grappes retenues par journée. Une journée de route en produirait dix, et dix
 * noms de lieu dans un en-tête ne se lisent pas — on garde les trois où le plus
 * de photos ont été prises, c'est-à-dire là où on s'est arrêté.
 */
const MAX_CLUSTERS = 3;

const EARTH_RADIUS_KM = 6371;

interface Logger {
  info: (msg: string) => void;
  debug: (msg: string) => void;
}

/** Une position, telle que `MediaRepo.geolocatedPoints` la rend. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Clé de cache d'un point : latitude et longitude arrondies à deux décimales.
 *
 * `toFixed` et non un arrondi flottant : la clé est comparée en SQL, donc deux
 * écritures du même endroit doivent produire exactement la même chaîne —
 * `-0.00` et `0.00` en sont deux, d'où le `+ 0` qui normalise le zéro négatif.
 */
export function cellKey(lat: number, lng: number): string {
  const round = (value: number): string =>
    (Number(value.toFixed(CELL_DECIMALS)) + 0).toFixed(CELL_DECIMALS);
  return `${round(lat)},${round(lng)}`;
}

/** Distance orthodromique en kilomètres. */
function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Regroupe les positions d'une journée en cellules, dans l'ordre du déroulé.
 *
 * Agglomération gloutonne : chaque point rejoint la grappe dont le barycentre
 * est à moins de `CLUSTER_RADIUS_KM`, sinon il en ouvre une. Les points doivent
 * arriver **triés chronologiquement** — c'est ce qui fait que l'ordre de
 * création des grappes est celui de leur première photo, et donc que
 * « Bonifacio, puis la plage » se lit dans le bon sens sans tri supplémentaire.
 *
 * Un k-means donnerait des grappes plus régulières, au prix d'un nombre de
 * grappes à choisir d'avance et d'un résultat qui dépend de l'initialisation :
 * deux passages sur les mêmes photos écriraient des cellules différentes, donc
 * relanceraient le géocodage pour rien.
 */
export function clusterDay(points: GeoPoint[]): string[] {
  const clusters: { lat: number; lng: number; count: number; rank: number }[] = [];

  for (const point of points) {
    const near = clusters.find((cluster) => distanceKm(cluster, point) <= CLUSTER_RADIUS_KM);
    if (near) {
      // Barycentre incrémental : la grappe suit le groupe de photos plutôt que
      // de rester accrochée à la première d'entre elles.
      near.lat += (point.lat - near.lat) / (near.count + 1);
      near.lng += (point.lng - near.lng) / (near.count + 1);
      near.count++;
      continue;
    }
    clusters.push({ lat: point.lat, lng: point.lng, count: 1, rank: clusters.length });
  }

  const kept =
    clusters.length <= MAX_CLUSTERS
      ? clusters
      : [...clusters]
          .sort((a, b) => b.count - a.count)
          .slice(0, MAX_CLUSTERS)
          // Le tri par effectif choisit lesquelles garder, pas dans quel ordre
          // les lire : l'en-tête raconte la journée, donc l'ordre reste celui
          // de la première photo de chaque grappe.
          .sort((a, b) => a.rank - b.rank);

  // Deux barycentres peuvent dériver jusqu'à tomber dans la même cellule ; le
  // même nom deux fois dans un en-tête n'apprend rien.
  return [...new Set(kept.map((cluster) => cellKey(cluster.lat, cluster.lng)))];
}

/** Ligne d'`album_days` telle qu'elle est stockée. */
interface AlbumDayRow {
  day: string;
  description: string | null;
  place: string | null;
  cells: string | null;
}

function parseCells(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((cell): cell is string => typeof cell === 'string')
      : [];
  } catch {
    // Colonne éditée à la main : la journée perd ses lieux déduits, pas sa note.
    return [];
  }
}

/** Une chaîne vide venue d'un formulaire vaut « pas de valeur ». */
function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Dépôt des journées annotées. Il lit aussi `geo_places`, parce que c'est là que
 * les clés de `cells` prennent un sens : rendre une clé `41.39,9.16` au front
 * l'obligerait à faire la jointure lui-même.
 */
export class AlbumDayRepo {
  constructor(private readonly db: Db) {}

  /**
   * Les journées de cet album **qui ont quelque chose à montrer** : une note, un
   * lieu saisi, ou au moins un lieu déduit déjà résolu. Une journée réduite à
   * des cellules dont aucune n'est encore géocodée n'a rien à afficher, et la
   * transporter grossirait la réponse d'une ligne par jour d'album.
   */
  list(albumId: string): AlbumDay[] {
    const rows = this.db
      .prepare(
        `SELECT day, description, place, cells FROM album_days
          WHERE album_id = ? ORDER BY day DESC`,
      )
      .all(albumId) as AlbumDayRow[];

    const labels = this.labels(rows.flatMap((row) => parseCells(row.cells)));

    return rows
      .map((row) => this.toAlbumDay(row, labels))
      .filter((day) => day.description !== null || day.place !== null || day.autoPlaces.length > 0);
  }

  get(albumId: string, day: string): AlbumDay | null {
    const row = this.db
      .prepare(
        `SELECT day, description, place, cells FROM album_days
          WHERE album_id = ? AND day = ?`,
      )
      .get(albumId, day) as AlbumDayRow | undefined;
    if (!row) return null;
    return this.toAlbumDay(row, this.labels(parseCells(row.cells)));
  }

  /**
   * Écrit la note d'une journée. Les champs absents restent inchangés, `null`
   * efface. La ligne est créée si la journée n'en avait pas — on peut annoter
   * une journée dont aucune photo ne porte de position.
   */
  upsertNote(albumId: string, day: string, patch: UpdateAlbumDayRequest): AlbumDay {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare('SELECT description, place FROM album_days WHERE album_id = ? AND day = ?')
      .get(albumId, day) as { description: string | null; place: string | null } | undefined;

    const description =
      patch.description === undefined
        ? (existing?.description ?? null)
        : normalize(patch.description);
    const place = patch.place === undefined ? (existing?.place ?? null) : normalize(patch.place);

    this.db
      .prepare(
        `INSERT INTO album_days (album_id, day, description, place, cells, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?)
         ON CONFLICT (album_id, day) DO UPDATE SET
           description = excluded.description,
           place = excluded.place,
           updated_at = excluded.updated_at`,
      )
      .run(albumId, day, description, place, now);

    return this.get(albumId, day)!;
  }

  /**
   * Réécrit les cellules de toutes les journées géolocalisées d'un album, et
   * retire celles qui n'ont plus ni photo positionnée ni saisie.
   *
   * `DO UPDATE SET cells` **et rien d'autre** : c'est l'invariant du module. Un
   * `excluded.description` glissé ici effacerait, à chaque passage horaire,
   * tout ce que l'administrateur a écrit.
   */
  replaceCells(albumId: string, rows: { day: string; cells: string[] }[]): void {
    const now = new Date().toISOString();
    const upsert = this.db.prepare(
      `INSERT INTO album_days (album_id, day, cells, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (album_id, day) DO UPDATE SET
         cells = excluded.cells,
         updated_at = excluded.updated_at`,
    );

    this.db.transaction(() => {
      for (const row of rows) upsert.run(albumId, row.day, JSON.stringify(row.cells), now);

      // Une journée dont les photos positionnées ont disparu de l'index —
      // dossier Drive réorganisé, `deleteStale` passé par là — ne doit pas
      // garder les lieux qu'elles portaient. Sa note, si elle en a une,
      // survit : elle ne vient pas des photos, et la journée a bien eu lieu.
      //
      // Le tri est fait en JavaScript et non par un `NOT IN (…)` : un album
      // couvrant dix ans compte des milliers de journées, soit autant de
      // paramètres liés, là où SQLite en plafonne le nombre.
      const keep = new Set(rows.map((row) => row.day));
      const existing = this.db
        .prepare('SELECT day, description, place, cells FROM album_days WHERE album_id = ?')
        .all(albumId) as AlbumDayRow[];

      const remove = this.db.prepare('DELETE FROM album_days WHERE album_id = ? AND day = ?');
      const clear = this.db.prepare(
        `UPDATE album_days SET cells = '[]', updated_at = ? WHERE album_id = ? AND day = ?`,
      );

      for (const row of existing) {
        if (keep.has(row.day)) continue;
        if (row.description === null && row.place === null) {
          remove.run(albumId, row.day);
        } else if (row.cells !== null && row.cells !== '[]') {
          clear.run(now, albumId, row.day);
        }
      }
    })();
  }

  /** Toutes les cellules citées par cet album, dédupliquées. */
  cells(albumId: string): string[] {
    const rows = this.db
      .prepare('SELECT cells FROM album_days WHERE album_id = ? AND cells IS NOT NULL')
      .all(albumId) as { cells: string | null }[];
    return [...new Set(rows.flatMap((row) => parseCells(row.cells)))];
  }

  private toAlbumDay(row: AlbumDayRow, labels: Map<string, string | null>): AlbumDay {
    return {
      day: row.day,
      description: row.description,
      place: row.place,
      // Les cellules sans libellé disparaissent au lieu de laisser un trou :
      // soit le géocodage n'est pas encore passé, soit il n'a rien trouvé, et
      // dans les deux cas il n'y a rien à afficher.
      autoPlaces: parseCells(row.cells)
        .map((cell) => labels.get(cell) ?? null)
        .filter((label): label is string => label !== null),
    };
  }

  private labels(cells: string[]): Map<string, string | null> {
    const unique = [...new Set(cells)];
    if (unique.length === 0) return new Map();
    const placeholders = unique.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT cell, label FROM geo_places WHERE cell IN (${placeholders})`)
      .all(...unique) as { cell: string; label: string | null }[];
    return new Map(rows.map((row) => [row.cell, row.label]));
  }
}

export interface PlacesPassDeps {
  /** Relu à chaque passage : un album créé depuis le démarrage compte aussi. */
  albums: () => { id: string }[];
  media: MediaRepo;
  days: AlbumDayRepo;
  /** `null` quand `GEOCODING_URL` est vide : les grappes sont calculées quand même. */
  geocoder: Geocoder | null;
  log: Logger;
}

export interface PlacesResult {
  /** Journées dont les cellules ont été (ré)écrites. */
  days: number;
  /** Appels réellement passés au géocodeur. */
  lookups: number;
}

/**
 * Un passage sur tous les albums : agrégation des positions en journées, puis
 * résolution des cellules encore inconnues.
 *
 * Branché sur le ménage horaire de `main.ts` et sur le démarrage, comme le
 * préchauffage du cache et pour la même raison : la synchronisation peut être
 * désactivée, et les lieux attendraient alors indéfiniment.
 */
export class PlacesPass {
  private running = false;

  constructor(private readonly deps: PlacesPassDeps) {}

  async run(): Promise<PlacesResult> {
    const result: PlacesResult = { days: 0, lookups: 0 };

    // Deux passages concurrents doubleraient le débit vers Nominatim, dont la
    // politique est précisément ce que le limiteur de `geocoder.ts` respecte.
    if (this.running) return result;
    this.running = true;

    try {
      for (const album of this.deps.albums()) {
        const byDay = new Map<string, GeoPoint[]>();
        for (const point of this.deps.media.geolocatedPoints(album.id)) {
          const points = byDay.get(point.day) ?? [];
          points.push({ lat: point.lat, lng: point.lng });
          byDay.set(point.day, points);
        }

        const rows = [...byDay].map(([day, points]) => ({ day, cells: clusterDay(points) }));
        this.deps.days.replaceCells(album.id, rows);
        result.days += rows.length;

        if (this.deps.geocoder) {
          result.lookups += await this.deps.geocoder.resolve(this.deps.days.cells(album.id));
        }
      }

      if (result.lookups > 0) {
        this.deps.log.info(
          `Lieux : ${result.days} journées agrégées, ${result.lookups} géocodages`,
        );
      } else {
        this.deps.log.debug(`Lieux : ${result.days} journées agrégées, aucun géocodage`);
      }

      return result;
    } finally {
      this.running = false;
    }
  }
}
