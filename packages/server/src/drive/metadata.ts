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
 * Drive expose la date EXIF au format `YYYY:MM:DD HH:MM:SS`, sans fuseau —
 * c'est l'heure qu'affichait l'appareil au déclenchement. On l'interprète en
 * UTC pour que le tri et l'affichage restituent exactement cette heure-là,
 * quel que soit le fuseau du serveur ou du navigateur.
 *
 * Renvoie `null` si la chaîne est absente ou ne correspond pas au format
 * (Drive renvoie parfois `0000:00:00 00:00:00` pour un EXIF vide).
 */
export function parseExifTime(value: string | null | undefined): string | null {
  if (!value) return null;

  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  // Un EXIF nul ou une date manifestement absurde vaut moins que la date de
  // modification Drive : on préfère alors le repli.
  const year0 = date.getUTCFullYear();
  if (year0 < 1900 || year0 > 2200) return null;

  // Date.UTC est laxiste (`2023:02:31` devient le 3 mars) : on rejette les
  // dates qui ne se relisent pas à l'identique.
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;

  return date.toISOString();
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
