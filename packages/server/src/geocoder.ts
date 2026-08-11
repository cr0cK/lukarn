import type { Db } from './db.js';

/**
 * Géocodage inverse : d'une cellule `lat,lng` vers un nom de lieu lisible.
 *
 * Le fournisseur est **Nominatim/OSM**, dont la politique d'usage plafonne à
 * une requête par seconde et exige un `User-Agent` identifiable. Deux
 * conséquences qui expliquent toute la forme de ce module :
 *
 * - **Ça ne peut pas vivre sur le chemin d'une requête HTTP.** `better-sqlite3`
 *   est synchrone et une grille demande des dizaines de journées : géocoder à
 *   la volée ferait attendre le lecteur une seconde par lieu. Le géocodage est
 *   donc un passage de fond (`places.ts`), et l'interface tient sans lui.
 * - **Le résultat se cache par cellule, pas par photo.** Deux séjours au même
 *   endroit ne comptent qu'un appel, et le cache est partagé entre albums.
 *
 * Distinction indispensable, celle qui empêche de marteler le service : un
 * géocodage **abouti sans résultat** écrit une ligne à `label = NULL` — on ne
 * redemandera plus. Un **échec réseau** n'écrit rien, et sera retenté au
 * passage suivant.
 */

/** Politique Nominatim : une requête par seconde. La marge évite d'y toucher. */
const RATE_LIMIT_MS = 1_100;

/**
 * Requêtes par passage. Une bibliothèque qui découvre mille cellules d'un coup
 * mettrait vingt minutes à les résoudre et empiéterait sur le passage suivant ;
 * le reste attend l'heure d'après, et se résout de lui-même.
 */
const MAX_LOOKUPS_PER_RUN = 200;

/** Au-delà, la requête est abandonnée : le passage a mieux à faire qu'attendre. */
const TIMEOUT_MS = 10_000;

/**
 * `zoom=12` vise l'échelle de la ville. Plus fin ramènerait un nom de rue, qui
 * ne dit rien d'une journée ; plus large, un pays, qui n'en dit pas plus.
 */
const ZOOM = 12;

interface Logger {
  info: (msg: string) => void;
  debug: (msg: string) => void;
}

export interface GeocoderConfig {
  /** Racine de l'instance Nominatim, sans `/` final. */
  baseUrl: string;
  /** Exigé par la politique d'usage : il doit identifier l'appelant. */
  userAgent: string;
}

/** Adresse structurée telle que Nominatim la rend, réduite à ce qu'on en lit. */
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
 * Compose « Bonifacio, Corse-du-Sud » à partir d'une adresse Nominatim.
 *
 * Deux composantes au plus : la ville seule est ambiguë (« Saint-Martin »), les
 * quatre du service donnent une adresse postale, pas un repère. La déduplication
 * n'est pas décorative — Nominatim rend souvent la même chaîne en `city` et en
 * `state` pour une ville-État (« Bruxelles, Bruxelles »).
 *
 * Rend `null` quand rien d'exploitable n'en sort : pleine mer, désert, ou
 * réponse vide. Le géocodage a abouti pour autant, et l'appelant l'enregistrera
 * comme tel.
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
   * Résout les cellules encore inconnues du cache. Rend le nombre d'appels
   * réellement passés — zéro quand tout était déjà connu, ce qui est le cas
   * courant dès le second passage.
   */
  async resolve(cells: string[]): Promise<number> {
    const missing = this.missing([...new Set(cells)]);
    if (missing.length === 0) return 0;

    const budget = missing.slice(0, MAX_LOOKUPS_PER_RUN);
    if (missing.length > budget.length) {
      this.log.info(
        `Géocodage : ${budget.length} cellules ce passage, ${missing.length - budget.length} ` +
          'reportées à la suivante',
      );
    }

    let done = 0;
    for (const cell of budget) {
      // L'attente précède la requête : elle garantit la cadence même quand deux
      // passages se suivent, là où attendre après laisserait partir la première
      // requête du passage suivant dans la foulée de la dernière du précédent.
      await this.wait(RATE_LIMIT_MS);

      try {
        this.remember(cell, await this.lookup(cell));
        done++;
      } catch (error) {
        // Rien n'est écrit : la cellule repassera. Une ligne « échec » serait
        // indistinguable d'un « pas de résultat », qu'on ne redemande jamais.
        this.log.debug(`Geocoding ${cell} failed : ${(error as Error).message}`);
      }
    }

    return done;
  }

  /** Cellules absentes du cache, dans l'ordre reçu. */
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
   * Un appel. Rend le libellé, ou `null` si le service a répondu sans rien
   * d'exploitable. Lève sur ce qui vaut la peine d'être retenté : réseau,
   * surcharge (429) et pannes du service (5xx).
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
        throw new Error(`Nominatim a répondu ${response.status}`);
      }
      // Un 4xx sur une coordonnée valide ne s'améliorera pas en réessayant :
      // c'est un « pas de résultat », qu'on enregistre pour ne plus demander.
      return null;
    }

    const body = (await response.json()) as { address?: NominatimAddress };
    return formatPlaceLabel(body.address);
  }

  /**
   * `protected` pour la même raison que dans `CachePrewarmer` : c'est la couture
   * qui permet aux tests de vérifier la cadence sans la subir.
   */
  protected wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
