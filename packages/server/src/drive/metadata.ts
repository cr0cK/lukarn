import type { MediaKind } from '@gdv/shared';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Seuls les types que le navigateur ou sharp savent afficher entrent dans
 * l'index — le reste du dossier Drive (PDF, docs, archives) est ignoré.
 */
export function classify(mimeType: string | null | undefined): MediaKind | null {
  if (!mimeType) return null;
  if (mimeType.startsWith('image/')) return 'photo';
  if (mimeType.startsWith('video/')) return 'video';
  return null;
}

/**
 * Assemble une date à partir de composantes lues telles quelles, sans fuseau :
 * c'est l'heure qu'affichait l'appareil, interprétée en UTC pour que le tri et
 * l'affichage la restituent exactement, quel que soit le fuseau du serveur ou
 * du navigateur.
 *
 * Rend `null` sur tout ce qui ne décrit pas un instant réel : une date nulle ou
 * absurde vaut moins que le repli de l'appelant.
 */
function utcFromParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): string | null {
  if (year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (Number.isNaN(date.getTime())) return null;

  // Date.UTC est laxiste (`2023:02:31` devient le 3 mars) : on rejette les
  // dates qui ne se relisent pas à l'identique.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  return date.toISOString();
}

/**
 * Drive expose la date EXIF au format `YYYY:MM:DD HH:MM:SS`, sans fuseau —
 * c'est l'heure qu'affichait l'appareil au déclenchement.
 *
 * Renvoie `null` si la chaîne est absente ou ne correspond pas au format
 * (Drive renvoie parfois `0000:00:00 00:00:00` pour un EXIF vide).
 */
export function parseExifTime(value: string | null | undefined): string | null {
  if (!value) return null;

  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  return utcFromParts(
    Number(year),
    Number(month),
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

/**
 * Horodatage porté par le nom du fichier — `PXL_20260729_143012.mp4`,
 * `VID_20260729_143012.mp4`, `20260729_143012.mov`. C'est l'heure locale de
 * l'appareil au **début** de l'enregistrement : exactement la convention de
 * l'EXIF d'une photo, donc lue de la même façon.
 *
 * Les chiffres qui suivent les secondes sont ignorés — un Pixel y ajoute les
 * millièmes. Un chiffre **avant** la date, en revanche, disqualifie la
 * correspondance : sans cela, un long nombre quelconque dans le nom se
 * découperait en une date qui n'en est pas une.
 */
export function parseNameTime(name: string | null | undefined): string | null {
  if (!name) return null;

  const match = /(?<!\d)(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/.exec(name);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  return utcFromParts(
    Number(year),
    Number(month),
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

/**
 * Écart au-delà duquel un nom horodaté est tenu pour étranger au fichier.
 *
 * Ce n'est pas une constante horaire : elle dépasse le plus grand décalage réel
 * sur Terre (±14 h) augmenté d'un enregistrement, de sorte que le nom et le
 * conteneur d'une même vidéo tombent toujours dedans, quelle que soit l'horloge
 * dans laquelle chacun est écrit. Elle ne sert qu'à écarter un nom sans rapport
 * — un fichier renommé, un horodatage qui désigne autre chose.
 */
const NAME_TOLERANCE_MS = 26 * 60 * 60 * 1000;

/** Ce dont la date d'une vidéo se déduit, par ordre de confiance décroissant. */
export interface VideoTimeSources {
  /** Nom du fichier dans Drive. */
  name: string | null | undefined;
  /** `creation_time` lu dans le conteneur (ISO), ou `null` s'il est illisible. */
  containerTime: string | null;
  /** Durée annoncée par Drive, qui remonte de la fin de l'enregistrement à son début. */
  durationMs: number | null;
  /** Date de modification Drive : la date de téléversement, dernier repli. */
  modifiedTime: string;
}

export interface VideoTakenAt {
  takenAt: string;
  /** Faux quand seule la date de modification Drive restait — voir `taken_at_from_exif`. */
  fromFile: boolean;
}

/**
 * Date de prise de vue d'une vidéo (D97). Drive n'en connaît aucune :
 * `videoMediaMetadata` se limite aux dimensions et à la durée, si bien que
 * toutes les vidéos d'un import atterrissaient le jour du téléversement.
 *
 * L'ordre est celui de la confiance :
 *
 * 1. **Le nom, corroboré par le conteneur.** Il porte l'heure locale de
 *    l'appareil au début de l'enregistrement, comme l'EXIF d'une photo.
 * 2. **Le conteneur seul**, moins la durée : son en-tête est écrit à l'arrêt de
 *    l'enregistrement, pas à son déclenchement.
 * 3. **Le nom seul**, pour un conteneur qu'on ne sait pas ouvrir.
 * 4. **`modifiedTime`**, et c'est le seul cas qui ne prétend pas dater le
 *    tournage.
 *
 * Rien ici n'est propre à un fuseau ni à un format : aucun décalage n'est
 * supposé ni corrigé, la règle choisit entre deux sources écrites telles
 * quelles. Un conteneur non reconnu tombe en 3 ou en 4 sans traitement à part.
 */
export function resolveVideoTakenAt({
  name,
  containerTime,
  durationMs,
  modifiedTime,
}: VideoTimeSources): VideoTakenAt {
  const nameTime = parseNameTime(name);

  if (nameTime !== null && containerTime !== null) {
    const ecart = Math.abs(Date.parse(nameTime) - Date.parse(containerTime));
    if (ecart <= NAME_TOLERANCE_MS) return { takenAt: nameTime, fromFile: true };
  }

  if (containerTime !== null) {
    const fin = Date.parse(containerTime);
    return { takenAt: new Date(fin - (durationMs ?? 0)).toISOString(), fromFile: true };
  }

  if (nameTime !== null) return { takenAt: nameTime, fromFile: true };

  return { takenAt: new Date(modifiedTime).toISOString(), fromFile: false };
}

/** Convertit en nombre fini, ou `null`. Drive renvoie parfois des chaînes. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Position d'une photo, latitude et longitude traitées **ensemble**.
 *
 * Drive renvoie le couple `(0, 0)` quand la photo n'est pas géolocalisée. Ce
 * point est au milieu de l'Atlantique : l'écarter est le compromis retenu.
 * Écarter chaque zéro séparément serait tout autre chose — une photo prise sur
 * l'équateur ou sur le méridien de Greenwich perdrait sa position alors qu'elle
 * en a bien une.
 *
 * Une coordonnée seule ne situe rien : si l'une des deux manque, les deux sont
 * rendues nulles plutôt que d'afficher une demi-position.
 */
export function toCoordinates(
  latitude: unknown,
  longitude: unknown,
): { lat: number | null; lng: number | null } {
  const lat = toNumber(latitude);
  const lng = toNumber(longitude);

  if (lat === null || lng === null) return { lat: null, lng: null };
  if (lat === 0 && lng === 0) return { lat: null, lng: null };
  return { lat, lng };
}
