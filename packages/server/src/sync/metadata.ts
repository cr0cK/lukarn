import { createHash } from 'node:crypto';
import type { MediaKind } from '@lukarn/shared';
import exifReader from 'exif-reader';
import type { ProviderMediaMetadata } from '../storage/provider.js';

/**
 * Length of a derived identifier, in hexadecimal characters.
 *
 * 128 bits: a library of a million files sits some twenty orders of magnitude below an
 * even chance of one collision, and the identifier appears in every media URL, so the
 * full forty characters would be paid on every request for nothing.
 */
const ID_LENGTH = 32;

/**
 * A media identifier for a backend that names files by path.
 *
 * The path alone will not do, twice over: two connections may hold the same one, and
 * the identifier is what a comment thread, an album cover and the disk cache are keyed
 * on. Hashing it with the connection makes it unique across an instance and stable for
 * as long as the file keeps its name.
 *
 * The accepted cost: **renaming a file gives it a new identifier, orphaning its
 * comments.** Drive is the only backend whose reference survives a rename, and no
 * amount of hashing recovers that — a folder gives us nothing else that identifies the
 * bytes. The path is kept in `media.source_path` so the file can still be fetched.
 */
export function mediaId(connectionId: string, path: string): string {
  // The separator cannot appear in a connection id — a slug — so no pair of different
  // inputs concatenates into the same string.
  return createHash('sha1').update(`${connectionId}|${path}`).digest('hex').slice(0, ID_LENGTH);
}

/**
 * Only types the browser or sharp can display enter the index — the rest of the
 * container (PDFs, documents, archives) is ignored.
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
  /** File name as the storage reports it. */
  name: string | null | undefined;
  /** `creation_time` read from the container (ISO), or `null` if unreadable. */
  containerTime: string | null;
  /** Duration known to the storage, used to move from recording end back to its start. */
  durationMs: number | null;
  /** Modification date: upload date, the final fallback. */
  modifiedTime: string;
}

export interface VideoTakenAt {
  takenAt: string;
  /** False when only the modification date remained — see `taken_at_from_exif`. */
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
 * Signed degrees from the three rationals EXIF writes and the hemisphere beside them.
 *
 * The reference letter is not decoration: EXIF stores degrees, minutes and seconds as
 * unsigned values, so a photograph taken in Chile and one taken in Poland carry the
 * same numbers and differ only by an `S` and a `W`. Dropping it puts half the world in
 * the wrong hemisphere.
 */
function toDegrees(parts: unknown, reference: unknown): number | null {
  if (!Array.isArray(parts) || parts.length < 3) return null;

  const [degrees, minutes, seconds] = parts.map(toNumber);
  if (degrees == null || minutes == null || seconds == null) return null;

  const value = degrees + minutes / 60 + seconds / 3600;
  if (!Number.isFinite(value) || value > 180) return null;

  const letter = typeof reference === 'string' ? reference.trim().toUpperCase()[0] : null;
  return letter === 'S' || letter === 'W' ? -value : value;
}

/**
 * `ProviderMediaMetadata` from the EXIF block of a photograph.
 *
 * The counterpart of what Drive returns pre-parsed in `imageMediaMetadata`: every other
 * backend hands over bytes, and this is what turns them into the same shape, so nothing
 * downstream learns which backend a photograph came from.
 *
 * Returns `null` for a block that is not readable at all. A block that is readable but
 * carries no date is **not** null — dimensions, camera and position are worth having on
 * their own, and the caller falls back to the modification date for the date alone.
 */
export function fromExifBlock(block: Buffer): ProviderMediaMetadata | null {
  let exif: ReturnType<typeof exifReader>;
  try {
    exif = exifReader(block);
  } catch {
    // A truncated window, a block that is not TIFF, a byte order marker that is not
    // one: all of them mean the same thing here, and the file's date remains.
    return null;
  }

  const image = exif.Image ?? {};
  const photo = exif.Photo ?? {};
  const gps = exif.GPSInfo ?? {};

  // `PixelXDimension` is the decoded image, which is what a viewer sees; `ImageWidth` in
  // IFD0 describes the embedded thumbnail on some cameras and would produce a 160×120
  // grid tile.
  const width = toNumber(photo.PixelXDimension) ?? toNumber(image.ImageWidth);
  const height = toNumber(photo.PixelYDimension) ?? toNumber(image.ImageLength);

  const orientation = toNumber(image.Orientation);

  // `DateTimeOriginal` is when the shutter opened; `DateTime` is when the file was last
  // written, which an edit moves. `exif-reader` reads all three as UTC, which is the
  // convention this application stores and displays in.
  const taken = photo.DateTimeOriginal ?? photo.DateTimeDigitized ?? image.DateTime;

  return {
    width,
    height,
    // 5 to 8 are the orientations that exchange the two axes. The grid computes its rows
    // from these numbers before a single thumbnail is loaded.
    rotated: orientation !== null && orientation >= 5 && orientation <= 8,
    takenAt: taken instanceof Date && !Number.isNaN(taken.getTime()) ? taken.toISOString() : null,
    cameraMake: toText(image.Make),
    cameraModel: toText(image.Model),
    lens: toText(photo.LensModel),
    isoSpeed: toNumber(photo.ISOSpeedRatings) ?? toNumber(photo.PhotographicSensitivity),
    exposureTime: toNumber(photo.ExposureTime),
    aperture: toNumber(photo.FNumber),
    focalLength: toNumber(photo.FocalLength),
    ...position(
      toDegrees(gps.GPSLatitude, gps.GPSLatitudeRef),
      toDegrees(gps.GPSLongitude, gps.GPSLongitudeRef),
    ),
    // A photograph has no duration, and a video never reaches this function.
    durationMs: null,
  };
}

/** Both or neither, for the reason given on `toCoordinates`. */
function position(
  lat: number | null,
  lng: number | null,
): { lat: number | null; lng: number | null } {
  if (lat === null || lng === null) return { lat: null, lng: null };
  if (lat === 0 && lng === 0) return { lat: null, lng: null };
  return { lat, lng };
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
