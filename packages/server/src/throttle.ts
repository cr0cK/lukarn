/**
 * Limitation des tentatives de connexion, en mémoire.
 *
 * L'app est mono-process et n'a que quelques comptes : un compteur en mémoire
 * suffit et évite une dépendance de plus. Le blocage est progressif — les
 * premières erreurs de frappe passent sans friction, une attaque par
 * dictionnaire est ralentie jusqu'à l'inutilité.
 */

const FREE_ATTEMPTS = 5;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 15 * 60 * 1000;
/** Au-delà, la série est considérée comme terminée et le compteur repart de zéro. */
const RESET_AFTER_MS = 60 * 60 * 1000;

interface Attempt {
  failures: number;
  lastFailureAt: number;
}

export class LoginThrottle {
  private readonly attempts = new Map<string, Attempt>();

  /** Millisecondes restantes avant la prochaine tentative autorisée (0 = libre). */
  blockedFor(key: string, now = Date.now()): number {
    const attempt = this.attempts.get(key);
    if (!attempt) return 0;

    if (now - attempt.lastFailureAt > RESET_AFTER_MS) {
      this.attempts.delete(key);
      return 0;
    }

    if (attempt.failures <= FREE_ATTEMPTS) return 0;

    // Doublement à chaque échec au-delà du quota : 2s, 4s, 8s… plafonné à 15 min.
    const penalty = Math.min(
      BASE_DELAY_MS * 2 ** (attempt.failures - FREE_ATTEMPTS - 1),
      MAX_DELAY_MS,
    );
    return Math.max(0, attempt.lastFailureAt + penalty - now);
  }

  fail(key: string, now = Date.now()): void {
    const attempt = this.attempts.get(key);
    if (!attempt || now - attempt.lastFailureAt > RESET_AFTER_MS) {
      this.attempts.set(key, { failures: 1, lastFailureAt: now });
      return;
    }
    attempt.failures++;
    attempt.lastFailureAt = now;
  }

  succeed(key: string): void {
    this.attempts.delete(key);
  }

  /** Purge les séries terminées, pour que la map ne grossisse pas indéfiniment. */
  purge(now = Date.now()): void {
    for (const [key, attempt] of this.attempts) {
      if (now - attempt.lastFailureAt > RESET_AFTER_MS) this.attempts.delete(key);
    }
  }
}
