import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { encryptSecret } from '../src/crypto.js';
import { openDb, type Db } from '../src/db.js';
import { DriveRevokedError, DriveService } from '../src/drive/service.js';
import { loadEnv, type Env } from '../src/env.js';

/**
 * Révocation du refresh token. Google renvoie `invalid_grant` dès qu'il n'est
 * plus échangeable — accès retiré, six mois d'inactivité, ou application
 * repassée en statut « Test ». Sans détection, /admin continuerait d'afficher
 * « Connecté » pendant que chaque vignette échoue.
 */

const root = mkdtempSync(join(tmpdir(), 'gdv-revoke-'));
after(() => rmSync(root, { recursive: true, force: true }));

const TOKEN_KEY = 'k'.repeat(48);

const env: Env = loadEnv({
  NODE_ENV: 'test',
  SESSION_SECRET: 's'.repeat(48),
  TOKEN_KEY,
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  CONFIG_PATH: join(root, 'albums.yaml'),
  DATA_DIR: join(root, 'data'),
  CACHE_DIR: join(root, 'cache'),
  WEB_DIR: join(root, 'web'),
} as NodeJS.ProcessEnv);

const silent = { info: () => {}, warn: () => {} };

let db: Db;
let service: DriveService;

beforeEach(() => {
  db?.close();
  rmSync(join(root, 'data'), { recursive: true, force: true });
  db = openDb(join(root, 'data'));
  service = new DriveService(env, db, silent);

  db.prepare(
    `INSERT INTO oauth_token (id, ciphertext, account, scope, granted_at, revoked_at)
     VALUES (1, ?, 'photos@exemple.fr', 'drive.readonly', '2026-01-01T00:00:00.000Z', NULL)`,
  ).run(encryptSecret('refresh-token-factice', TOKEN_KEY));
});

after(() => db?.close());

/** Erreur telle que la remonte google-auth-library après un refus du jeton. */
function invalidGrant(): Error {
  return Object.assign(new Error('invalid_grant'), {
    response: { data: { error: 'invalid_grant', error_description: 'Token has been expired' } },
  });
}

describe('détection de invalid_grant', () => {
  it('part de connecté', () => {
    assert.equal(service.connected, true);
    assert.equal(service.connection?.revokedAt, null);
  });

  it("marque la connexion révoquée et traduit l'erreur", async () => {
    await assert.rejects(
      () => service.guard(() => Promise.reject(invalidGrant())),
      DriveRevokedError,
    );

    assert.equal(service.connected, false);
    assert.notEqual(service.connection?.revokedAt, null);
    // Le compte reste lisible : /admin peut nommer l'autorisation perdue.
    assert.equal(service.connection?.account, 'photos@exemple.fr');
  });

  it('reconnaît la forme imbriquée seule', async () => {
    const nested = Object.assign(new Error('Une erreur générique'), {
      response: { data: { error: 'invalid_grant' } },
    });
    await assert.rejects(() => service.guard(() => Promise.reject(nested)), DriveRevokedError);
    assert.equal(service.connected, false);
  });

  it('laisse passer les autres erreurs sans toucher à la connexion', async () => {
    const network = new Error('ECONNRESET');
    await assert.rejects(() => service.guard(() => Promise.reject(network)), /ECONNRESET/);

    // Une coupure réseau ou un 500 de Google ne signifient pas une révocation :
    // invalider la connexion imposerait un nouveau consentement pour rien.
    assert.equal(service.connected, true);
    assert.equal(service.connection?.revokedAt, null);
  });

  it('ne perturbe pas un appel qui réussit', async () => {
    assert.equal(await service.guard(() => Promise.resolve('ok')), 'ok');
    assert.equal(service.connected, true);
  });

  it('échoue immédiatement une fois révoqué, sans rappeler Google', async () => {
    await assert.rejects(
      () => service.guard(() => Promise.reject(invalidGrant())),
      DriveRevokedError,
    );

    let appels = 0;
    await assert.rejects(async () => {
      appels++;
      await service.fetchFile('un-fichier');
    }, DriveRevokedError);

    // `fetchFile` doit refuser avant toute tentative réseau.
    assert.equal(appels, 1);
  });

  it('garde la révocation après redémarrage', async () => {
    await assert.rejects(
      () => service.guard(() => Promise.reject(invalidGrant())),
      DriveRevokedError,
    );

    // Nouveau service sur la même base : l'état est en base, pas en mémoire.
    const rechargé = new DriveService(env, db, silent);
    assert.equal(rechargé.connected, false);
    assert.notEqual(rechargé.connection?.revokedAt, null);
  });

  it('repart propre après une déconnexion manuelle', async () => {
    await assert.rejects(
      () => service.guard(() => Promise.reject(invalidGrant())),
      DriveRevokedError,
    );

    service.disconnect();
    assert.equal(service.connection, null);
    assert.equal(service.connected, false);
  });
});
