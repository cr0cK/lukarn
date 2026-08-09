import { randomBytes } from 'node:crypto';
import type { DeviceKind } from '@gdv/shared';
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

/**
 * Plafond d'écriture de `last_seen_at`, sur le raisonnement de `RENEW_AFTER_MS`
 * ci-dessus : sans lui, chaque vignette d'une grille déclencherait un UPDATE
 * SQLite. À l'heure, la question à laquelle cette colonne répond — « cette clé
 * est-elle venue cette semaine ? » — garde exactement la même réponse.
 */
const SEEN_AFTER_MS = 60 * 60 * 1000;

export interface SessionRecord {
  id: string;
  username: string;
  expiresAt: string;
  /** Identité de commentateur mémorisée, `null` si personne ne s'est déclaré. */
  commenterId: number | null;
  /**
   * Dernière requête reçue de cette session, à l'heure près. Alimente l'onglet
   * « Visites » : `created_at` ne dit que « quelqu'un s'est connecté un jour »,
   * jamais « quelqu'un est venu cette semaine » (D260809h).
   */
  lastSeenAt: string | null;
  /**
   * Vrai quand cette lecture vient de repousser l'échéance. L'appelant doit
   * alors réémettre le cookie : sans lui, la prolongation ne vivrait qu'en
   * base et le navigateur jetterait quand même le sien à la date d'origine —
   * la session la plus assidue finirait déconnectée au bout d'un an.
   */
  renewed: boolean;
}

/**
 * Options du cookie de session, partagées entre la connexion et la
 * prolongation. Deux jeux d'options qui divergent, c'est un cookie qui change
 * de portée ou de politique `sameSite` au premier renouvellement.
 */
export function sessionCookieOptions(
  publicUrl: string,
  ttlMs: number,
): {
  path: string;
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  maxAge: number;
  signed: true;
} {
  return {
    path: '/',
    httpOnly: true,
    // `lax` laisse passer la navigation entrante (retour du callback OAuth)
    // tout en bloquant les requêtes cross-site déclenchées par un tiers.
    sameSite: 'lax',
    // En HTTP local le cookie `secure` ne serait jamais renvoyé.
    secure: publicUrl.startsWith('https://'),
    maxAge: Math.floor(ttlMs / 1000),
    signed: true,
  };
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

  /**
   * Ouvre une session. `device` est la classe d'appareil déduite du user-agent
   * de la requête de connexion — c'est le seul moment où on la lit, et elle
   * n'est pas relue ensuite : un navigateur ne change pas d'appareil en cours
   * de session.
   */
  create(username: string, device: DeviceKind | null = null): SessionRecord {
    const id = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    this.db
      .prepare(
        `INSERT INTO sessions (id, username, created_at, expires_at, last_seen_at, device)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, username, now.toISOString(), expiresAt.toISOString(), now.toISOString(), device);

    return {
      id,
      username,
      expiresAt: expiresAt.toISOString(),
      commenterId: null,
      lastSeenAt: now.toISOString(),
      renewed: false,
    };
  }

  /**
   * Renvoie la session si elle existe et n'est pas expirée, sinon `null`.
   * Prolonge l'échéance au passage si la session a dépassé sa mi-vie, et note
   * le passage si la dernière trace date de plus d'une heure.
   */
  get(id: string): SessionRecord | null {
    // `last_seen_at` ne coûte aucune lecture supplémentaire : cette ligne est
    // déjà relue à chaque requête pour vérifier l'échéance, on ajoute une
    // colonne au SELECT.
    const row = this.db
      .prepare(
        `SELECT id, username, expires_at AS expiresAt, commenter_id AS commenterId,
                last_seen_at AS lastSeenAt
           FROM sessions WHERE id = ?`,
      )
      .get(id) as Omit<SessionRecord, 'renewed'> | undefined;

    if (!row) return null;

    const now = Date.now();
    const expiresAt = new Date(row.expiresAt).getTime();
    if (expiresAt <= now) {
      this.destroy(id);
      return null;
    }

    // NULL sur une session ouverte avant la migration 15 : la première requête
    // qui la relit la date, sans quoi elle resterait invisible de l'onglet
    // « Visites » jusqu'à sa reconnexion, c'est-à-dire un an.
    const seenAt = row.lastSeenAt === null ? 0 : new Date(row.lastSeenAt).getTime();
    const lastSeenAt = now - seenAt >= SEEN_AFTER_MS ? new Date(now).toISOString() : row.lastSeenAt;
    if (lastSeenAt !== row.lastSeenAt) {
      this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(lastSeenAt, id);
    }

    if (expiresAt - now < RENEW_AFTER_MS) {
      const next = new Date(now + SESSION_TTL_MS).toISOString();
      this.db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(next, id);
      return { ...row, expiresAt: next, lastSeenAt, renewed: true };
    }

    return { ...row, lastSeenAt, renewed: false };
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
