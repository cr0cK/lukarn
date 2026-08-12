import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { Locale } from '@lukarn/shared';
import { z } from 'zod';
import { defaultLocale } from './i18n/index.js';

/**
 * Built front end, next to the server in the monorepo. The path is calculated
 * from this module, so it is correct from both `src/` (tsx) and `dist/`
 * (production). WEB_DIR can override it for the container.
 */
const DEFAULT_WEB_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));

/**
 * Secrets must be at least 32 characters long — half the length produced by
 * `openssl rand -hex 32`, so it is easily achievable and rules out test values
 * accidentally left in production.
 */
const secret = z.string().min(32, 'must be at least 32 characters (openssl rand -hex 32)');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_URL: z.string().url().default('http://localhost:8080'),

  /**
   * Instance name: browser tab, sign-in screen, and especially the icon added
   * to a home screen. An environment variable rather than a database setting,
   * because it must have a value before an account exists — the first page served
   * is the sign-in screen, and it already carries this name.
   */
  APP_NAME: z.string().trim().min(1).default('Photos'),

  /**
   * Language used when nothing else answers: an email to the moderation address,
   * which has no commenter identity, or a browser whose `Accept-Language` names
   * no supported language. Visitors are unaffected — their browser decides, and
   * the account menu overrides it (D260812d).
   */
  DEFAULT_LOCALE: z.string().trim().default('en'),

  SESSION_SECRET: secret,
  TOKEN_KEY: secret,

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  /**
   * JSON key for a service account, as an alternative to OAuth consent.
   * When set, it takes precedence: no more "Google hasn't verified this app"
   * screen and no refresh token to renew. The service account only sees folders
   * explicitly shared with its address.
   */
  GOOGLE_SERVICE_ACCOUNT_FILE: z.string().optional(),

  // Comment notifications. A URL rather than a host/port/username/password
  // quartet: every provider documents this form, and its scheme carries the
  // encryption setting (`smtps://`).
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  /**
   * Reply address for when `MAIL_FROM` cannot receive mail. A transactional relay
   * has no inbox, and its sending domain may not have one: without this variable,
   * replying to a notification goes nowhere or bounces. When absent, no `Reply-To`
   * is set — the previous behaviour, suitable for a domain that receives mail.
   */
  MAIL_REPLY_TO: z.string().optional(),

  /**
   * Root of the reverse-geocoding service that gives EXIF coordinates a name.
   * An empty string disables it: days keep their clusters, simply without labels.
   * A private Nominatim instance goes here.
   */
  GEOCODING_URL: z.string().default('https://nominatim.openstreetmap.org'),

  CONFIG_PATH: z.string().default('./config/albums.yaml'),
  DATA_DIR: z.string().default('./data'),
  CACHE_DIR: z.string().default('./cache'),
  WEB_DIR: z.string().default(DEFAULT_WEB_DIR),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export interface Env {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  host: string;
  publicUrl: string;
  /** Displayed instance name, and application name once installed. */
  appName: string;
  /** Fallback language for what the server writes without knowing its reader. */
  defaultLocale: Locale;
  sessionSecret: string;
  tokenKey: string;
  google: { clientId: string; clientSecret: string } | null;
  /**
   * Service account, `null` when the instance uses OAuth. Both may be configured —
   * the service account is then used, while the other remains available after
   * removing the key.
   */
  serviceAccount: { email: string; privateKey: string; file: string } | null;
  /** `null` when the instance sends no email: notifications are disabled. */
  mail: { smtpUrl: string; from: string } | null;
  /**
   * Deliberately outside `mail`: the variable is independent of the
   * `SMTP_URL`/`MAIL_FROM` pair, and keeping it here makes it possible to flag
   * one that is set without a relay to use it.
   */
  mailReplyTo: string | null;
  /**
   * `null` when `GEOCODING_URL` is empty: places inferred from EXIF data are no
   * longer named, while the rest of the application is unchanged.
   */
  geocoding: { baseUrl: string; userAgent: string } | null;
  configPath: string;
  dataDir: string;
  cacheDir: string;
  webDir: string;
  logLevel: string;
  /** OAuth callback derived from PUBLIC_URL — must be declared verbatim in the GCP console. */
  oauthRedirectUri: string;
}

/**
 * Reads a service account JSON key.
 *
 * Fails explicitly instead of falling back to OAuth: a specified but unreadable
 * key is a deployment error — an unmounted path, overly restrictive permissions,
 * or a truncated file. Silently switching to the other authentication path would
 * bring back the consent screen where it had just been deliberately removed,
 * without explaining why.
 */
function readServiceAccount(file: string): { email: string; privateKey: string; file: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_FILE: "${file}" is unreadable or is not JSON ` +
        `(${(error as Error).message})`,
    );
  }

  const shape = z.object({ client_email: z.string().min(1), private_key: z.string().min(1) });
  const result = shape.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_FILE: "${file}" carries neither "client_email" nor ` +
        '"private_key". Download the key in JSON format from the Google Cloud console.',
    );
  }

  return { email: result.data.client_email, privateKey: result.data.private_key, file };
}

/**
 * Validates the shape of `SMTP_URL`.
 *
 * The targeted case is silent, which is what makes it costly: a password containing
 * an unencoded `/`, `?` or `#` **ends the address** in the middle of the credentials.
 * Nodemailer does not complain — it creates a transport to a host that is actually
 * the username, without authentication — and the instance starts normally. The
 * failure only appears on the first delivery, weeks later, as an inexplicable
 * network error.
 *
 * `new URL` rejects exactly these cases. `+`, `:` and spaces work correctly and
 * are therefore not reported: a check that raises false alarms is eventually
 * bypassed.
 */
function validateSmtpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      'SMTP_URL is not a valid URL. A password containing "/", "?" or "#" cuts the ' +
        'address short: percent-encode those characters (%2F, %3F, %23), the same way ' +
        'an email address\'s "@" becomes %40.',
    );
  }

  if (parsed.protocol !== 'smtp:' && parsed.protocol !== 'smtps:') {
    throw new Error(
      `SMTP_URL must start with "smtp://" or "smtps://", not "${parsed.protocol}//".`,
    );
  }

  if (!parsed.hostname) {
    throw new Error('SMTP_URL points at no server: the host name is missing.');
  }
}

/** One address: no spaces or angle brackets around a single `@`. */
const ADRESSE = /^[^\s<>@]+@[^\s<>@]+$/;

/**
 * Extracts the address from a "Name <address>" or "address" header, lower-cased
 * for comparison. Returns `null` if nothing resembles an address.
 *
 * Deliberately permissive about the domain — no dot required, as `@localhost` is
 * useful for tests with a local relay — and strict about signs of a typo: an
 * unclosed angle bracket, a missing or duplicate `@`, or a space in the middle.
 */
export function parseMailAddress(valeur: string): string | null {
  const brut = valeur.trim();

  const chevrons = brut.match(/<([^<>]*)>$/);
  if (chevrons) {
    const adresse = chevrons[1]!.trim();
    return ADRESSE.test(adresse) ? adresse.toLowerCase() : null;
  }

  // An angle bracket without its pair: "Galerie <galerie@exemple.fr" is sent
  // verbatim in the header, and the relay rejects or rewrites it.
  if (brut.includes('<') || brut.includes('>')) return null;

  return ADRESSE.test(brut) ? brut.toLowerCase() : null;
}

/**
 * Checks that an address variable is usable and prevents startup otherwise.
 * The reason is the same as for `SMTP_URL`: a malformed `From` header only
 * becomes visible on the first delivery, as a relay rejection with no obvious
 * connection to a typo in `.env`.
 */
function validateMailAddress(variable: string, valeur: string): void {
  if (parseMailAddress(valeur)) return;
  throw new Error(
    `${variable} carries no usable email address: "${valeur}". Accepted forms: ` +
      '"gallery@example.com" or "Gallery <gallery@example.com>".',
  );
}

/**
 * `baseDir` is the root for relative paths (CONFIG_PATH, DATA_DIR…). It is the
 * `.env` directory when one exists, so a script launched from `packages/server`
 * targets the same files as the server launched from the root.
 */
export function loadEnv(
  source: NodeJS.ProcessEnv = process.env,
  baseDir: string = process.cwd(),
): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${details}`);
  }

  const env = parsed.data;
  const publicUrl = env.PUBLIC_URL.replace(/\/+$/, '');

  // The two OAuth credentials form a pair: having only one is a silent configuration
  // error that would only appear during consent.
  const hasId = Boolean(env.GOOGLE_CLIENT_ID);
  const hasSecret = Boolean(env.GOOGLE_CLIENT_SECRET);
  if (hasId !== hasSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together (or neither).');
  }

  // Same reason as above: an instance configured with an SMTP server but no sender
  // would only fail on the first posted comment, weeks after being put into service.
  const hasSmtp = Boolean(env.SMTP_URL);
  const hasFrom = Boolean(env.MAIL_FROM);
  if (hasSmtp !== hasFrom) {
    throw new Error('SMTP_URL and MAIL_FROM must be set together (or neither).');
  }
  if (hasSmtp) validateSmtpUrl(env.SMTP_URL!);
  if (hasFrom) validateMailAddress('MAIL_FROM', env.MAIL_FROM!);

  const replyTo = env.MAIL_REPLY_TO?.trim() || null;
  if (replyTo) validateMailAddress('MAIL_REPLY_TO', replyTo);

  const geocodingUrl = env.GEOCODING_URL.trim().replace(/\/+$/, '');
  if (geocodingUrl && !URL.canParse(geocodingUrl)) {
    throw new Error(
      `GEOCODING_URL is not a valid URL: "${geocodingUrl}". Leave the variable ` +
        'empty to disable place geocoding.',
    );
  }

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    publicUrl,
    appName: env.APP_NAME,
    defaultLocale: defaultLocale(env.DEFAULT_LOCALE),
    sessionSecret: env.SESSION_SECRET,
    tokenKey: env.TOKEN_KEY,
    google:
      hasId && hasSecret
        ? { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! }
        : null,
    serviceAccount: env.GOOGLE_SERVICE_ACCOUNT_FILE
      ? readServiceAccount(resolve(baseDir, env.GOOGLE_SERVICE_ACCOUNT_FILE))
      : null,
    mail: hasSmtp && hasFrom ? { smtpUrl: env.SMTP_URL!, from: env.MAIL_FROM! } : null,
    mailReplyTo: replyTo,
    // Nominatim's usage policy requires a `User-Agent` that identifies the caller:
    // the public instance blocks anonymous agents, and a generic `node-fetch` would
    // be cut off without making the reason clear.
    geocoding: geocodingUrl ? { baseUrl: geocodingUrl, userAgent: `lukarn (+${publicUrl})` } : null,
    configPath: resolve(baseDir, env.CONFIG_PATH),
    dataDir: resolve(baseDir, env.DATA_DIR),
    cacheDir: resolve(baseDir, env.CACHE_DIR),
    webDir: resolve(baseDir, env.WEB_DIR),
    logLevel: env.LOG_LEVEL,
    oauthRedirectUri: `${publicUrl}/api/oauth/callback`,
  };
}
