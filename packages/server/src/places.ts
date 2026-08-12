import type { AlbumDay, UpdateAlbumDayRequest } from '@lukarn/shared';
import type { Db } from './db.js';
import type { Geocoder } from './geocoder.js';
import type { MediaRepo } from './repo.js';

/**
 * An album's days: the note written for them and the place already carried by their
 * photos.
 *
 * **Why there are two separate halves.** Grouping positions into clusters is
 * deterministic, immediate and offline; reverse geocoding is slow, capped at one
 * request per second and fallible. Combining them would force a choice between never
 * recalculating days and calling Nominatim on every pass. Kept separate, recalculation
 * is free and labels appear on their own when they arrive (D48).
 *
 * The important invariant: **recalculation never overwrites manual input.** Only the
 * `cells` column is rewritten; `description` and `place` belong to the administrator,
 * not the background pass.
 */

/** ~1.1 km cell: the grid size below which the place name remains the same. */
const CELL_DECIMALS = 2;

/**
 * Clustering distance. Fifteen kilometres is the radius within which "we were in
 * Bonifacio" remains true; beyond it, the group moved and the day carries two places.
 */
const CLUSTER_RADIUS_KM = 15;

/**
 * Clusters retained per day. A day on the road could produce ten, and ten place names
 * in a heading are unreadable — retain the three where most photos were taken,
 * meaning where the group stopped.
 */
const MAX_CLUSTERS = 3;

const EARTH_RADIUS_KM = 6371;

interface Logger {
  info: (msg: string) => void;
  debug: (msg: string) => void;
}

/** A position as returned by `MediaRepo.geolocatedPoints`. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Cache key for a point: latitude and longitude rounded to two decimal places.
 *
 * `toFixed` rather than floating-point rounding: the key is compared in SQL, so two
 * writes of the same place must produce exactly the same string — `-0.00` and `0.00`
 * are different, hence the `+ 0` that normalises negative zero.
 */
export function cellKey(lat: number, lng: number): string {
  const round = (value: number): string =>
    (Number(value.toFixed(CELL_DECIMALS)) + 0).toFixed(CELL_DECIMALS);
  return `${round(lat)},${round(lng)}`;
}

/** Great-circle distance in kilometres. */
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
 * Groups a day's positions into cells in chronological sequence.
 *
 * Greedy clustering: each point joins the cluster whose centroid is less than
 * `CLUSTER_RADIUS_KM` away, or opens a new one. Points must arrive **chronologically
 * sorted** — this makes cluster creation order follow their first photo, so
 * "Bonifacio, then the beach" reads in the right order without additional sorting.
 *
 * K-means would produce more regular clusters at the cost of choosing the number of
 * clusters in advance and a result dependent on initialisation: two passes over the
 * same photos could write different cells and rerun geocoding for no reason.
 */
export function clusterDay(points: GeoPoint[]): string[] {
  const clusters: { lat: number; lng: number; count: number; rank: number }[] = [];

  for (const point of points) {
    const near = clusters.find((cluster) => distanceKm(cluster, point) <= CLUSTER_RADIUS_KM);
    if (near) {
      // Incremental centroid: the cluster follows the group of photos rather than
      // remaining anchored to the first one.
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
          // Sorting by size chooses which clusters to retain, not their reading order:
          // the heading tells the day's story, so order still follows each cluster's
          // first photo.
          .sort((a, b) => a.rank - b.rank);

  // Two centroids may drift into the same cell; repeating a name in a heading adds
  // no information.
  return [...new Set(kept.map((cluster) => cellKey(cluster.lat, cluster.lng)))];
}

/** An `album_days` row as stored. */
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
    // Manually edited column: the day loses inferred places, not its note.
    return [];
  }
}

/** An empty string from a form means "no value". */
function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Annotated-day repository. It also reads `geo_places`, because that is where `cells`
 * keys acquire meaning: returning a `41.39,9.16` key to the front end would force it
 * to perform the join itself.
 */
export class AlbumDayRepo {
  constructor(private readonly db: Db) {}

  /**
   * Days in this album **that have something to show**: a note, a manually entered
   * place, or at least one already resolved inferred place. A day containing only
   * cells that have not yet been geocoded has nothing to display, and returning it
   * would add one row per album day to the response.
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
   * Writes a day's note. Absent fields remain unchanged; `null` clears them. The row
   * is created if the day had none — a day can be annotated even when none of its
   * photos carries a position.
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
   * Rewrites the cells for every geolocated day in an album and removes those with
   * neither positioned photos nor manual input remaining.
   *
   * `DO UPDATE SET cells` **and nothing else**: this is the module's invariant. An
   * `excluded.description` added here would erase everything the administrator wrote
   * on every hourly pass.
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

      // A day whose positioned photos have disappeared from the index — after a Drive
      // folder reorganisation and `deleteStale` — must not retain their places. Its
      // note, if any, survives: it does not come from the photos, and the day happened.
      //
      // Filtering happens in JavaScript rather than through `NOT IN (…)`: an album
      // spanning ten years contains thousands of days and therefore as many bound
      // parameters, whose number SQLite limits.
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

  /** All cells referenced by this album, deduplicated. */
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
      // Cells without labels disappear rather than leaving a gap: either geocoding
      // has not run yet or it found nothing, and in both cases there is nothing to show.
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
  /** Read again on every pass so an album created since startup is included too. */
  albums: () => { id: string }[];
  media: MediaRepo;
  days: AlbumDayRepo;
  /** `null` when `GEOCODING_URL` is empty: clusters are still calculated. */
  geocoder: Geocoder | null;
  log: Logger;
}

export interface PlacesResult {
  /** Days whose cells were (re)written. */
  days: number;
  /** Calls actually made to the geocoder. */
  lookups: number;
}

/**
 * One pass over all albums: aggregates positions into days, then resolves cells that
 * are still unknown.
 *
 * Runs with hourly housekeeping in `main.ts` and at startup, like cache prewarming
 * and for the same reason: synchronisation may be disabled, in which case places
 * would otherwise wait indefinitely.
 */
export class PlacesPass {
  private running = false;

  constructor(private readonly deps: PlacesPassDeps) {}

  async run(): Promise<PlacesResult> {
    const result: PlacesResult = { days: 0, lookups: 0 };

    // Two concurrent passes would double the request rate to Nominatim, whose policy
    // is precisely what the limiter in `geocoder.ts` respects.
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
        this.deps.log.info(`Places: ${result.days} days aggregated, ${result.lookups} geocodings`);
      } else {
        this.deps.log.debug(`Places: ${result.days} days aggregated, no geocoding`);
      }

      return result;
    } finally {
      this.running = false;
    }
  }
}
