import { randomBytes, randomInt } from 'node:crypto';
import { USER_CODE_ALPHABET, USER_CODE_LENGTH, type DevicePairingStart } from '@nonni/shared';
import { hashDeviceCode } from './crypto.js';
import type { Db } from './db.js';

/**
 * Durée de vie d'une demande. Assez pour aller chercher son téléphone, pas
 * assez pour qu'un code approuvable traîne sur un écran resté allumé.
 */
const TTL_MS = 5 * 60 * 1000;

/** Cadence de sondage annoncée au demandeur. */
export const POLL_INTERVAL_MS = 2_000;

/**
 * Borne du nombre de demandes en attente. La table est en base : une rafale de
 * demandes ne doit pas la faire grossir sans fin. Personne n'y gagne un accès —
 * au pire l'appairage devient indisponible le temps de la rafale, ce qu'une
 * rafale obtiendrait de toute façon.
 */
export const MAX_PENDING = 200;

/**
 * Tirages avant d'abandonner sur collision de code. Huit caractères sur un
 * alphabet de 32 font 40 bits : avec 200 demandes vivantes au plus, une
 * collision est déjà improbable, deux d'affilée relèvent de la panne.
 */
const CODE_ATTEMPTS = 5;

/** Une demande d'appairage vivante, telle que la page d'approbation la lit. */
export interface PairingRecord {
  userCode: string;
  /** Compte de celui qui a approuvé, `null` tant que personne ne l'a fait. */
  username: string | null;
  approvedAt: string | null;
  expiresAt: string;
}

/** Ce que rend une approbation : rejouer la sienne ne change rien, celle d'un autre est refusée. */
export type ApprovalResult = 'ok' | 'unknown' | 'taken';

/** Ce que rend un sondage. `unknown` couvre inconnu, expiré et déjà relevé. */
export type ClaimResult =
  { status: 'unknown' } | { status: 'pending' } | { status: 'approved'; username: string };

/**
 * Demandes d'appairage d'un écran sans clavier (D260809c).
 *
 * Deux valeurs de natures opposées circulent, et tout le mécanisme tient à leur
 * séparation : le `userCode` s'affiche à l'écran — donc devant toute la pièce —
 * et ne fait que désigner la demande ; le `deviceCode` n'est rendu qu'une fois,
 * au demandeur, et c'est lui seul qui relève la session.
 */
export class PairingStore {
  constructor(
    private readonly db: Db,
    private readonly secret: string,
  ) {}

  /**
   * Ouvre une demande, ou rend `null` si trop de demandes attendent déjà. Purge
   * les expirées avant de compter : sans ça, une rafale d'il y a une heure
   * fermerait l'appairage jusqu'au ménage horaire.
   */
  start(now = new Date()): DevicePairingStart | null {
    this.purgeExpired(now);

    const pending = this.db.prepare('SELECT COUNT(*) AS n FROM device_pairings').get() as {
      n: number;
    };
    if (pending.n >= MAX_PENDING) return null;

    const deviceCode = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + TTL_MS).toISOString();
    const insert = this.db.prepare(
      `INSERT INTO device_pairings (user_code, device_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
    );

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const userCode = generateUserCode();
      try {
        insert.run(userCode, hashDeviceCode(deviceCode, this.secret), now.toISOString(), expiresAt);
        return { userCode, deviceCode, expiresAt, intervalMs: POLL_INTERVAL_MS };
      } catch {
        // Collision sur la clé primaire : on retire un autre code. Toute autre
        // erreur d'écriture se reproduira à l'identique et finira en `null`,
        // c'est-à-dire en refus d'ouvrir une demande — jamais en accès accordé.
      }
    }
    return null;
  }

  /** La demande vivante portant ce code, `null` si inconnue ou expirée. */
  find(userCode: string, now = new Date()): PairingRecord | null {
    const row = this.db
      .prepare(
        `SELECT user_code AS userCode, username, approved_at AS approvedAt,
                expires_at AS expiresAt
           FROM device_pairings WHERE user_code = ? AND expires_at > ?`,
      )
      .get(userCode, now.toISOString()) as PairingRecord | undefined;
    return row ?? null;
  }

  /**
   * Inscrit qui approuve — et rien de plus. Aucune session n'est créée ici :
   * sinon un écran éteint entre-temps laisserait derrière lui une session d'un
   * an que personne n'a ouverte (D260809c).
   */
  approve(userCode: string, username: string, now = new Date()): ApprovalResult {
    const pairing = this.find(userCode, now);
    if (!pairing) return 'unknown';

    if (pairing.username !== null) {
      // Rejouer sa propre approbation n'est pas une erreur : c'est un double
      // clic, ou une page rouverte. Celle d'un autre compte, si.
      return pairing.username.toLowerCase() === username.toLowerCase() ? 'ok' : 'taken';
    }

    this.db
      .prepare('UPDATE device_pairings SET username = ?, approved_at = ? WHERE user_code = ?')
      .run(username, now.toISOString(), userCode);
    return 'ok';
  }

  /**
   * Relève une demande approuvée : rend le compte à ouvrir et **supprime** la
   * ligne. Un `deviceCode` ne vaut donc qu'une seule session ; rejoué, il tombe
   * sur la même réponse qu'un code inconnu.
   */
  claim(deviceCode: string, now = new Date()): ClaimResult {
    const row = this.db
      .prepare(
        `SELECT user_code AS userCode, username
           FROM device_pairings WHERE device_hash = ? AND expires_at > ?`,
      )
      .get(hashDeviceCode(deviceCode, this.secret), now.toISOString()) as
      { userCode: string; username: string | null } | undefined;

    if (!row) return { status: 'unknown' };
    if (row.username === null) return { status: 'pending' };

    this.forget(row.userCode);
    return { status: 'approved', username: row.username };
  }

  /** Retire une demande — relevée, refusée, ou dont le compte a disparu. */
  forget(userCode: string): void {
    this.db.prepare('DELETE FROM device_pairings WHERE user_code = ?').run(userCode);
  }

  purgeExpired(now = new Date()): number {
    return this.db
      .prepare('DELETE FROM device_pairings WHERE expires_at <= ?')
      .run(now.toISOString()).changes;
  }
}

/**
 * Huit caractères tirés au sort, sans biais : `randomInt` rejette les tirages
 * qui déséquilibreraient l'alphabet, ce qu'un modulo sur un octet ferait.
 */
function generateUserCode(): string {
  let code = '';
  for (let index = 0; index < USER_CODE_LENGTH; index++) {
    code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  }
  return code;
}
