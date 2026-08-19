/**
 * Interface translation: one catalogue per language, one hook to read it.
 *
 * No library. What a gallery needs — a key, an occasional parameter, a language
 * switch — is the part of `i18next` that fits in these files; the rest of it,
 * namespaces, lazy loading and backends, would be configuration to maintain for
 * behaviour nobody would use (D260812c).
 *
 * **English is the source.** `messages-en.ts` declares the keys and their shape;
 * `messages-fr.ts` is typed against it, so a key forgotten in French, or one whose
 * parameters do not match, fails `pnpm typecheck` rather than showing an English
 * word in a French sentence.
 *
 * This file holds only what needs React. Reading a catalogue lives in
 * `translate.ts`, which the pure modules and their tests use directly.
 */

import type { Locale } from '@lukarn/shared';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { activeLocale, sessionLocale, setActiveLocale, writeStoredLocale } from './locale';
import { makeTranslate, type Translate } from './translate';

export { AVAILABLE_LOCALES, LOCALE_NAMES, makeTranslate } from './translate';
export type { MessageKey, Messages, Translate } from './translate';

interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  adoptLocale: (offered: Locale | null) => void;
  t: Translate;
}

const I18nContext = createContext<I18n | null>(null);

/**
 * Holds the language in force for the whole application.
 *
 * Mounted above the router in `main.tsx`: a page reading a message before the
 * language is known would render one sentence in English and re-render it in
 * French, which is exactly the flicker this avoids.
 */
export function LocaleProvider({ children }: { children: ReactNode }): ReactElement {
  const [locale, setLocaleState] = useState<Locale>(() => activeLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    // Remember before rendering: switching language is a decision, and finding
    // the interface back in the other language on the next visit reads as a bug.
    writeStoredLocale(next);
    // Keeps `api/client.ts` and the `lang` attribute in step: the next request
    // must announce the language the reader has just chosen.
    setActiveLocale(next);
  }, []);

  /**
   * Takes the language a session arrived with, when nothing here has been chosen.
   *
   * Storage is left alone on purpose, unlike `setLocale`: this is a default the
   * server supplied, not a decision, and `sessionLocale` owns the precedence that
   * keeps a decision made here above it.
   */
  const adoptLocale = useCallback((offered: Locale | null) => {
    const next = sessionLocale(offered);
    if (!next) return;
    setLocaleState(next);
    setActiveLocale(next);
  }, []);

  const value = useMemo<I18n>(
    () => ({ locale, setLocale, adoptLocale, t: makeTranslate(locale) }),
    [locale, setLocale, adoptLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error('LocaleProvider is missing above this component');
  return context;
}

/** The translation function. `const t = useT();` then `t('topbar.signOut')`. */
export function useT(): Translate {
  return useI18n().t;
}

/**
 * The language in force and how to change it.
 *
 * Separate from `useT` because only the language menu changes the language,
 * while every component reads messages.
 */
export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void } {
  const { locale, setLocale } = useI18n();
  return { locale, setLocale };
}

/**
 * Offers the interface the language a session brings, which it takes only if nobody
 * has chosen one in this browser.
 *
 * Separate from `useLocale` because the two are opposite gestures: one records a
 * decision, this one supplies a default and must never be mistaken for the first.
 */
export function useAdoptLocale(): (offered: Locale | null) => void {
  return useI18n().adoptLocale;
}
