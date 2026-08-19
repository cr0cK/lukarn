/**
 * In-memory sign-in attempt throttling.
 *
 * The application is single-process and has only a few accounts, so an in-memory
 * counter is sufficient and avoids another dependency. Blocking is progressive —
 * the first typos pass without friction, while a dictionary attack is slowed to
 * the point of uselessness.
 */

/** What identifies an attempt. The username is folded to lower case. */
export interface LoginAttempt {
  ip: string;
  username: string;
}

/**
 * The three monitored axes. The most restrictive one applies.
 *
 * The pair alone is trivial to bypass: an IP trying a thousand random usernames
 * creates a thousand one-attempt counters and is never slowed, despite triggering a
 * thousand argon2 checks — the server's most expensive computation. Conversely, a
 * distributed attack against one account would evade every pair counter.
 */
const AXES = ['couple', 'identifiant', 'ip'] as const;
type Axis = (typeof AXES)[number];

interface Rule {
  /** Failures allowed without penalty. */
  free: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const RULES: Record<Axis, Rule> = {
  // Someone mistyping a password: five free attempts, then 2 s, 4 s, 8 s… The
  // normal case, and the only one that must remain painless.
  couple: { free: 5, baseDelayMs: 2_000, maxDelayMs: 15 * 60 * 1000 },
  // The same account targeted from several addresses. Broader than the pair because
  // a family across several connections may share one account.
  identifiant: { free: 10, baseDelayMs: 2_000, maxDelayMs: 15 * 60 * 1000 },
  // One source cycling through usernames. The attempt limit is higher because a
  // shared NAT may carry several legitimate visitors, but it still exists — this is
  // what bounds argon2 CPU usage.
  ip: { free: 20, baseDelayMs: 2_000, maxDelayMs: 15 * 60 * 1000 },
};

/** Beyond this point, the series is considered over and its counter starts from zero. */
const RESET_AFTER_MS = 60 * 60 * 1000;

/**
 * Table limit. Without it, an IP trying random usernames grows memory by one entry
 * per username until exhaustion — the hourly purge only removes series older than
 * an hour, which is too late when thousands arrive each minute.
 */
const MAX_ENTRIES = 20_000;

interface Attempt {
  failures: number;
  lastFailureAt: number;
}

export class LoginThrottle {
  private readonly attempts = new Map<string, Attempt>();

  /** Milliseconds remaining before the next permitted attempt (0 = allowed). */
  blockedFor(attempt: LoginAttempt, now = Date.now()): number {
    let longest = 0;
    for (const axis of AXES) {
      longest = Math.max(longest, this.delayOn(axis, attempt, now));
    }
    return longest;
  }

  fail(attempt: LoginAttempt, now = Date.now()): void {
    for (const axis of AXES) this.bump(keyOn(axis, attempt), now);
    this.enforceBound(now);
  }

  /**
   * Delay owed by this source alone, ignoring the two axes keyed to a username.
   *
   * A route that answers the same thing to every caller has no username to be
   * blocked on, and blocking it on one would answer a question it refuses to answer:
   * a `429` keyed to an address is the oracle the uniform response exists to close.
   */
  blockedForIp(ip: string, now = Date.now()): number {
    return this.delayOn('ip', { ip, username: '' }, now);
  }

  /**
   * Counts one call against this source, and against nothing else.
   *
   * Not a failure: the counter is a function of **how much the caller asked**, never
   * of what the answers were. The `ip` axis is shared with `/auth/login`, so an
   * attacker walks it to one below its threshold with failed sign-ins and then makes
   * a single call for a candidate address — if a counter that depended on the answer
   * moved, the address was known.
   */
  countCall(ip: string, now = Date.now()): void {
    this.bump(keyOn('ip', { ip, username: '' }), now);
    this.enforceBound(now);
  }

  /**
   * Clears the pair and username counters. The IP counter survives: having a valid
   * account on the instance must not make it possible to reset an address's scanning
   * budget between bursts.
   */
  succeed(attempt: LoginAttempt): void {
    this.attempts.delete(keyOn('couple', attempt));
    this.attempts.delete(keyOn('identifiant', attempt));
  }

  /** Purges completed series so the map does not grow indefinitely. */
  purge(now = Date.now()): number {
    let removed = 0;
    for (const [key, attempt] of this.attempts) {
      if (now - attempt.lastFailureAt > RESET_AFTER_MS) {
        this.attempts.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Number of live counters. Used by tests and diagnostics. */
  get size(): number {
    return this.attempts.size;
  }

  /** One counter, one step. Shared so that counting on one axis reads the same as on three. */
  private bump(key: string, now: number): void {
    const existing = this.attempts.get(key);
    if (!existing || now - existing.lastFailureAt > RESET_AFTER_MS) {
      this.attempts.set(key, { failures: 1, lastFailureAt: now });
      return;
    }
    existing.failures++;
    existing.lastFailureAt = now;
  }

  private delayOn(axis: Axis, attempt: LoginAttempt, now: number): number {
    const key = keyOn(axis, attempt);
    const counter = this.attempts.get(key);
    if (!counter) return 0;

    if (now - counter.lastFailureAt > RESET_AFTER_MS) {
      this.attempts.delete(key);
      return 0;
    }

    const rule = RULES[axis];
    if (counter.failures <= rule.free) return 0;

    // Doubles on every failure beyond the allowance: 2s, 4s, 8s… capped.
    const penalty = Math.min(
      rule.baseDelayMs * 2 ** (counter.failures - rule.free - 1),
      rule.maxDelayMs,
    );
    return Math.max(0, counter.lastFailureAt + penalty - now);
  }

  /**
   * Brings the table below its limit: expired series first, then the oldest. Removing
   * the oldest is the right choice — their penalties are closest to expiry, while
   * recent entries are the ones slowing the current attack.
   *
   * Shrink to 90% of the limit rather than exactly the limit: otherwise every next
   * attempt would trigger another full sort, making the server pay for its defence
   * against the attack in CPU time.
   */
  private enforceBound(now: number): void {
    if (this.attempts.size <= MAX_ENTRIES) return;

    this.purge(now);
    if (this.attempts.size <= MAX_ENTRIES) return;

    const surplus = this.attempts.size - Math.floor(MAX_ENTRIES * 0.9);
    const oldest = [...this.attempts.entries()].sort(
      (a, b) => a[1].lastFailureAt - b[1].lastFailureAt,
    );
    for (const [key] of oldest.slice(0, surplus)) this.attempts.delete(key);
  }
}

function keyOn(axis: Axis, attempt: LoginAttempt): string {
  const username = attempt.username.toLowerCase();
  switch (axis) {
    // The `\0` separator can appear in neither an IP nor a username: without it,
    // `a:b` values formed from different splits would share a counter.
    case 'couple':
      return `c\0${attempt.ip}\0${username}`;
    case 'identifiant':
      return `u\0${username}`;
    case 'ip':
      return `i\0${attempt.ip}`;
  }
}
