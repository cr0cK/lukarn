/**
 * Reading a catalogue, without React.
 *
 * Separate from `index.tsx` so that the parts of the application that produce
 * text but do not render — `lib/format.ts`, `lib/justify.ts`, `lib/exifRows.ts`
 * — and the tests that check them can translate without mounting a provider.
 */

import { LOCALES, type Locale } from '@lukarn/shared';
import { en, type Messages } from './messages-en';
import { fr } from './messages-fr';

export type { Messages } from './messages-en';

export type MessageKey = keyof Messages;

/**
 * Arguments a message expects: none for a fixed sentence, those of the function
 * for a message that counts or names something. Extracted from the English
 * catalogue, which makes `t('feed.view')` without its photo a compile error.
 */
type Params<K extends MessageKey> = Messages[K] extends (...args: infer A) => string ? A : [];

/**
 * The translation function, which **also carries its language**.
 *
 * `t.locale` exists so that everything speaking to a human takes one parameter
 * rather than two: `formatDate` needs the language without needing a message,
 * `dayLabel` needs both, and threading a second argument through every call site
 * would eventually see one of them passed the wrong way round.
 */
export type Translate = (<K extends MessageKey>(key: K, ...args: Params<K>) => string) & {
  locale: Locale;
};

const CATALOGUES: Record<Locale, Messages> = { en, fr };

/**
 * Language names, written in the language they name.
 *
 * Not in the catalogues: "Français" is spelt the same on an English screen, and
 * translating it would show "French" to someone looking for their own language
 * in a list they cannot read.
 */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', fr: 'Français' };

/** Supported languages, in menu order. */
export const AVAILABLE_LOCALES = LOCALES;

/** The translation function for one language. */
export function makeTranslate(locale: Locale): Translate {
  const catalogue = CATALOGUES[locale];
  const translate = <K extends MessageKey>(key: K, ...args: Params<K>): string => {
    const message = catalogue[key];
    // The catalogue is typed, so a message is either a sentence or a function of
    // its parameters; the cast only tells the compiler which one this key is.
    return typeof message === 'function'
      ? (message as (...params: unknown[]) => string)(...args)
      : message;
  };
  return Object.assign(translate, { locale });
}
