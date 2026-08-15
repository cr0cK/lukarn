import type { ReleaseRef } from '@lukarn/shared';
import { z } from 'zod';

/**
 * Does a newer release exist than the one this instance runs?
 *
 * The whole feature is one question asked of one URL, and the caution around it is
 * about **who asks, and how often**. A self-hosted instance that contacts a third
 * party unprompted is a surprise its operator did not sign up for, so this asks only
 * when an administrator is looking at the answer, at most once every six hours, and
 * never at all when `UPDATE_CHECK_URL` is empty (D260815).
 *
 * Nothing here updates anything. The answer is a version and a link; moving an
 * instance from one image to another is `deploy.sh`, and it stays a decision.
 */

/** Where this software lives. The changelog link is built from it. */
const PROJECT_URL = 'https://github.com/cr0cK/lukarn';

/**
 * The changelog on the default branch rather than the release page of the version
 * being offered: it carries **every** version, so it answers both "what am I
 * running" and "what would I get" from a single link.
 */
export const CHANGELOG_URL = `${PROJECT_URL}/blob/main/CHANGELOG.md`;

/** Where "is there a newer one?" is asked when nothing overrides it. */
export const DEFAULT_UPDATE_CHECK_URL = 'https://api.github.com/repos/cr0cK/lukarn/releases/latest';

/**
 * Six hours. A release happens a few times a year; asking more often would only
 * spend somebody else's rate limit to learn the same answer.
 */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Half an hour after a failure, rather than the six hours above. A network that was
 * down when the page was opened is often back a moment later, and re-asking on the
 * next click would turn an unreachable host into one request per click.
 */
export const RETRY_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Five seconds. This runs inside a request an administrator is waiting on, and an
 * unreachable host must cost that page a blink, not a browser timeout.
 */
const REQUEST_TIMEOUT_MS = 5_000;

/**
 * What a release feed has to carry. Everything else GitHub sends is ignored: the
 * fewer fields this depends on, the less an API change can break.
 */
const releaseSchema = z.object({ tag_name: z.string(), html_url: z.string().url() });

interface Logger {
  warn(message: string): void;
  debug(message: string): void;
}

export interface UpdateCheckerOptions {
  /** Version this instance runs — `env.appVersion`. */
  currentVersion: string;
  /** Feed to ask, or `null` when the instance asks nobody. */
  url: string | null;
  log: Logger;
  /** Injected by the tests; the real one is the platform's. */
  fetch?: typeof globalThis.fetch;
  /** Injected by the tests, to age the cache without waiting six hours. */
  now?: () => number;
}

/**
 * Three numbers, or nothing.
 *
 * Deliberately strict: `dev`, `1.2`, `1.2.3-rc.1` and a branch name all return
 * `null`, and an unreadable version on either side means **no** notification. A
 * loose parser here would offer a release candidate to an instance in service, or
 * announce an update to a machine built from a branch — being wrong is worse than
 * being silent, since the whole point is that the badge means something.
 */
export function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Is `candidate` a later version than `current`?
 *
 * Compared number by number, never as text: `1.10.0` is above `1.9.0`, and a string
 * comparison says the opposite — the classic way a version check goes quiet exactly
 * when a project reaches its tenth minor release.
 */
export function isNewer(candidate: string, current: string): boolean {
  const left = parseVersion(candidate);
  const right = parseVersion(current);
  if (!left || !right) return false;
  for (let rank = 0; rank < 3; rank++) {
    if (left[rank]! !== right[rank]!) return left[rank]! > right[rank]!;
  }
  return false;
}

/**
 * Asks — rarely — whether a newer release exists, and remembers the answer.
 *
 * One instance for the process, held by `AppContext`. Its cache is in memory and
 * intentionally not persisted: the question is cheap, the answer is worthless after
 * a restart, and a table for it would be a migration for one row.
 */
export class UpdateChecker {
  private readonly fetch: typeof globalThis.fetch;
  private readonly now: () => number;
  /** Last answer and when it was obtained; `null` until the first question. */
  private cache: { at: number; ok: boolean; release: ReleaseRef | null } | null = null;
  /** The request under way, so two administrators do not each start one. */
  private pending: Promise<ReleaseRef | null> | null = null;

  constructor(private readonly options: UpdateCheckerOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  /**
   * The newer release, or `null` when there is nothing to report.
   *
   * Two of the three ways of answering `null` cost nothing at all: an instance whose
   * version cannot be read — every build outside a release, including `pnpm dev` —
   * has nothing to compare against, and one with no feed configured has nobody to
   * ask. Neither opens a socket, which is what makes "empty disables it" a true
   * statement rather than a documented intention.
   */
  async available(): Promise<ReleaseRef | null> {
    if (!this.options.url || !parseVersion(this.options.currentVersion)) return null;

    const cached = this.cache;
    if (cached) {
      const age = this.now() - cached.at;
      if (age < (cached.ok ? CHECK_INTERVAL_MS : RETRY_INTERVAL_MS)) return cached.release;
    }

    // A second caller joins the request in flight instead of starting its own: the
    // administration page and the account menu ask within milliseconds of each other.
    this.pending ??= this.ask(this.options.url).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async ask(url: string): Promise<ReleaseRef | null> {
    try {
      const response = await this.fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          // GitHub refuses an anonymous caller without one, and a generic agent
          // would be indistinguishable from any other script sharing the address.
          'User-Agent': `lukarn/${this.options.currentVersion}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const parsed = releaseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error('unexpected payload');

      const version = parsed.data.tag_name.replace(/^v/, '');
      const release = isNewer(version, this.options.currentVersion)
        ? { version, url: parsed.data.html_url }
        : null;

      this.cache = { at: this.now(), ok: true, release };
      if (release) this.options.log.debug(`Version ${release.version} is available`);
      return release;
    } catch (error) {
      // Warned rather than raised: not knowing whether an update exists changes
      // nothing about serving photos, and the negative cache above means this line
      // appears at most twice an hour, not once per click.
      this.options.log.warn(`Could not check for a newer version: ${(error as Error).message}`);
      this.cache = { at: this.now(), ok: false, release: this.cache?.release ?? null };
      return this.cache.release;
    }
  }
}
