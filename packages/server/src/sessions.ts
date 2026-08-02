import { randomBytes } from 'node:crypto';
import type { Db } from './db.js';

export const SESSION_COOKIE = 'gdv_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

export interface SessionRecord {
  id: string;
  username: string;
  expiresAt: string;
}

/**
 * Sessions persistées en base plutôt qu'un JWT stateless : ça permet de couper
 * l'accès immédiatement (logout, retrait d'un utilisateur de la config) sans
 * attendre l'expiration d'un jeton déjà distribué.
 */
export class SessionStore {
  constructor(private readonly db: Db) {}

  create(username: string): SessionRecord {
    const id = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    this.db
      .prepare('INSERT INTO sessions (id, username, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(id, username, now.toISOString(), expiresAt.toISOString());

    return { id, username, expiresAt: expiresAt.toISOString() };
  }

  /** Renvoie la session si elle existe et n'est pas expirée, sinon `null`. */
  get(id: string): SessionRecord | null {
    const row = this.db
      .prepare('SELECT id, username, expires_at AS expiresAt FROM sessions WHERE id = ?')
      .get(id) as SessionRecord | undefined;

    if (!row) return null;
    if (new Date(row.expiresAt).getTime() <= Date.now()) {
      this.destroy(id);
      return null;
    }
    return row;
  }

  destroy(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  /** Coupe toutes les sessions d'un utilisateur (retiré de la config, par exemple). */
  destroyForUser(username: string): void {
    this.db.prepare('DELETE FROM sessions WHERE username = ?').run(username);
  }

  purgeExpired(): number {
    const result = this.db
      .prepare('DELETE FROM sessions WHERE expires_at <= ?')
      .run(new Date().toISOString());
    return result.changes;
  }

  get ttlMs(): number {
    return SESSION_TTL_MS;
  }
}
