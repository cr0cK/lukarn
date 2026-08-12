import type { Db } from './db.js';

/**
 * Reverse geocoding: from a `lat,lng` cell to a readable place name.
 *
 * The provider is **Nominatim/OSM**, whose usage policy limits clients to one request
 * per second and requires an identifiable `User-Agent`. Two consequences explain
 * the entire shape of this module:
 *
 * - **It cannot live in an HTTP request path.** `better-sqlite3` is synchronous and
 *   a grid requests dozens of days: geocoding on demand would make the reader wait
 *   one second per place. Geocoding is therefore a background pass (`places.ts`),
 *   and the interface works without it.
 * - **Results are cached by cell, not by photo.** Two stays in the same place cost
 *   only one call, and the cache is shared between albums.
 *
 * An essential distinction prevents hammering the service: geocoding that
 * **completes without a result** writes a row with `label = NULL` and is never
 * requested again. A **network failure** writes nothing and is retried next pass.
 */

/** Nominatim policy: one request per second. The margin avoids reaching the limit. */
const RATE_LIMIT_MS = 1_100;

/**
 * Requests per pass. A library discovering a thousand cells at once would take
 * twenty minutes to resolve them and overlap the next pass; the remainder waits
 * until the following hour and resolves on its own.
 */
const MAX_LOOKUPS_PER_RUN = 200;

/** Beyond this delay, the request is abandoned: the pass has better work than waiting. */
const TIMEOUT_MS = 10_000;

/**
 * `zoom=12` targets city scale. Finer would return a street name that says nothing
 * about a day; broader would return a country that says no more.
 */
const ZOOM = 12;

interface Logger {
  info: (msg: string) => void;
  debug: (msg: string) => void;
}

export interface GeocoderConfig {
  /** Root of the Nominatim instance, without a trailing `/`. */
  baseUrl: string;
  /** Required by the usage policy: it must identify the caller. */
  userAgent: string;
}

/** Structured address returned by Nominatim, reduced to the fields being read. */
export interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  hamlet?: string;
  suburb?: string;
  state?: string;
  county?: string;
  region?: string;
  country?: string;
}

/**
 * Composes "Bonifacio, Corse-du-Sud" from a Nominatim address.
 *
 * At most two components: a city alone is ambiguous ("Saint-Martin"), while all four
 * from the service form a postal address rather than a landmark. Deduplication is
 * not decorative — Nominatim often returns the same string for `city` and `state`
 * in a city-state ("Brussels, Brussels").
 *
 * Returns `null` when nothing usable emerges: open sea, desert or an empty response.
 * Geocoding still completed, and the caller records it as such.
 */
export function formatPlaceLabel(address: NominatimAddress | undefined): string | null {
  if (!address) return null;

  const parts = [
    address.city ?? address.town ?? address.village ?? address.municipality ?? address.hamlet,
    address.state ?? address.county ?? address.region,
    address.country,
  ];

  const kept: string[] = [];
  for (const part of parts) {
    const value = part?.trim();
    if (!value) continue;
    if (kept.some((existing) => existing.toLowerCase() === value.toLowerCase())) continue;
    kept.push(value);
    if (kept.length === 2) break;
  }

  return kept.length > 0 ? kept.join(', ') : null;
}

export class Geocoder {
  constructor(
    private readonly db: Db,
    private readonly config: GeocoderConfig,
    private readonly log: Logger,
  ) {}

  /**
   * Resolves cells still unknown to the cache. Returns the number of calls actually
   * made — zero when everything was already known, as is typical from the second pass.
   */
  async resolve(cells: string[]): Promise<number> {
    const missing = this.missing([...new Set(cells)]);
    if (missing.length === 0) return 0;

    const budget = missing.slice(0, MAX_LOOKUPS_PER_RUN);
    if (missing.length > budget.length) {
      this.log.info(
        `Geocoding: ${budget.length} cells this pass, ${missing.length - budget.length} ` +
          'deferred to the next',
      );
    }

    let done = 0;
    for (const cell of budget) {
      // Waiting precedes the request: this guarantees the cadence even when two passes
      // follow each other, whereas waiting afterwards would let the next pass's first
      // request immediately follow the previous pass's last one.
      await this.wait(RATE_LIMIT_MS);

      try {
        this.remember(cell, await this.lookup(cell));
        done++;
      } catch (error) {
        // Nothing is written, so the cell returns next pass. A "failure" row would
        // be indistinguishable from "no result", which is never requested again.
        this.log.debug(`Geocoding ${cell} failed: ${(error as Error).message}`);
      }
    }

    return done;
  }

  /** Cells missing from the cache, in received order. */
  private missing(cells: string[]): string[] {
    if (cells.length === 0) return [];
    const placeholders = cells.map(() => '?').join(',');
    const known = new Set(
      (
        this.db
          .prepare(`SELECT cell FROM geo_places WHERE cell IN (${placeholders})`)
          .all(...cells) as { cell: string }[]
      ).map((row) => row.cell),
    );
    return cells.filter((cell) => !known.has(cell));
  }

  private remember(cell: string, label: string | null): void {
    this.db
      .prepare(
        `INSERT INTO geo_places (cell, label, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT (cell) DO UPDATE SET label = excluded.label, fetched_at = excluded.fetched_at`,
      )
      .run(cell, label, new Date().toISOString());
  }

  /**
   * One call. Returns the label, or `null` if the service responded with nothing
   * usable. Throws for failures worth retrying: network, overload (429) and service
   * failures (5xx).
   */
  private async lookup(cell: string): Promise<string | null> {
    const [lat, lng] = cell.split(',');
    const url =
      `${this.config.baseUrl}/reverse?format=jsonv2&lat=${lat}&lon=${lng}` +
      `&zoom=${ZOOM}&accept-language=fr`;

    const response = await fetch(url, {
      headers: { 'User-Agent': this.config.userAgent },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`Nominatim answered ${response.status}`);
      }
      // A 4xx for valid coordinates will not improve on retry: it is "no result",
      // which is recorded to prevent another request.
      return null;
    }

    const body = (await response.json()) as { address?: NominatimAddress };
    return formatPlaceLabel(body.address);
  }

  /**
   * `protected` for the same reason as in `CachePrewarmer`: this seam lets tests
   * verify the cadence without waiting through it.
   */
  protected wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
