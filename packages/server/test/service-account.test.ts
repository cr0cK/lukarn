import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import argon2 from 'argon2';
import { buildApp } from '../src/app.js';
import { openDb, type Db } from '../src/db.js';
import { DriveService } from '../src/storage/drive.js';
import { loadEnv } from '../src/env.js';

/**
 * Service account authentication.
 *
 * It exists for a specific reason: Google classifies the `drive.readonly`
 * scope as "restricted", so an unverified instance displays "Google hasn't
 * verified this app" for every consent. A service account has no consent flow
 * at all — access comes from sharing the folder in Drive (D46).
 *
 * This verifies that the key takes precedence over OAuth, that a defective key
 * fails clearly instead of silently falling back to the screen it was meant to
 * remove, and that /admin stops offering actions that no longer apply.
 */

const root = mkdtempSync(join(tmpdir(), 'lukarn-sa-'));
after(() => rmSync(root, { recursive: true, force: true }));

const silencieux = { info: () => {}, warn: () => {} };

/** Fixture key: nothing here calls Google, only its shape matters. */
function ecrireCle(nom: string, contenu: unknown): string {
  const chemin = join(root, nom);
  writeFileSync(chemin, typeof contenu === 'string' ? contenu : JSON.stringify(contenu));
  return chemin;
}

function env(surcharges: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    SESSION_SECRET: 's'.repeat(48),
    TOKEN_KEY: 'k'.repeat(48),
    CONFIG_PATH: join(root, 'albums.yaml'),
    DATA_DIR: join(root, 'data'),
    CACHE_DIR: join(root, 'cache'),
    WEB_DIR: join(root, 'web'),
    ...surcharges,
  } as NodeJS.ProcessEnv;
}

const CLE_VALIDE = {
  type: 'service_account',
  client_email: 'galerie@projet.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nfactice\n-----END PRIVATE KEY-----\n',
};

describe('service account key', () => {
  it('is read and returns its address', () => {
    const chemin = ecrireCle('valide.json', CLE_VALIDE);
    const config = loadEnv(env({ GOOGLE_SERVICE_ACCOUNT_FILE: chemin }));

    assert.equal(config.serviceAccount?.email, 'galerie@projet.iam.gserviceaccount.com');
    assert.match(config.serviceAccount?.privateKey ?? '', /BEGIN PRIVATE KEY/);
  });

  it('fails clearly for a missing file', () => {
    // Silence followed by an OAuth fallback would restore the consent screen
    // that was just removed without explaining why — an unmounted container
    // path is the most likely error.
    assert.throws(
      () => loadEnv(env({ GOOGLE_SERVICE_ACCOUNT_FILE: join(root, 'nulle-part.json') })),
      /unreadable or is not JSON/,
    );
  });

  it('fails when the JSON is not a key', () => {
    const chemin = ecrireCle('incomplet.json', { type: 'service_account' });
    assert.throws(() => loadEnv(env({ GOOGLE_SERVICE_ACCOUNT_FILE: chemin })), /client_email/);
  });
});

describe('Drive service with a service account', () => {
  let db: Db;
  after(() => db?.close());

  function service(surcharges: Record<string, string | undefined> = {}): DriveService {
    db?.close();
    rmSync(join(root, 'data'), { recursive: true, force: true });
    db = openDb(join(root, 'data'));
    return new DriveService(loadEnv(env(surcharges)), db, silencieux);
  }

  it('takes precedence over OAuth when both are configured', () => {
    const chemin = ecrireCle('prioritaire.json', CLE_VALIDE);
    const drive = service({
      GOOGLE_SERVICE_ACCOUNT_FILE: chemin,
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
    });

    // Configuring both is a normal transitional state: the key is added without
    // removing the old pair. The key must win, otherwise nothing changes for
    // the operator who just added it.
    assert.equal(drive.mode, 'service_account');
    assert.equal(drive.connected, true);
    assert.equal(drive.connection?.account, 'galerie@projet.iam.gserviceaccount.com');
    // No consent means no grant date and no possible revocation.
    assert.equal(drive.connection?.grantedAt, null);
    assert.equal(drive.connection?.revokedAt, null);
  });

  it('is connected without any token in the database', () => {
    const chemin = ecrireCle('sans-jeton.json', CLE_VALIDE);
    const drive = service({ GOOGLE_SERVICE_ACCOUNT_FILE: chemin });

    // This is the point: nothing to store, nothing to decrypt and nothing that
    // expires after six months of inactivity.
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM oauth_token').get() as { n: number }).n, 0);
    assert.equal(drive.connected, true);
    assert.equal(drive.configured, true);
  });

  it('stays in OAuth mode without a key', () => {
    const drive = service({
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
    });

    assert.equal(drive.mode, 'oauth');
    // With no stored token it remains "to be connected", as before.
    assert.equal(drive.connected, false);
  });
});

describe('administration with a service account', () => {
  it('rejects consent and disconnection because they no longer apply', async () => {
    const chemin = ecrireCle('routes.json', CLE_VALIDE);
    const racine = join(root, 'app');
    const { server, context } = await buildApp(
      loadEnv({
        ...env({ GOOGLE_SERVICE_ACCOUNT_FILE: chemin }),
        DATA_DIR: join(racine, 'data'),
        CACHE_DIR: join(racine, 'cache'),
        LOG_LEVEL: 'fatal',
      } as NodeJS.ProcessEnv),
    );

    try {
      const hash = await argon2.hash('mot-de-passe-de-test', { type: argon2.argon2id });
      context.config.createUser({
        username: 'patron',
        passwordHash: hash,
        admin: true,
        albums: ['*'],
      });

      const login = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'patron', password: 'mot-de-passe-de-test' },
      });
      const session = login.cookies.find((entry) => entry.name === 'lukarn_session');
      assert.ok(session);
      const cookie = `lukarn_session=${session.value}`;

      const statut = await server.inject({
        method: 'GET',
        url: '/api/admin/status',
        headers: { cookie },
      });
      assert.equal(statut.json<{ driveMode: string }>().driveMode, 'service_account');

      // Allowing either action would store a token that nothing uses, while
      // "Disconnect" would suggest the instance is disconnected even though
      // it can still read everything.
      const consentement = await server.inject({
        method: 'GET',
        url: '/api/admin/oauth/start',
        headers: { cookie },
      });
      assert.equal(consentement.statusCode, 409);

      const deconnexion = await server.inject({
        method: 'POST',
        url: '/api/admin/drive/disconnect',
        headers: { cookie },
      });
      assert.equal(deconnexion.statusCode, 409);
    } finally {
      await server.close();
      context.close();
    }
  });
});
