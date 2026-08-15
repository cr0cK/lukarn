/**
 * Which ramp the interface is painted with, and where that answer comes from.
 *
 * Three sources, in the same order and for the same reason as the language
 * (`lib/i18n/locale.ts`): what this browser was **told** to use, what its device
 * prefers, then dark. The choice belongs to the browser rather than to the
 * account — a household shares one access key, and one member reading in bed must
 * not turn the television in the living room white.
 *
 * Nothing here decides what anything looks like. It moves one class on `<html>`,
 * and `styles.css` binds `--color-ink-*` to the ramp that class names; every
 * `bg-ink-850` in the application follows without knowing a theme exists.
 *
 * **`public/theme.js` says the first two of these functions again**, unbundled,
 * because the choice has to be applied before the first paint and this module
 * only exists once the bundle has been fetched and parsed. `theme.test.ts` reads
 * both files and fails if they disagree.
 */

import { useSyncExternalStore } from 'react';

/** The two ramps `styles.css` declares. */
export type Theme = 'dark' | 'light';

export const THEMES: readonly Theme[] = ['dark', 'light'];

/** Fallback when nothing is stored and the device states no preference. */
export const DEFAULT_THEME: Theme = 'dark';

const STORAGE_KEY = 'lukarn:theme';

/** The class `styles.css` binds each ramp to, and `index.html` ships one of. */
const CLASS: Record<Theme, string> = { dark: 'theme-dark', light: 'theme-light' };

/**
 * What the browser paints its own chrome with, per ramp: `--color-ink-900`, the
 * page itself, so the address bar continues it rather than framing it.
 */
const BROWSER_CHROME: Record<Theme, string> = { dark: '#0b0b0d', light: '#f5f5f7' };

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

/**
 * Explicit choice remembered by this browser, `null` when nobody has chosen.
 *
 * Tolerant reading like `lib/i18n/locale.ts`: denied `localStorage` must fall back
 * to the device preference, never prevent the page from rendering.
 */
export function readStoredTheme(): Theme | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeStoredTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Quota exceeded or write denied: the choice lasts for this visit only, which
    // is not worth failing a render over.
  }
}

/**
 * What the device asks for, or `null` when it asks for nothing.
 *
 * Queried as `light` rather than as `dark` so that an engine which knows neither
 * — and answers `false` to both — falls through to the dark this gallery has
 * always been, instead of turning white on a browser too old to be asked.
 */
export function systemTheme(): Theme | null {
  if (!window.matchMedia) return null;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : null;
}

/** The theme to open with, before anyone touches the setting. */
export function initialTheme(): Theme {
  return readStoredTheme() ?? systemTheme() ?? DEFAULT_THEME;
}

/**
 * The theme in force, read from the document rather than from a variable.
 *
 * `public/theme.js` has already written it there before this module existed, so
 * a second source of truth would start out able to disagree with the page.
 */
export function activeTheme(): Theme {
  return document.documentElement.classList.contains(CLASS.light) ? 'light' : 'dark';
}

const listeners = new Set<() => void>();

/**
 * Paints the document in a theme and remembers it.
 *
 * Exactly what `public/theme.js` does on load, plus the storage write and the
 * re-render: the class and the browser chrome colour, nothing else. There is no
 * transition on purpose — a hundred surfaces easing between two palettes reads as
 * a fault, not as a flourish.
 */
export function setTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.remove(CLASS.dark, CLASS.light);
  root.classList.add(CLASS[theme]);

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = BROWSER_CHROME[theme];

  writeStoredTheme(theme);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The theme in force, re-rendering its component when it changes.
 *
 * Only the settings screen needs this — everything else follows through CSS. It
 * reads the DOM on every call, like `useInstanceName` in `lib/branding.ts`, so
 * the value React compares is the one on the page.
 */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, activeTheme, () => DEFAULT_THEME);
}
