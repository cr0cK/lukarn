/**
 * The language the server writes in, and how it learns it.
 *
 * Two audiences, one catalogue. An HTTP refusal is read in the browser that sent
 * the request, which announces its language with `Accept-Language`; an email is
 * read hours later in an inbox, so its language comes from the recipient's
 * identity (`commenters.locale`), recorded from that same header (D260812d).
 *
 * Logs are **not** translated. They are read by whoever operates the instance,
 * next to a stack trace and the code itself, both of which are in English.
 */

import { DEFAULT_LOCALE, isLocale, resolveLocale, type Locale } from '@lukarn/shared';
import { en, type Messages } from './messages-en.js';
import { fr } from './messages-fr.js';

export type { Messages } from './messages-en.js';

export type MessageKey = keyof Messages;

type Params<K extends MessageKey> = Messages[K] extends (...args: infer A) => string ? A : [];

/** Same shape as the front end's: one function, carrying its language. */
export type Translate = (<K extends MessageKey>(key: K, ...args: Params<K>) => string) & {
  locale: Locale;
};

const CATALOGUES: Record<Locale, Messages> = { en, fr };

/** The translation function for one language. */
export function translator(locale: Locale): Translate {
  const catalogue = CATALOGUES[locale];
  const translate = <K extends MessageKey>(key: K, ...args: Params<K>): string => {
    const message = catalogue[key];
    return typeof message === 'function'
      ? (message as (...params: unknown[]) => string)(...args)
      : message;
  };
  return Object.assign(translate, { locale });
}

/**
 * Best supported language from an `Accept-Language` header.
 *
 * The header is parsed rather than compared: the front end sends a bare `fr`,
 * but the same routes serve unsubscribe links opened straight from an inbox,
 * where the browser sends its full preference list — `fr-CH,fr;q=0.9,en;q=0.8`.
 * Quality factors are honoured, region is dropped (`resolveLocale`), and an
 * unparsable header falls back rather than failing: a malformed header must not
 * turn a working page into a 400.
 */
export function localeFromHeader(header: string | undefined, fallback: Locale): Locale {
  if (!header) return fallback;

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...parameters] = part.trim().split(';');
      const quality = parameters
        .map((parameter) => /^\s*q=([0-9.]+)\s*$/.exec(parameter))
        .find(Boolean);
      return { tag: tag ?? '', weight: quality ? Number(quality[1]) : 1 };
    })
    // A zero weight is an explicit refusal of that language, not a weak
    // preference: keeping it would let `fr;q=0` select French.
    .filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  for (const entry of ranked) {
    const locale = resolveLocale(entry.tag);
    if (locale) return locale;
  }
  return fallback;
}

/**
 * The instance's fallback language, read from `DEFAULT_LOCALE`.
 *
 * An unrecognised value falls back to English with no fuss: an operator's typo
 * must not prevent the server from starting, and the variable only decides which
 * of two languages a stranger is addressed in.
 */
export function defaultLocale(raw: string | undefined): Locale {
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}
