/**
 * Which language the interface speaks, and where that answer comes from.
 *
 * Three sources, in this order: what this browser was **told** to use, what its
 * user configured in the system, then English. The chosen language is a property
 * of the browser rather than of the account: a household shares one access key
 * (`users`), and one member reading French must not switch the television in the
 * living room.
 *
 * Deliberately free of React so `api/client.ts` can read the active language
 * without a hook: every request announces it with `Accept-Language`, which is how
 * the server learns which language to write its errors and emails in.
 */

import { DEFAULT_LOCALE, isLocale, resolveLocale, type Locale } from '@lukarn/shared';

const STORAGE_KEY = 'lukarn:locale';

/**
 * Explicit choice remembered by this browser, `null` when nobody has chosen.
 *
 * Tolerant reading like `lib/albumOrder.ts`: denied `localStorage` — private
 * browsing in older Safari — must fall back to the system language, never prevent
 * the page from rendering.
 */
export function readStoredLocale(): Locale | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Quota exceeded or write denied: the choice lasts for this visit only, which
    // is not worth failing a render over.
  }
}

/**
 * First supported language among the browser's preferences.
 *
 * `navigator.languages` rather than `navigator.language` alone: someone whose
 * system runs in a language the gallery does not speak often lists a second one
 * that it does, and reading only the first would send them to English.
 */
export function browserLocale(): Locale | null {
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const locale = resolveLocale(tag);
    if (locale) return locale;
  }
  return null;
}

/** The language to open with, before anyone touches the menu. */
export function initialLocale(): Locale {
  return readStoredLocale() ?? browserLocale() ?? DEFAULT_LOCALE;
}

/**
 * The language in force, mirrored outside React.
 *
 * `api/client.ts` runs outside the component tree and cannot call a hook, yet
 * every request must announce the language: the provider keeps this value in step
 * with its state.
 */
let active: Locale = DEFAULT_LOCALE;

export function activeLocale(): Locale {
  return active;
}

/**
 * Records the language in force and reflects it in the document.
 *
 * `lang` is not decoration: it decides hyphenation and how a screen reader
 * pronounces the page, and `index.html` ships with `lang="en"` — a French
 * interface read aloud in English is exactly what this prevents.
 */
export function setActiveLocale(locale: Locale): void {
  active = locale;
  document.documentElement.lang = locale;
}
