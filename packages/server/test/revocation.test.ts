import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, beforeEach, describe, it } from 'node:test';
import { encryptSecret } from '../src/crypto.js';
import { openDb, type Db } from '../src/db.js';
import { DriveKeyMismatchError, DriveRevokedError, DriveService } from '../src/drive/service.js';
import { loadEnv, type Env } from '../src/env.js';

/**
 * Révocation du refresh token. Google renvoie `invalid_grant` dès qu'il n'est
 * plus échangeable — accès retiré, six mois d'inactivité, ou application
 * repassée en statut « Test ». Sans détection, /admin continuerait d'afficher
 * « Connecté » pendant que chaque vignette échoue.
 */

const root = mkdtempSync(join(tmpdir(), 'nonni-revoke-'));
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

  it('ne révoque pas un jeton enregistré pendant que la requête était en vol', async () => {
    await assert.rejects(
      () =>
        service.guard(() => {
          // Le propriétaire réautorise l'accès depuis /admin pendant qu'une
          // requête partie avant est encore en cours.
          db.prepare('UPDATE oauth_token SET ciphertext = ? WHERE id = 1').run(
            encryptSecret('refresh-token-tout-neuf', TOKEN_KEY),
          );
          return Promise.reject(invalidGrant());
        }),
      DriveRevokedError,
    );

    // C'est l'ancien jeton que Google a refusé. Marquer le nouveau ferait
    // réclamer à /admin une reconnexion qui vient précisément d'être faite.
    assert.equal(service.connected, true);
    assert.equal(service.connection?.revokedAt, null);
  });

  it('conserve un jeton que TOKEN_KEY ne déchiffre plus', () => {
    const avecMauvaiseCle = new DriveService({ ...env, tokenKey: 'z'.repeat(48) }, db, silent);

    // Le jeton est illisible : l'instance ne peut rien faire de Drive et doit
    // le dire, /admin proposant alors de reconnecter.
    assert.throws(() => avecMauvaiseCle.api(), DriveKeyMismatchError);
    assert.equal(avecMauvaiseCle.connected, false);

    // Mais il est toujours là. Une clé mal recopiée dans un déploiement ne doit
    // pas coûter l'autorisation Google elle-même : rétablir la clé suffit.
    assert.equal(service.connected, true);
    assert.ok(db.prepare('SELECT ciphertext FROM oauth_token WHERE id = 1').get());
    assert.equal(service.connection?.account, 'photos@exemple.fr');
  });
});

/**
 * Refus de l'access token par Drive (401). Il ne remonte pas comme
 * `invalid_grant` : c'est la réponse HTTP du téléchargement qui le porte, et
 * sans traitement il devient une erreur opaque répétée jusqu'à l'expiration
 * naturelle du jeton — une heure pendant laquelle /admin affiche « connecté ».
 */
describe('téléchargement refusé par Drive', () => {
  class ServiceInstrumente extends DriveService {
    readonly jetons: string[] = [];
    renouvellementRefuse = false;

    protected override async accessToken(force: boolean): Promise<string> {
      if (force && this.renouvellementRefuse) {
        // Google refuse aussi le refresh token : c'est ici que la révocation
        // se constate pour de bon.
        return this.guard<string>(() => Promise.reject(invalidGrant()));
      }
      const token = force ? 'jeton-neuf' : 'jeton-perime';
      this.jetons.push(token);
      return Promise.resolve(token);
    }

    /** Attentes enregistrées plutôt que subies : le test dure des millisecondes. */
    readonly attentes: number[] = [];

    protected override delay(ms: number): Promise<void> {
      this.attentes.push(ms);
      return Promise.resolve();
    }
  }

  const vraiFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = vraiFetch;
  });

  /** Réponses servies dans l'ordre, une par appel. */
  function reponses(...suite: Response[]): { jetonsPresentes: (string | null)[] } {
    const jetonsPresentes: (string | null)[] = [];
    let index = 0;
    globalThis.fetch = (_url: unknown, init?: { headers?: Record<string, string> }) => {
      jetonsPresentes.push(init?.headers?.Authorization ?? null);
      const reponse = suite[index++];
      assert.ok(reponse, `appel réseau nº ${index} non prévu`);
      return Promise.resolve(reponse);
    };
    return { jetonsPresentes };
  }

  it('renouvelle le jeton et retente une seule fois sur un 401', async () => {
    const instrumente = new ServiceInstrumente(env, db, silent);
    const { jetonsPresentes } = reponses(
      new Response(null, { status: 401 }),
      new Response('contenu', { status: 200 }),
    );

    const response = await instrumente.fetchFile('une-photo');

    assert.equal(response.status, 200);
    assert.deepEqual(jetonsPresentes, ['Bearer jeton-perime', 'Bearer jeton-neuf']);
    // Une seule reprise : boucler sur un 401 persistant ferait tourner le
    // serveur à vide sur chaque vignette de la grille.
    assert.equal(instrumente.jetons.length, 2);
  });

  it('constate la révocation quand le renouvellement est refusé à son tour', async () => {
    const instrumente = new ServiceInstrumente(env, db, silent);
    instrumente.renouvellementRefuse = true;
    reponses(new Response(null, { status: 401 }));

    await assert.rejects(() => instrumente.fetchFile('une-photo'), DriveRevokedError);

    // Sans ça, /admin afficherait « connecté » pendant que chaque image échoue.
    assert.equal(instrumente.connected, false);
  });

  it('attend et retente quand Drive limite le débit', async () => {
    const instrumente = new ServiceInstrumente(env, db, silent);
    reponses(
      new Response('{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}', { status: 403 }),
      new Response('{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}', { status: 429 }),
      new Response('contenu', { status: 200 }),
    );

    const response = await instrumente.fetchFile('une-photo');

    // Sans réessai, chaque refus devient une vignette cassée que rien ne
    // rattrape — alors que la seconde d'après serait passée.
    assert.equal(response.status, 200);
    // Doublement à chaque tentative : marteler à intervalle fixe est
    // exactement ce que la limite demande d'arrêter.
    assert.deepEqual(instrumente.attentes, [1000, 2000]);
  });

  it('respecte le Retry-After annoncé par Google', async () => {
    const instrumente = new ServiceInstrumente(env, db, silent);
    reponses(
      new Response('{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}', {
        status: 429,
        headers: { 'retry-after': '7' },
      }),
      new Response('contenu', { status: 200 }),
    );

    await instrumente.fetchFile('une-photo');

    assert.deepEqual(instrumente.attentes, [7000]);
  });

  it('ne retente pas un 403 qui refuse l’accès', async () => {
    const instrumente = new ServiceInstrumente(env, db, silent);
    reponses(
      new Response('{"error":{"errors":[{"reason":"insufficientPermissions"}]}}', { status: 403 }),
    );

    // Un fichier interdit reste interdit : quatre tentatives ne feraient que
    // retarder l'échec, et le 403 d'une permission ressemble en tout au 403
    // d'une limite de débit hors de son corps.
    await assert.rejects(() => instrumente.fetchFile('une-photo'), /403/);
    assert.deepEqual(instrumente.attentes, []);
  });

  it('abandonne un quota de téléchargement, qui ne se vide pas en trente secondes', async () => {
    const instrumente = new ServiceInstrumente(env, db, silent);
    reponses(
      new Response('{"error":{"errors":[{"reason":"downloadQuotaExceeded"}]}}', { status: 403 }),
    );

    await assert.rejects(() => instrumente.fetchFile('une-photo'), /403/);
    assert.deepEqual(instrumente.attentes, []);
  });

  it('relaie une plage insatisfaisable au lieu de lever', async () => {
    const instrumente = new ServiceInstrumente(env, db, silent);
    reponses(new Response(null, { status: 416, headers: { 'content-range': 'bytes */4096' } }));

    // Demander un offset au-delà de la fin fait partie du protocole `Range` :
    // cela arrive dès qu'un lecteur change de vidéo pendant une requête.
    const response = await instrumente.fetchFile('une-video', 'bytes=99999-');

    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */4096');
  });
});
