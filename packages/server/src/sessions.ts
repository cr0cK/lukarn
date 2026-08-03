import { randomBytes } from 'node:crypto';
import type { Db } from './db.js';

export const SESSION_COOKIE = 'gdv_session';

/**
 * Un an, prolongé en cours de route (voir `get`). En pratique on ne se
 * déconnecte donc jamais tant qu'on utilise la galerie.
 *
 * Pourquoi pas d'expiration du tout : une session éternelle est un jeton de
 * connexion permanent — volé une fois, valable à vie — et la table grossirait
 * sans que rien ne la nettoie. Une échéance repoussée à chaque visite donne le
 * confort recherché tout en laissant s'éteindre ce qui n'est plus utilisé.
 *
 * Attention au vocabulaire : un *cookie de session* au sens HTTP, sans `maxAge`,
 * est celui qui meurt à la fermeture du navigateur — exactement l'inverse. Le
 * cookie posé ici est persistant, avec ce `maxAge`.
 */
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Seuil de prolongation. Repousser l'échéance à chaque requête coûterait une
 * écriture SQLite par vignette ; ne la repousser qu'à mi-vie ramène ça à une
 * écriture par visiteur et par semestre, pour le même résultat.
 */
const RENEW_AFTER_MS = SESSION_TTL_MS / 2;

export interface SessionRecord {
  id: string;
  username: string;
  expiresAt: string;
  /** Identité de commentateur mémorisée, `null` si personne ne s'est déclaré. */
  commenterId: number | null;
}

/**
 * Sessions persistées en base plutôt qu'un JWT stateless : ça permet de couper
 * l'accès immédiatement (logout, retrait d'un utilisateur de la config) sans
 * attendre l'expiration d'un jeton déjà distribué.
 *
 * La session porte aussi l'identité de commentateur — mais elle ne la
 * **définit** pas : c'est l'adresse email vérifiée qui identifie une personne,
 * et la session ne fait que s'en souvenir d'une visite à l'autre.
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

    return { id, username, expiresAt: expiresAt.toISOString(), commenterId: null };
  }

  /**
   * Renvoie la session si elle existe et n'est pas expirée, sinon `null`.
   * Prolonge l'échéance au passage si la session a dépassé sa mi-vie.
   */
  get(id: string): SessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, username, expires_at AS expiresAt, commenter_id AS commenterId
           FROM sessions WHERE id = ?`,
      )
      .get(id) as SessionRecord | undefined;

    if (!row) return null;

    const expiresAt = new Date(row.expiresAt).getTime();
    if (expiresAt <= Date.now()) {
      this.destroy(id);
      return null;
    }

    if (expiresAt - Date.now() < RENEW_AFTER_MS) {
      const next = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      this.db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(next, id);
      return { ...row, expiresAt: next };
    }

    return row;
  }

  /**
   * Rattache une identité vérifiée à la session. Toutes les sessions ouvertes
   * de cette même identité ne sont pas touchées : quelqu'un peut être identifié
   * sur son téléphone et pas sur l'ordinateur familial, ce qui est précisément
   * l'intérêt de porter l'identité par session plutôt que par compte.
   */
  attachCommenter(sessionId: string, commenterId: number | null): void {
    this.db
      .prepare('UPDATE sessions SET commenter_id = ? WHERE id = ?')
      .run(commenterId, sessionId);
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
