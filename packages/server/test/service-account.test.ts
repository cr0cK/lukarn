import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import argon2 from 'argon2';
import { buildApp } from '../src/app.js';
import { openDb, type Db } from '../src/db.js';
import { DriveService } from '../src/drive/service.js';
import { loadEnv } from '../src/env.js';

/**
 * Authentification par compte de service.
 *
 * Elle existe pour une raison précise : le scope `drive.readonly` est
 * « restreint » chez Google, si bien qu'une instance non vérifiée affiche
 * « Google n'a pas validé cette application » à chaque consentement. Un compte
 * de service n'a pas de consentement du tout — l'accès vient du partage du
 * dossier côté Drive (D46).
 *
 * Ce qui est vérifié ici : la clé prend bien le pas sur OAuth, une clé
 * défectueuse échoue franchement au lieu de retomber en silence sur l'écran
 * qu'on cherchait à supprimer, et /admin cesse de proposer ce qui n'a plus de
 * sens.
 */

const root = mkdtempSync(join(tmpdir(), 'nonni-sa-'));
after(() => rmSync(root, { recursive: true, force: true }));

const silencieux = { info: () => {}, warn: () => {} };

/** Clé de complaisance : rien ici n'appelle Google, seule la forme compte. */
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

describe('clé de compte de service', () => {
  it('est lue et rend son adresse', () => {
    const chemin = ecrireCle('valide.json', CLE_VALIDE);
    const config = loadEnv(env({ GOOGLE_SERVICE_ACCOUNT_FILE: chemin }));

    assert.equal(config.serviceAccount?.email, 'galerie@projet.iam.gserviceaccount.com');
    assert.match(config.serviceAccount?.privateKey ?? '', /BEGIN PRIVATE KEY/);
  });

  it('échoue franchement sur un fichier absent', () => {
    // Silence puis repli sur OAuth ferait réapparaître l'écran de consentement
    // là où on venait de le supprimer, sans dire pourquoi — un chemin non monté
    // dans le conteneur est l'erreur la plus probable.
    assert.throws(
      () => loadEnv(env({ GOOGLE_SERVICE_ACCOUNT_FILE: join(root, 'nulle-part.json') })),
      /illisible ou n'est pas du JSON/,
    );
  });

  it('échoue sur un JSON qui n’est pas une clé', () => {
    const chemin = ecrireCle('incomplet.json', { type: 'service_account' });
    assert.throws(() => loadEnv(env({ GOOGLE_SERVICE_ACCOUNT_FILE: chemin })), /client_email/);
  });
});

describe('service Drive en compte de service', () => {
  let db: Db;
  after(() => db?.close());

  function service(surcharges: Record<string, string | undefined> = {}): DriveService {
    db?.close();
    rmSync(join(root, 'data'), { recursive: true, force: true });
    db = openDb(join(root, 'data'));
    return new DriveService(loadEnv(env(surcharges)), db, silencieux);
  }

  it('prend le pas sur OAuth quand les deux sont configurés', () => {
    const chemin = ecrireCle('prioritaire.json', CLE_VALIDE);
    const drive = service({
      GOOGLE_SERVICE_ACCOUNT_FILE: chemin,
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
    });

    // Configurer les deux est un état transitoire normal : on ajoute la clé
    // sans effacer l'ancien couple. C'est la clé qui doit gagner, sinon rien
    // ne changerait pour celui qui vient de la poser.
    assert.equal(drive.mode, 'service_account');
    assert.equal(drive.connected, true);
    assert.equal(drive.connection?.account, 'galerie@projet.iam.gserviceaccount.com');
    // Pas de consentement, donc pas de date d'octroi ni de révocation possible.
    assert.equal(drive.connection?.grantedAt, null);
    assert.equal(drive.connection?.revokedAt, null);
  });

  it('est connecté sans le moindre jeton en base', () => {
    const chemin = ecrireCle('sans-jeton.json', CLE_VALIDE);
    const drive = service({ GOOGLE_SERVICE_ACCOUNT_FILE: chemin });

    // C'est tout l'intérêt : rien à stocker, rien à déchiffrer, rien qui expire
    // au bout de six mois d'inactivité.
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM oauth_token').get() as { n: number }).n, 0);
    assert.equal(drive.connected, true);
    assert.equal(drive.configured, true);
  });

  it('reste en OAuth sans clé', () => {
    const drive = service({
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
    });

    assert.equal(drive.mode, 'oauth');
    // Aucun jeton enregistré : c'est bien « à connecter », comme avant.
    assert.equal(drive.connected, false);
  });
});

describe('administration en compte de service', () => {
  it('refuse le consentement et la déconnexion, qui n’ont plus d’objet', async () => {
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
      const session = login.cookies.find((entry) => entry.name === 'nonni_session');
      assert.ok(session);
      const cookie = `nonni_session=${session.value}`;

      const statut = await server.inject({
        method: 'GET',
        url: '/api/admin/status',
        headers: { cookie },
      });
      assert.equal(statut.json<{ driveMode: string }>().driveMode, 'service_account');

      // Laisser ces deux-là aboutir enregistrerait un jeton que rien n'utilise,
      // et « Déconnecter » laisserait croire que l'instance est coupée alors
      // qu'elle continue de tout lire.
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
