import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, beforeEach, describe, it } from 'node:test';
import { openDb, type Db } from '../src/db.js';
import { loadEnv, type Env } from '../src/env.js';
import { DEFAULT_CONNECTION_ID, StorageConnectionRepo } from '../src/storage/connections.js';
import { DriveService } from '../src/storage/drive.js';
import { StorageKeyMismatchError, StorageRevokedError } from '../src/storage/provider.js';

/**
 * Refresh token revocation. Google returns `invalid_grant` once it can no longer
 * be exchanged — revoked access, six months of inactivity, or an application
 * returned to "Test" status. Without detection, /admin would show "Connected"
 * while every thumbnail fails.
 */

const root = mkdtempSync(join(tmpdir(), 'lukarn-revoke-'));
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
let connections: StorageConnectionRepo;
let service: DriveService;

/** A Drive service reading the connection this database already carries. */
function driveOn(environnement: Env = env): DriveService {
  return new DriveService(
    environnement,
    new StorageConnectionRepo(db, environnement.tokenKey),
    DEFAULT_CONNECTION_ID,
    silent,
  );
}

beforeEach(() => {
  db?.close();
  rmSync(join(root, 'data'), { recursive: true, force: true });
  db = openDb(join(root, 'data'));
  connections = new StorageConnectionRepo(db, TOKEN_KEY);
  service = new DriveService(env, connections, DEFAULT_CONNECTION_ID, silent);

  // Migration 17 creates the row; consent is what fills it.
  connections.update(DEFAULT_CONNECTION_ID, {
    secret: 'refresh-token-factice',
    account: 'photos@exemple.fr',
  });
});

after(() => db?.close());

/** Error as reported by google-auth-library after token refusal. */
function invalidGrant(): Error {
  return Object.assign(new Error('invalid_grant'), {
    response: { data: { error: 'invalid_grant', error_description: 'Token has been expired' } },
  });
}

describe('invalid_grant detection', () => {
  it('starts connected', () => {
    assert.equal(service.connected, true);
    assert.equal(service.connection?.revokedAt, null);
  });

  it('marks the connection revoked and translates the error', async () => {
    await assert.rejects(
      () => service.guard(() => Promise.reject(invalidGrant())),
      StorageRevokedError,
    );

    assert.equal(service.connected, false);
    assert.notEqual(service.connection?.revokedAt, null);
    // The account remains readable so /admin can name the lost authorisation.
    assert.equal(service.connection?.account, 'photos@exemple.fr');
  });

  it('recognises the nested form alone', async () => {
    const nested = Object.assign(new Error('A generic error'), {
      response: { data: { error: 'invalid_grant' } },
    });
    await assert.rejects(() => service.guard(() => Promise.reject(nested)), StorageRevokedError);
    assert.equal(service.connected, false);
  });

  it('passes other errors through without touching the connection', async () => {
    const network = new Error('ECONNRESET');
    await assert.rejects(() => service.guard(() => Promise.reject(network)), /ECONNRESET/);

    // A network outage or Google 500 does not mean revocation: invalidating the
    // connection would require new consent for no reason.
    assert.equal(service.connected, true);
    assert.equal(service.connection?.revokedAt, null);
  });

  it('does not disrupt a successful call', async () => {
    assert.equal(await service.guard(() => Promise.resolve('ok')), 'ok');
    assert.equal(service.connected, true);
  });

  it('fails immediately once revoked without calling Google again', async () => {
    await assert.rejects(
      () => service.guard(() => Promise.reject(invalidGrant())),
      StorageRevokedError,
    );

    let appels = 0;
    await assert.rejects(async () => {
      appels++;
      await service.fetch('un-fichier');
    }, StorageRevokedError);

    // `fetch` must refuse before any network attempt.
    assert.equal(appels, 1);
  });

  it('retains revocation after restart', async () => {
    await assert.rejects(
      () => service.guard(() => Promise.reject(invalidGrant())),
      StorageRevokedError,
    );

    // New service on the same database: state lives in the database, not memory.
    const rechargé = driveOn();
    assert.equal(rechargé.connected, false);
    assert.notEqual(rechargé.connection?.revokedAt, null);
  });

  it('forgets the token on manual disconnection, keeping the connection', async () => {
    await assert.rejects(
      () => service.guard(() => Promise.reject(invalidGrant())),
      StorageRevokedError,
    );

    service.disconnect();
    // The row stays: the albums reading this storage name it by id, and taking it
    // away with the token would leave them pointing at nothing.
    assert.equal(service.connection, null);
    assert.equal(service.connected, false);
    assert.ok(connections.get(DEFAULT_CONNECTION_ID));
  });

  it('does not revoke a token saved while the request was in flight', async () => {
    await assert.rejects(
      () =>
        service.guard(() => {
          // The owner reauthorises access from /admin while an earlier request
          // is still in flight.
          connections.update(DEFAULT_CONNECTION_ID, { secret: 'refresh-token-tout-neuf' });
          return Promise.reject(invalidGrant());
        }),
      StorageRevokedError,
    );

    // Google refused the old token. Marking the new one would make /admin ask
    // for the reconnection that just happened.
    assert.equal(service.connected, true);
    assert.equal(service.connection?.revokedAt, null);
  });

  it('retains a token TOKEN_KEY can no longer decrypt', async () => {
    const avecMauvaiseCle = driveOn({ ...env, tokenKey: 'z'.repeat(48) });

    // The token is unreadable: the instance cannot use Drive and must say so,
    // allowing /admin to offer reconnection.
    await assert.rejects(() => avecMauvaiseCle.list('un-dossier', null), StorageKeyMismatchError);
    assert.equal(avecMauvaiseCle.connected, false);

    // But it remains. A deployment with a mistyped key must not lose Google
    // authorisation itself: restoring the key is enough.
    assert.equal(service.connected, true);
    assert.ok(connections.get(DEFAULT_CONNECTION_ID)?.ciphertext);
    assert.equal(service.connection?.account, 'photos@exemple.fr');
  });
});

/**
 * Drive refusal of the access token (401). It does not surface as
 * `invalid_grant`: the download HTTP response carries it, and without handling
 * it becomes an opaque error repeated until natural token expiry — an hour
 * during which /admin shows "connected".
 */
describe('download refused by Drive', () => {
  class ServiceInstrumente extends DriveService {
    readonly jetons: string[] = [];
    renouvellementRefuse = false;

    protected override async accessToken(force: boolean): Promise<string> {
      if (force && this.renouvellementRefuse) {
        // Google also refuses the refresh token: revocation is confirmed here.
        return this.guard<string>(() => Promise.reject(invalidGrant()));
      }
      const token = force ? 'jeton-neuf' : 'jeton-perime';
      this.jetons.push(token);
      return Promise.resolve(token);
    }

    /** Waits recorded rather than incurred so the test takes milliseconds. */
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

  /** Responses served in order, one per call. */
  function reponses(...suite: Response[]): { jetonsPresentes: (string | null)[] } {
    const jetonsPresentes: (string | null)[] = [];
    let index = 0;
    globalThis.fetch = (_url: unknown, init?: { headers?: Record<string, string> }) => {
      jetonsPresentes.push(init?.headers?.Authorization ?? null);
      const reponse = suite[index++];
      assert.ok(reponse, `unexpected network call no. ${index}`);
      return Promise.resolve(reponse);
    };
    return { jetonsPresentes };
  }

  it('refreshes the token and retries only once after a 401', async () => {
    const instrumente = new ServiceInstrumente(env, connections, DEFAULT_CONNECTION_ID, silent);
    const { jetonsPresentes } = reponses(
      new Response(null, { status: 401 }),
      new Response('contenu', { status: 200 }),
    );

    const response = await instrumente.fetch('une-photo');

    assert.equal(response.status, 200);
    assert.deepEqual(jetonsPresentes, ['Bearer jeton-perime', 'Bearer jeton-neuf']);
    // One retry only: looping on a persistent 401 would waste server work on
    // every grid thumbnail.
    assert.equal(instrumente.jetons.length, 2);
  });

  it('records revocation when refresh is also refused', async () => {
    const instrumente = new ServiceInstrumente(env, connections, DEFAULT_CONNECTION_ID, silent);
    instrumente.renouvellementRefuse = true;
    reponses(new Response(null, { status: 401 }));

    await assert.rejects(() => instrumente.fetch('une-photo'), StorageRevokedError);

    // Otherwise /admin would show "connected" while every image fails.
    assert.equal(instrumente.connected, false);
  });

  it('waits and retries when Drive rate-limits', async () => {
    const instrumente = new ServiceInstrumente(env, connections, DEFAULT_CONNECTION_ID, silent);
    reponses(
      new Response('{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}', { status: 403 }),
      new Response('{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}', { status: 429 }),
      new Response('contenu', { status: 200 }),
    );

    const response = await instrumente.fetch('une-photo');

    // Without retry, every refusal becomes a broken thumbnail despite the next
    // second succeeding.
    assert.equal(response.status, 200);
    // Double on every attempt: hammering at fixed intervals is exactly what the
    // limit asks clients to stop.
    assert.deepEqual(instrumente.attentes, [1000, 2000]);
  });

  it('respects Retry-After reported by Google', async () => {
    const instrumente = new ServiceInstrumente(env, connections, DEFAULT_CONNECTION_ID, silent);
    reponses(
      new Response('{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}', {
        status: 429,
        headers: { 'retry-after': '7' },
      }),
      new Response('contenu', { status: 200 }),
    );

    await instrumente.fetch('une-photo');

    assert.deepEqual(instrumente.attentes, [7000]);
  });

  it('does not retry a 403 that denies access', async () => {
    const instrumente = new ServiceInstrumente(env, connections, DEFAULT_CONNECTION_ID, silent);
    reponses(
      new Response('{"error":{"errors":[{"reason":"insufficientPermissions"}]}}', { status: 403 }),
    );

    // A forbidden file remains forbidden: four attempts only delay failure, and
    // outside its body a permission 403 looks exactly like a rate-limit 403.
    await assert.rejects(() => instrumente.fetch('une-photo'), /403/);
    assert.deepEqual(instrumente.attentes, []);
  });

  it('gives up on a download quota that will not clear in thirty seconds', async () => {
    const instrumente = new ServiceInstrumente(env, connections, DEFAULT_CONNECTION_ID, silent);
    reponses(
      new Response('{"error":{"errors":[{"reason":"downloadQuotaExceeded"}]}}', { status: 403 }),
    );

    await assert.rejects(() => instrumente.fetch('une-photo'), /403/);
    assert.deepEqual(instrumente.attentes, []);
  });

  it('relays an unsatisfiable range instead of throwing', async () => {
    const instrumente = new ServiceInstrumente(env, connections, DEFAULT_CONNECTION_ID, silent);
    reponses(new Response(null, { status: 416, headers: { 'content-range': 'bytes */4096' } }));

    // Requesting an offset beyond the end is part of the `Range` protocol: it
    // happens when a player changes video during a request.
    const response = await instrumente.fetch('une-video', 'bytes=99999-');

    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */4096');
  });
});
