/**
 * Display formatting. Every server date is UTC and represents capture time as
 * recorded by the camera: render it in UTC or a photo taken at 14:00 would appear
 * at 16:00 in a browser using Europe/Paris.
 */

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'UTC',
});

const DATE_ONLY = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' });

const MONTH_YEAR = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
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
const LOCAL_DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'long',
  timeStyle: 'short',
});

export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

/** Date of a real event — a comment — in the reader's time zone. */
export function formatLocalDateTime(iso: string): string {
  return LOCAL_DATE_TIME.format(new Date(iso));
}

export function formatDate(iso: string): string {
  return DATE_ONLY.format(new Date(iso));
}

export function formatMonthYear(iso: string): string {
  return MONTH_YEAR.format(new Date(iso));
}

/** Date range covered by an album, in one line. */
export function formatRange(oldest: string | null, newest: string | null): string | null {
  if (!oldest || !newest) return null;
  const from = formatMonthYear(oldest);
  const to = formatMonthYear(newest);
  return from === to ? from : `${from} – ${to}`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} o`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
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

export function formatCoordinates(lat: number | null, lng: number | null): string | null {
  if (lat === null || lng === null) return null;
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'O';
  return `${Math.abs(lat).toFixed(5)}° ${ns}, ${Math.abs(lng).toFixed(5)}° ${ew}`;
}

export function formatRelative(iso: string | null): string | null {
  if (!iso) return null;
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(deltaMs / 60000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
