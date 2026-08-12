import type { MediaKind } from '@nonni/shared';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Only types the browser or sharp can display enter the index — the rest of the Drive
 * folder (PDFs, documents, archives) is ignored.
 */
export function classify(mimeType: string | null | undefined): MediaKind | null {
  if (!mimeType) return null;
  if (mimeType.startsWith('image/')) return 'photo';
  if (mimeType.startsWith('video/')) return 'video';
  return null;
}

/**
 * Assembles a date from components read as-is, without a time zone: this is the time
 * displayed by the device, interpreted as UTC so sorting and display reproduce it
 * exactly regardless of the server or browser time zone.
 *
 * Returns `null` for anything that does not describe a real instant: a zero or absurd
 * date is less useful than the caller's fallback.
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

  // Date.UTC is permissive (`2023:02:31` becomes 3 March), so reject dates that do not
  // read back identically.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  return date.toISOString();
}

/**
 * Drive exposes the EXIF date as `YYYY:MM:DD HH:MM:SS` without a time zone — the time
 * displayed by the device when the photo was taken.
 *
 * Returns `null` if the string is absent or does not match the format (Drive sometimes
 * returns `0000:00:00 00:00:00` for empty EXIF data).
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
 * Timestamp carried by the file name — `PXL_20260729_143012.mp4`,
 * `VID_20260729_143012.mp4`, `20260729_143012.mov`. This is the device's local time
 * at the **start** of recording: exactly the convention used by photo EXIF data, so
 * it is read the same way.
 *
 * Digits after the seconds are ignored — a Pixel adds milliseconds there. A digit
 * **before** the date, however, disqualifies the match: otherwise any long number in
 * a name could be sliced into something that is not really a date.
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
 * Difference beyond which a timestamped name is treated as unrelated to the file.
 *
 * This is not a time-zone constant: it exceeds the largest real offset on Earth
 * (±14 h) plus one recording, ensuring that the name and container of the same video
 * always fall within it regardless of the clock used by each. It only rejects an
 * unrelated name — a renamed file or timestamp referring to something else.
 */
const NAME_TOLERANCE_MS = 26 * 60 * 60 * 1000;

/** Inputs used to infer a video's date, in descending order of confidence. */
export interface VideoTimeSources {
  /** File name in Drive. */
  name: string | null | undefined;
  /** `creation_time` read from the container (ISO), or `null` if unreadable. */
  containerTime: string | null;
  /** Duration reported by Drive, used to move from recording end back to its start. */
  durationMs: number | null;
  /** Drive modification date: upload date, the final fallback. */
  modifiedTime: string;
}

export interface VideoTakenAt {
  takenAt: string;
  /** False when only the Drive modification date remained — see `taken_at_from_exif`. */
  fromFile: boolean;
}

/**
 * Video capture date (D97). Drive knows none: `videoMediaMetadata` is limited to
 * dimensions and duration, so every video in an import previously landed on its
 * upload day.
 *
 * The order reflects confidence:
 *
 * 1. **The name, corroborated by the container.** It carries the device's local time
 *    at recording start, like photo EXIF data.
 * 2. **The container alone**, minus duration: its header is written when recording
 *    stops, not when it starts.
 * 3. **The name alone**, for a container that cannot be opened.
 * 4. **`modifiedTime`**, the only case that does not claim to date filming.
 *
 * Nothing here depends on a time zone or format: no offset is assumed or corrected;
 * the rule chooses between two sources written as-is. An unrecognised container falls
 * into case 3 or 4 without special handling.
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

/** Converts to a finite number, or `null`. Drive sometimes returns strings. */
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
 * Photo position, with latitude and longitude handled **together**.
 *
 * Drive returns `(0, 0)` when a photo is not geolocated. That point lies in the
 * Atlantic, so excluding it is the chosen compromise. Excluding each zero separately
 * would be entirely different — a photo taken on the equator or Greenwich meridian
 * would lose a real position.
 *
 * One coordinate alone locates nothing: if either is missing, both are returned as
 * null rather than exposing half a position.
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
