/**
 * Display formatting. Every server date is UTC and represents capture time as
 * recorded by the camera: render it in UTC or a photo taken at 14:00 would appear
 * at 16:00 in a browser using Europe/Paris.
 *
 * Every function that produces language takes `t`, the translation function,
 * which also carries the language in force (`lib/i18n`). Dates go through `Intl`
 * in that language; the words around them — "yesterday", the byte symbol, the
 * cardinal points — come from the catalogue, because "5 days ago" and "il y a
 * 5 jours" are not a formatting difference.
 */

import type { Locale } from '@lukarn/shared';
import type { Translate } from './i18n/translate';

/**
 * Regional variant used for each language.
 *
 * `en-GB` rather than `en-US`: this gallery writes "14 July 2026" and 24-hour
 * clocks, which the American variant would turn into "July 14" and "2:30 PM".
 */
const TAGS: Record<Locale, string> = { en: 'en-GB', fr: 'fr-FR' };

/**
 * Formatters cost enough to build that recreating one per row of a grid shows:
 * they are therefore made once per language and kept.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** Cached formatter for this language and this shape. */
function dateFormat(
  locale: Locale,
  kind: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}:${kind}`;
  let existing = FORMATTERS.get(key);
  if (!existing) {
    existing = new Intl.DateTimeFormat(TAGS[locale], options);
    FORMATTERS.set(key, existing);
  }
  return existing;
}

export function formatDateTime(iso: string, t: Translate): string {
  return dateFormat(t.locale, 'dateTime', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/**
 * Date of a real event — a comment — in the reader's time zone.
 *
 * The only formatter in this module not using UTC, deliberately.
 *
 * The file's reasoning applies to capture dates: `taken_at` is the camera's wall
 * time without a zone, which conversion would falsify. A comment date is the
 * opposite: a real instant when somebody pressed "Post". Showing UTC would tell
 * someone who wrote at 21:14 in Paris that it was 19:14.
 *
 * The same logic as "Today" / "Yesterday" in the grid (D31): anything relating
 * to the reader's clock is read on that clock.
 */
export function formatLocalDateTime(iso: string, t: Translate): string {
  return dateFormat(t.locale, 'localDateTime', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function formatDate(iso: string, t: Translate): string {
  return dateFormat(t.locale, 'date', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso));
}

export function formatMonthYear(iso: string, t: Translate): string {
  return dateFormat(t.locale, 'monthYear', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/** Date range covered by an album, in one line. */
export function formatRange(
  oldest: string | null,
  newest: string | null,
  t: Translate,
): string | null {
  if (!oldest || !newest) return null;
  const from = formatMonthYear(oldest, t);
  const to = formatMonthYear(newest, t);
  return from === to ? from : `${from} – ${to}`;
}

/**
 * Size in bytes, with the unit of the language in force: `B` in English, `o` in
 * French. Only the unit is translated — the prefixes k, M, G and T are the same
 * everywhere, so the catalogue holds one word rather than five.
 */
export function formatBytes(bytes: number | null, t: Translate): string {
  const unit = t('unit.byte');
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} ${unit}`;
  const prefixes = ['k', 'M', 'G', 'T'];
  let value = bytes / 1024;
  let prefix = 0;
  while (value >= 1024 && prefix < prefixes.length - 1) {
    value /= 1024;
    prefix++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${prefixes[prefix]}${unit}`;
}

export function formatDuration(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Exposure time: `1/250 s` below one second, `2 s` above. */
export function formatExposure(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  if (seconds >= 1) return `${Number(seconds.toFixed(1))} s`;
  return `1/${Math.round(1 / seconds)} s`;
}

export function formatAperture(value: number | null): string | null {
  return value === null || value <= 0 ? null : `ƒ/${Number(value.toFixed(1))}`;
}

export function formatFocalLength(mm: number | null): string | null {
  return mm === null || mm <= 0 ? null : `${Math.round(mm)} mm`;
}

/** "Canon Canon EOS R6" → "Canon EOS R6". */
export function formatCamera(make: string | null, model: string | null): string | null {
  if (!model) return make;
  if (!make) return model;
  return model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`;
}

/**
 * Coordinates with cardinal points in the language in force: west is `W` in
 * English and `O` in French — the letter that used to be hard-coded, leaving an
 * English interface announcing a French bearing.
 */
export function formatCoordinates(
  lat: number | null,
  lng: number | null,
  t: Translate,
): string | null {
  if (lat === null || lng === null) return null;
  const ns = lat >= 0 ? t('compass.north') : t('compass.south');
  const ew = lng >= 0 ? t('compass.east') : t('compass.west');
  return `${Math.abs(lat).toFixed(5)}° ${ns}, ${Math.abs(lng).toFixed(5)}° ${ew}`;
}

export function formatRelative(iso: string | null, t: Translate): string | null {
  if (!iso) return null;
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(deltaMs / 60000);

  if (minutes < 1) return t('relative.justNow');
  if (minutes < 60) return t('relative.minutes', minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('relative.hours', hours);
  const days = Math.round(hours / 24);
  return days === 1 ? t('relative.yesterday') : t('relative.days', days);
}
