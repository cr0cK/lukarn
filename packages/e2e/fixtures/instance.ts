import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What the throwaway instance is, and where it lives.
 *
 * One module holds every value the fixture, the server and the specs have to
 * agree on. Retyped in three places, a port or an album identifier eventually
 * differs in one of them, and the failure then reads as a broken feature rather
 * than a broken fixture.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** Repository root: `packages/e2e/fixtures` is three levels below it. */
export const ROOT = resolve(HERE, '../../..');

/** Everything this suite writes, and the only directory it ever deletes. */
export const TMP = join(ROOT, 'packages/e2e/.tmp');

export const DATA_DIR = join(TMP, 'data');
export const CACHE_DIR = join(TMP, 'cache');
export const CONFIG_PATH = join(TMP, 'config/albums.yaml');

/**
 * The **built** front end and the **built** server: the suite exercises the
 * artefact a container ships, not a dev server. A Vite dev server transforms
 * modules on demand and serves its own `index.html`, so it would prove nothing
 * about `shell.ts`, the service worker or the bundle a visitor downloads.
 */
export const WEB_DIR = join(ROOT, 'packages/web/dist');
export const SERVER_MAIN = join(ROOT, 'packages/server/dist/main.js');

/**
 * Not 8080: that is where `pnpm dev` listens, and a suite that quietly attached
 * to a developer's running instance would seed demo media into their database.
 */
export const APP_PORT = 8181;
export const BASE_URL = `http://127.0.0.1:${APP_PORT}`;

/** The convention `packages/server/test/mail.test.ts` already uses for a relay. */
export const SMTP_PORT = 1025;

/** Where the sink answers "what has been sent", over HTTP so a worker can ask. */
export const SINK_PORT = 1080;
export const SINK_URL = `http://127.0.0.1:${SINK_PORT}`;

/** The one account. Administrator, because half the suite is `/admin`. */
export const ADMIN = { username: 'alice', password: 'e2e-password-alice' };

/** Who comments. Their address is what the sink is here to intercept. */
export const COMMENTER = { name: 'Camille', email: 'camille@example.com' };

/**
 * Two albums, because two claims need different grids: day notes and places
 * only ever render in an album grouped by day, and the grouping control has to
 * have somewhere to go.
 *
 * The day album comes **first**, and that ordering is load-bearing: `seed-demo`
 * annotates days and describes photos on `albums[0]`, which `ConfigRepo` orders
 * by insertion position.
 */
export const ALBUMS = {
  day: { id: 'holidays-2025', title: 'Holidays 2025' },
  month: { id: 'family', title: 'Family photos' },
};

/**
 * Media per album — so twice this in the instance.
 *
 * Enough that the grid scrolls well past the top bar's retraction threshold on
 * a 844 px screen, and small enough that seeding stays under a minute: every
 * item is rendered five times, up to 4096 px on its longest side.
 */
export const SEED_COUNT = 40;

/**
 * The environment the server and `seed-demo` run under.
 *
 * **Every variable `env.ts` reads is set here, including the ones this instance
 * must not have.** `loadDotEnv` calls `process.loadEnvFile`, which never
 * overwrites a variable already present: naming all of them is therefore what
 * keeps a developer's `.env` — their Google credentials, their relay, their
 * `DATA_DIR` — out of the run. Leaving one out would let it through.
 */
export function instanceEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(APP_PORT),
    HOST: '127.0.0.1',
    PUBLIC_URL: BASE_URL,
    APP_NAME: 'Lukarn e2e',
    DEFAULT_LOCALE: 'en',
    // Long enough for the 32-character minimum, and fixed rather than random:
    // a session survives a `serve.ts` restart, which is what makes the suite
    // rerunnable against an instance that is already up.
    SESSION_SECRET: 'e2e-session-secret-0123456789abcdef',
    TOKEN_KEY: 'e2e-token-key-0123456789abcdef0123',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GOOGLE_SERVICE_ACCOUNT_FILE: '',
    // Required, not optional: `commentsEnabled` is derived from whether a relay
    // is configured, so without one the interface offers no comment form at all.
    SMTP_URL: `smtp://127.0.0.1:${SMTP_PORT}`,
    MAIL_FROM: 'Lukarn <gallery@example.com>',
    MAIL_REPLY_TO: '',
    // Empty on purpose: it is the one setting that would make the suite call
    // out to a third party, and a test that fails because Nominatim is slow
    // eventually gets disabled.
    GEOCODING_URL: '',
    CONFIG_PATH,
    DATA_DIR,
    CACHE_DIR,
    WEB_DIR,
    LOG_LEVEL: 'warn',
  };
}
