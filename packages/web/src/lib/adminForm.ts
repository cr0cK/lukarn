/**
 * Administration form normalisation and validation.
 *
 * Pure functions without React or network access. They do not replace server
 * validation — the server remains authoritative — but avoid a round trip to
 * report what is wrong. Rules come from `@lukarn/shared` so both sides reject
 * exactly the same values.
 */

import {
  ALBUM_ID_PATTERN,
  ALL_ALBUMS,
  HEX_COLOR_PATTERN,
  INSTANCE_NAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_PATTERN,
} from '@lukarn/shared';
import type { Translate } from './i18n/translate';

/**
 * Extracts a Drive folder identifier from pasted input: full URL, sharing link
 * or identifier alone.
 *
 * Drive exposes only this opaque identifier; a readable path ("My Drive/Photos")
 * is not one and is rejected rather than sent to the server, whose error would
 * be far less helpful.
 */
export function extractFolderId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  const fromPath = /\/folders\/([^/?#]+)/.exec(value);
  if (fromPath) return decodeURIComponent(fromPath[1]!);

  // Old `open?id=` and `folderview?id=` links still circulate.
  const fromQuery = /[?&]id=([^&#]+)/.exec(value);
  if (fromQuery) return decodeURIComponent(fromQuery[1]!);

  // What remains is either a bare identifier or an unreadable path or URL.
  if (/[/\\\s]/.test(value)) return null;
  return value;
}

/** Error message, or `null` when the value is acceptable. */
export function validateUsername(value: string, t: Translate): string | null {
  const username = value.trim();
  if (!username) return t('validate.username');
  if (username.length > USERNAME_MAX_LENGTH) {
    return t('validate.usernameLength', USERNAME_MAX_LENGTH);
  }
  if (!USERNAME_PATTERN.test(username)) return t('validate.identifierPattern');
  return null;
}

/** Error message, or `null`. An album identifier is also used in a URL. */
export function validateAlbumId(value: string, t: Translate): string | null {
  const id = value.trim();
  if (!id) return t('validate.albumId');
  if (!ALBUM_ID_PATTERN.test(id)) return t('validate.identifierPattern');
  return null;
}

/**
 * Error message, or `null`. While editing, an empty field means "do not change
 * the password": this is the only case where empty is valid.
 */
export function validatePassword(value: string, required: boolean, t: Translate): string | null {
  if (!value) return required ? t('validate.password') : null;
  if (value.length < PASSWORD_MIN_LENGTH) {
    return t('validate.passwordLength', PASSWORD_MIN_LENGTH);
  }
  return null;
}

/** Error message, or `null`. */
export function validateTitle(value: string, t: Translate): string | null {
  return value.trim() ? null : t('validate.title');
}

/** Error message for the instance name, or `null`. */
export function validateInstanceName(value: string, t: Translate): string | null {
  const name = value.trim();
  if (!name) return t('validate.instanceName');
  if (name.length > INSTANCE_NAME_MAX_LENGTH) {
    return t('validate.instanceNameLength', INSTANCE_NAME_MAX_LENGTH);
  }
  return null;
}

/**
 * Error message for the primary colour, or `null`.
 *
 * A native colour input can only produce `#rrggbb`, but the field beside it takes
 * a value pasted from anywhere — a design tool exporting `rgb(235 32 32)`, or a
 * three-digit form.
 */
export function validatePrimaryColor(value: string, t: Translate): string | null {
  return HEX_COLOR_PATTERN.test(value.trim()) ? null : t('validate.color');
}

/** Error message for the "Drive folder" field, or `null`. */
export function validateFolderInput(value: string, t: Translate): string | null {
  if (!value.trim()) return t('validate.folder');
  if (extractFolderId(value) === null) return t('validate.folderPattern');
  return null;
}

/**
 * Suggests an album identifier from the entered title. No accents or spaces:
 * the identifier appears in the album URL.
 */
export function slugifyAlbumId(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // The shared pattern requires starting with a letter or number.
  return slug.slice(0, USERNAME_MAX_LENGTH);
}

/** Number entered with a decimal comma or a point. `null` when unreadable. */
export function parseNumber(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

/** Error message for the sync interval, or `null`. */
export function validateIntervalMinutes(value: string, t: Translate): string | null {
  const minutes = parseNumber(value);
  if (minutes === null || !Number.isInteger(minutes)) return t('validate.interval');
  return null;
}

/** Error message for the maximum cache size, or `null`. */
export function validateCacheSizeGB(value: string, t: Translate): string | null {
  const size = parseNumber(value);
  if (size === null) return t('validate.cacheSize');
  if (size <= 0) return t('validate.cacheSizePositive');
  return null;
}

/** Number of albums named before switching to "and N others". */
const NAMED_ALBUMS = 3;

/**
 * Summarises an account's accessible albums in one line. Name the wildcard as
 * such: "all albums" and "the 12 selected albums" stop meaning the same thing
 * once the thirteenth is created.
 */
export function formatAlbumAccess(
  albums: string[],
  titles: ReadonlyMap<string, string>,
  t: Translate,
): string {
  if (albums.includes(ALL_ALBUMS)) return t('access.everyPresentAndFuture');
  if (albums.length === 0) return t('access.none');

  // A deleted album may remain in an account's list: show its raw identifier
  // rather than silently omitting it.
  const named = albums.slice(0, NAMED_ALBUMS).map((id) => titles.get(id) ?? id);
  const rest = albums.length - named.length;
  return rest > 0 ? t('access.andOthers', named.join(', '), rest) : named.join(', ');
}
