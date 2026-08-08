import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ALL_ALBUMS, type DevicePairingStart } from '@gdv/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import { MAX_PENDING, PairingStore } from '../src/pairings.js';

/**
 * Appairage d'un écran sans clavier (D260809c).
 *
 * Ce qui est vérifié ici est la séparation des deux valeurs : le code affiché
 * désigne la demande et ne relève rien, le `deviceCode` relève la session et ne
 * s'affiche jamais. Le reste en découle — usage unique, expiration,
 * indistinguabilité des refus, et l'identité de commentateur qui ne suit pas.
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'gdv-pairing-'));

let server: FastifyInstance;
let context: AppContext;

/** Ouvre une demande, comme le ferait le téléviseur. */
async function start(): Promise<DevicePairingStart> {
  const response = await server.inject({ method: 'POST', url: '/api/auth/device/start' });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<DevicePairingStart>();
}

async function login(username: string): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: PASSWORD },
  });
  assert.equal(response.statusCode, 200, `connexion de ${username} refusée`);
  const cookie = response.cookies.find((entry) => entry.name === 'gdv_session');
  assert.ok(cookie, 'cookie de session absent');
  return `gdv_session=${cookie.value}`;
}

function approve(userCode: string, cookie?: string) {
  return server.inject({
    method: 'POST',
    url: `/api/auth/device/${userCode}/approve`,
    ...(cookie ? { headers: { cookie } } : {}),
  });
}

function poll(deviceCode: string) {
  return server.inject({
    method: 'POST',
    url: '/api/auth/device/poll',
    payload: { deviceCode },
  });
}

/** Fait expirer une demande sans attendre cinq minutes. */
function expire(userCode: string): void {
  context.db
    .prepare('UPDATE device_pairings SET expires_at = ? WHERE user_code = ?')
    .run('2020-01-01T00:00:00.000Z', userCode);
}

before(async () => {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  const env = loadEnv({
    NODE_ENV: 'test',
    SESSION_SECRET: 's'.repeat(48),
    TOKEN_KEY: 't'.repeat(48),
    CONFIG_PATH: join(root, 'albums-absent.yaml'),
    DATA_DIR: join(root, 'data'),
    CACHE_DIR: join(root, 'cache'),
    WEB_DIR: join(root, 'web-absent'),
    LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);

  const built = await buildApp(env);
  server = built.server;
  context = built.context;

  context.config.createAlbum({
    id: 'vacances',
    title: 'Vacances',
    folderId: 'folder-vacances',
    recursive: true,
  });
  context.config.createAlbum({
    id: 'prive',
    title: 'Privé',
    folderId: 'folder-prive',
    recursive: true,
  });
  context.config.createUser({
    username: 'alexis',
    passwordHash: hash,
    admin: true,
    albums: [ALL_ALBUMS],
  });
  context.config.createUser({
    username: 'famille',
    passwordHash: hash,
    admin: false,
    albums: ['vacances'],
  });
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('ouverture d’une demande', () => {
  it('n’exige aucune session : c’est le premier geste d’un écran qui n’en a pas', async () => {
    const pairing = await start();

    assert.match(pairing.userCode, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.ok(pairing.intervalMs > 0);
    assert.ok(new Date(pairing.expiresAt).getTime() > Date.now());
  });

  it('rend un secret distinct du code affiché', async () => {
    const pairing = await start();

    // Toute la sécurité du flux tient là : ce qui s'affiche dans le salon n'est
    // pas ce qui relève la session.
    assert.notEqual(pairing.deviceCode, pairing.userCode);
    assert.ok(pairing.deviceCode.length >= 32);
  });

  it('ne garde jamais le secret en clair en base', async () => {
    const pairing = await start();

    const row = context.db
      .prepare('SELECT device_hash FROM device_pairings WHERE user_code = ?')
      .get(pairing.userCode) as { device_hash: string };
    assert.notEqual(row.device_hash, pairing.deviceCode);
  });
});

describe('sondage', () => {
  it('attend tant que personne n’a approuvé', async () => {
    const pairing = await start();

    const response = await poll(pairing.deviceCode);
    assert.equal(response.statusCode, 202);
    assert.deepEqual(response.json(), { status: 'pending' });
  });

  it('ne relève rien avec le seul code affiché', async () => {
    const pairing = await start();
    const cookie = await login('famille');
    assert.equal((await approve(pairing.userCode, cookie)).statusCode, 200);

    // Quelqu'un qui a lu l'écran — ou pris une photo — connaît le code, et il
    // ne doit pas suffire à prendre la place de l'écran qui attend.
    const stolen = await poll(pairing.userCode);
    assert.equal(stolen.statusCode, 404);
    assert.equal(stolen.json<{ error: string }>().error, 'unknown_code');

    // Et la demande reste relevable par son destinataire légitime.
    assert.equal((await poll(pairing.deviceCode)).statusCode, 200);
  });

  it('ouvre une session portant le compte de celui qui a approuvé', async () => {
    const pairing = await start();
    const cookie = await login('famille');
    await approve(pairing.userCode, cookie);

    const response = await poll(pairing.deviceCode);
    assert.equal(response.statusCode, 200);

    const body = response.json<{ status: string; user: { username: string; admin: boolean } }>();
    assert.equal(body.status, 'approved');
    assert.equal(body.user.username, 'famille');
    assert.equal(body.user.admin, false);
    assert.ok(response.cookies.some((entry) => entry.name === 'gdv_session'));
  });

  it('n’ouvre que les albums de ce compte', async () => {
    const pairing = await start();
    const cookie = await login('famille');
    await approve(pairing.userCode, cookie);

    const claimed = await poll(pairing.deviceCode);
    const session = claimed.cookies.find((entry) => entry.name === 'gdv_session');
    assert.ok(session);

    const albums = await server.inject({
      method: 'GET',
      url: '/api/albums',
      headers: { cookie: `gdv_session=${session.value}` },
    });
    assert.deepEqual(
      albums.json<{ id: string }[]>().map((album) => album.id),
      ['vacances'],
    );
  });

  it('ne vaut qu’une seule session', async () => {
    const pairing = await start();
    const cookie = await login('famille');
    await approve(pairing.userCode, cookie);

    assert.equal((await poll(pairing.deviceCode)).statusCode, 200);
    // Rejoué, le secret tombe sur la même réponse qu'un code inconnu : la
    // demande a été supprimée à la relève.
    assert.equal((await poll(pairing.deviceCode)).statusCode, 404);
  });
});

describe('identité de commentateur', () => {
  it('ne suit pas l’écran appairé', async () => {
    const cookie = await login('alexis');

    // Une identité vérifiée, rattachée à la session de celui qui approuvera.
    const asked = context.commenters.requestCode('mamie@exemple.fr', 'Mamie');
    assert.ok('code' in asked);
    const verified = context.commenters.verify('mamie@exemple.fr', asked.code);
    assert.ok('commenter' in verified);

    const session = context.db
      .prepare('SELECT id FROM sessions WHERE username = ? ORDER BY rowid DESC LIMIT 1')
      .get('alexis') as { id: string };
    context.sessions.attachCommenter(session.id, verified.commenter.id);

    const me = await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(
      me.json<{ identity: { displayName: string } | null }>().identity?.displayName,
      'Mamie',
    );

    const pairing = await start();
    await approve(pairing.userCode, cookie);
    const claimed = await poll(pairing.deviceCode);

    // Sans cette règle, le téléviseur du salon signerait « Mamie » à tout le
    // foyer : l'identité vaut pour la personne, la clé d'accès pour l'appareil.
    assert.equal(claimed.json<{ user: { identity: unknown } }>().user.identity, null);
  });
});

describe('approbation', () => {
  it('exige une session', async () => {
    const pairing = await start();

    const response = await approve(pairing.userCode);
    assert.equal(response.statusCode, 401);

    // Et la demande reste en attente : un refus ne la consomme pas.
    assert.equal((await poll(pairing.deviceCode)).statusCode, 202);
  });

  it('se rejoue sans conséquence pour le même compte', async () => {
    const pairing = await start();
    const cookie = await login('famille');

    assert.equal((await approve(pairing.userCode, cookie)).statusCode, 200);
    // Un double clic, ou une page rouverte : ce n'est pas une erreur.
    assert.equal((await approve(pairing.userCode, cookie)).statusCode, 200);
  });

  it('refuse celle d’un autre compte', async () => {
    const pairing = await start();
    assert.equal((await approve(pairing.userCode, await login('famille'))).statusCode, 200);

    const response = await approve(pairing.userCode, await login('alexis'));
    assert.equal(response.statusCode, 409);
    assert.equal(response.json<{ error: string }>().error, 'already_paired');

    // Le premier approbateur reste celui dont la session est servie.
    const claimed = await poll(pairing.deviceCode);
    assert.equal(claimed.json<{ user: { username: string } }>().user.username, 'famille');
  });

  it('accepte le code recopié à la main, tiret et minuscules compris', async () => {
    const pairing = await start();
    const cookie = await login('famille');
    const typed = `${pairing.userCode.slice(0, 4)}-${pairing.userCode.slice(4)}`.toLowerCase();

    assert.equal((await approve(typed, cookie)).statusCode, 200);
  });
});

describe('expiration', () => {
  it('ferme une demande que personne n’a relevée', async () => {
    const pairing = await start();
    const cookie = await login('famille');
    await approve(pairing.userCode, cookie);
    expire(pairing.userCode);

    assert.equal((await poll(pairing.deviceCode)).statusCode, 404);
  });

  it('répond à un code expiré comme à un code inconnu', async () => {
    const pairing = await start();
    expire(pairing.userCode);
    const cookie = await login('famille');

    const expired = await approve(pairing.userCode, cookie);
    const unknown = await approve('ZZZZ2222', cookie);

    // Distinguer les deux dirait à qui essaie des codes au hasard lesquels ont
    // existé.
    assert.equal(expired.statusCode, unknown.statusCode);
    assert.deepEqual(expired.json(), unknown.json());
  });

  it('est purgée par le ménage', () => {
    const store = new PairingStore(context.db, 'secret-de-test');
    const pairing = store.start();
    assert.ok(pairing);
    expire(pairing.userCode);

    assert.ok(store.purgeExpired() >= 1);
    assert.equal(store.find(pairing.userCode), null);
  });
});

describe('borne des demandes en attente', () => {
  it('refuse d’ouvrir au-delà de MAX_PENDING, sans jamais accorder d’accès', () => {
    // Base à part : la borne est globale, et la remplir gênerait les autres cas.
    const store = new PairingStore(context.db, 'secret-de-test');
    context.db.prepare('DELETE FROM device_pairings').run();

    for (let index = 0; index < MAX_PENDING; index++) {
      assert.ok(store.start(), `demande ${index} refusée avant la borne`);
    }
    assert.equal(store.start(), null);

    // La borne se rouvre dès que les demandes en cours expirent.
    context.db.prepare('DELETE FROM device_pairings').run();
    assert.ok(store.start());
  });
});
