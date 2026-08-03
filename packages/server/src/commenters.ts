import { VERIFICATION_CODE_LENGTH, type CommenterIdentity } from '@gdv/shared';
import { randomInt } from 'node:crypto';
import { hashVerificationCode, safeEqual } from './crypto.js';
import type { Db } from './db.js';

/**
 * Identités de commentateur : les personnes, par opposition aux clés d'accès de
 * `users`.
 *
 * Un identifiant et son mot de passe ouvrent des albums, et rien n'empêche de
 * les confier à toute une famille. Pour signer un commentaire il faut en
 * revanche être quelqu'un : c'est le rôle de cette table, où l'adresse email —
 * vérifiée par un code — sert de clé stable. Se ré-identifier avec la même
 * adresse depuis un autre appareil retrouve donc ses commentaires.
 *
 * L'adresse est vérifiée parce que l'identité est déclarative : sans code,
 * n'importe qui derrière la clé partagée pourrait signer du nom d'un autre, ou
 * faire arriver les notifications dans la boîte d'un tiers.
 */

/** Durée de validité d'un code. Assez pour aller chercher son email, pas plus. */
const CODE_TTL_MS = 15 * 60 * 1000;

/** Délai minimal entre deux envois à la même adresse. */
const RESEND_DELAY_MS = 60 * 1000;

/**
 * Essais avant invalidation du code. Six chiffres se parcourent en un million
 * de tentatives : sans plafond, la vérification ne vérifierait rien.
 */
const MAX_ATTEMPTS = 5;

const MAX_DISPLAY_NAME = 64;

export interface StoredCommenter {
  id: number;
  email: string;
  displayName: string;
  notify: boolean;
  verifiedAt: string | null;
}

interface CommenterRow {
  id: number;
  email: string;
  display_name: string;
  notify: number;
  verified_at: string | null;
  code_hash: string | null;
  code_expires_at: string | null;
  code_sent_at: string | null;
  code_attempts: number;
  pending_display_name: string | null;
}

function toCommenter(row: CommenterRow): StoredCommenter {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    notify: row.notify === 1,
    verifiedAt: row.verified_at,
  };
}

/** Forme exposée à son titulaire. Réduite : le reste ne le regarde pas. */
export function toIdentity(commenter: StoredCommenter): CommenterIdentity {
  return {
    email: commenter.email,
    displayName: commenter.displayName,
    notify: commenter.notify,
  };
}

/** Ce qui empêche d'envoyer un code, dans un terme que la route sait traduire. */
export type RequestFailure = 'too_soon';

/** Ce qui empêche de valider un code. */
export type VerifyFailure = 'unknown' | 'expired' | 'too_many_attempts' | 'mismatch';

export class CommenterRepo {
  constructor(
    private readonly db: Db,
    private readonly secret: string,
  ) {}

  byEmail(email: string): StoredCommenter | null {
    const row = this.db.prepare('SELECT * FROM commenters WHERE email = ?').get(email.trim()) as
      CommenterRow | undefined;
    return row ? toCommenter(row) : null;
  }

  byId(id: number): StoredCommenter | null {
    const row = this.db.prepare('SELECT * FROM commenters WHERE id = ?').get(id) as
      CommenterRow | undefined;
    return row ? toCommenter(row) : null;
  }

  /**
   * Prépare une vérification : crée l'identité si l'adresse est inconnue, tire
   * un code et le rend en clair **une seule fois**, à l'appelant qui l'enverra
   * par email. Seul son HMAC est conservé.
   *
   * Le nom fourni **n'est pas appliqué tout de suite** à une identité déjà
   * vérifiée : il attend dans `pending_display_name` que `verify` prouve qu'on
   * tient la boîte. Sans ce délai, il suffisait de connaître l'adresse de
   * quelqu'un pour la renommer — et la signature des commentaires étant relue à
   * chaque requête, tout son historique changeait de nom à la seconde, sans
   * qu'aucun code n'ait été saisi.
   *
   * Une identité pas encore vérifiée s'écrit directement : rien n'est signé
   * d'elle, il n'y a donc rien à détourner.
   */
  requestCode(
    email: string,
    displayName: string,
  ):
    | { code: string; commenter: StoredCommenter }
    | { failure: RequestFailure; retryAfterMs: number } {
    const normalized = email.trim();
    const name = displayName.trim().slice(0, MAX_DISPLAY_NAME);
    const now = Date.now();
    const existing = this.db.prepare('SELECT * FROM commenters WHERE email = ?').get(normalized) as
      CommenterRow | undefined;

    // Sans ce délai, le formulaire deviendrait un moyen d'expédier des emails en
    // rafale vers une adresse qu'on ne possède pas.
    if (existing?.code_sent_at) {
      const elapsed = now - new Date(existing.code_sent_at).getTime();
      if (elapsed < RESEND_DELAY_MS) {
        return { failure: 'too_soon', retryAfterMs: RESEND_DELAY_MS - elapsed };
      }
    }

    // `randomInt` et non `Math.random` : c'est un secret, même court-vécu.
    const code = String(randomInt(0, 10 ** VERIFICATION_CODE_LENGTH)).padStart(
      VERIFICATION_CODE_LENGTH,
      '0',
    );
    const nowIso = new Date(now).toISOString();
    const expiresAt = new Date(now + CODE_TTL_MS).toISOString();
    const hash = hashVerificationCode(normalized, code, this.secret);

    if (existing) {
      // Le nom de colonne est choisi entre deux littéraux de ce fichier, jamais
      // construit depuis la requête : rien à injecter par là.
      const column = existing.verified_at === null ? 'display_name' : 'pending_display_name';
      this.db
        .prepare(
          `UPDATE commenters
              SET ${column} = ?, code_hash = ?, code_expires_at = ?, code_sent_at = ?,
                  code_attempts = 0
            WHERE id = ?`,
        )
        .run(name, hash, expiresAt, nowIso, existing.id);
      return { code, commenter: this.byId(existing.id)! };
    }

    const result = this.db
      .prepare(
        `INSERT INTO commenters (email, display_name, code_hash, code_expires_at, code_sent_at,
                                 created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(normalized, name, hash, expiresAt, nowIso, nowIso);

    return { code, commenter: this.byId(Number(result.lastInsertRowid))! };
  }

  /**
   * Valide un code. Chaque tentative est comptée **avant** la comparaison :
   * un abandon en cours de route ne doit pas rendre des essais gratuits.
   */
  verify(email: string, code: string): { commenter: StoredCommenter } | { failure: VerifyFailure } {
    const row = this.db.prepare('SELECT * FROM commenters WHERE email = ?').get(email.trim()) as
      CommenterRow | undefined;

    if (!row || !row.code_hash || !row.code_expires_at) return { failure: 'unknown' };
    if (row.code_attempts >= MAX_ATTEMPTS) return { failure: 'too_many_attempts' };
    if (new Date(row.code_expires_at).getTime() <= Date.now()) return { failure: 'expired' };

    this.db
      .prepare('UPDATE commenters SET code_attempts = code_attempts + 1 WHERE id = ?')
      .run(row.id);

    const expected = hashVerificationCode(row.email, code.trim(), this.secret);
    if (!safeEqual(expected, row.code_hash)) return { failure: 'mismatch' };

    // Le code est consommé : le rejouer ne doit pas re-valider une adresse dont
    // on aurait retiré l'accès entre-temps. C'est aussi ici, et nulle part
    // ailleurs, qu'un renommage prend effet — la preuve vient d'être faite.
    this.db
      .prepare(
        `UPDATE commenters
            SET verified_at = COALESCE(verified_at, ?),
                display_name = COALESCE(pending_display_name, display_name),
                pending_display_name = NULL,
                code_hash = NULL, code_expires_at = NULL, code_attempts = 0
          WHERE id = ?`,
      )
      .run(new Date().toISOString(), row.id);

    return { commenter: this.byId(row.id)! };
  }

  /** Coupe les notifications sans effacer l'adresse : réabonner reste possible. */
  setNotify(id: number, notify: boolean): void {
    this.db.prepare('UPDATE commenters SET notify = ? WHERE id = ?').run(notify ? 1 : 0, id);
  }

  /**
   * Destinataires d'une notification : l'auteur de la racine du fil quand il
   * s'agit d'une réponse. L'adresse de modération est ajoutée par l'appelant —
   * elle vient des réglages, pas de cette table.
   *
   * L'auteur du message n'y figure jamais : recevoir un email pour ce qu'on
   * vient d'écrire est le premier réflexe qui fait couper les notifications.
   */
  recipientForReply(parentCommentId: number, authorId: number): StoredCommenter | null {
    const row = this.db
      .prepare(
        `SELECT c.* FROM commenters c
           JOIN comments p ON p.commenter_id = c.id
          WHERE p.id = ? AND c.id <> ? AND c.notify = 1 AND c.verified_at IS NOT NULL`,
      )
      .get(parentCommentId, authorId) as CommenterRow | undefined;
    return row ? toCommenter(row) : null;
  }
}
