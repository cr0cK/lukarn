import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ALL_ALBUMS, type DevicePairingStart } from '@lukarn/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import { MAX_PENDING, PairingStore } from '../src/pairings.js';

/**
 * Pairing a screen without a keyboard (D260809c).
 *
 * This verifies the separation between two values: the displayed code identifies
 * the request and retrieves nothing, while `deviceCode` retrieves the session
 * and is never displayed. Everything else follows — single use, expiry,
 * indistinguishable refusals, and a commenter identity that does not follow.
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'lukarn-pairing-'));

let server: FastifyInstance;
let context: AppContext;

/** Opens a request as the television would. */
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
  assert.equal(response.statusCode, 200, `login rejected for ${username}`);
  const cookie = response.cookies.find((entry) => entry.name === 'lukarn_session');
  assert.ok(cookie, 'session cookie missing');
  return `lukarn_session=${cookie.value}`;
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

/** Expires a request without waiting five minutes. */
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

describe('opening a request', () => {
  it('requires no session because it is the first action of a screen without one', async () => {
    const pairing = await start();

    assert.match(pairing.userCode, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.ok(pairing.intervalMs > 0);
    assert.ok(new Date(pairing.expiresAt).getTime() > Date.now());
  });

  it('returns a secret distinct from the displayed code', async () => {
    const pairing = await start();

    // The entire flow's security rests here: what appears in the living room is
    // not what retrieves the session.
    assert.notEqual(pairing.deviceCode, pairing.userCode);
    assert.ok(pairing.deviceCode.length >= 32);
  });

  it('never stores the secret in plaintext in the database', async () => {
    const pairing = await start();

    const row = context.db
      .prepare('SELECT device_hash FROM device_pairings WHERE user_code = ?')
      .get(pairing.userCode) as { device_hash: string };
    assert.notEqual(row.device_hash, pairing.deviceCode);
  });
});

describe('polling', () => {
  it('waits until somebody approves', async () => {
    const pairing = await start();

    const response = await poll(pairing.deviceCode);
    assert.equal(response.statusCode, 202);
    assert.deepEqual(response.json(), { status: 'pending' });
  });

  it('retrieves nothing with only the displayed code', async () => {
    const pairing = await start();
    const cookie = await login('famille');
    assert.equal((await approve(pairing.userCode, cookie)).statusCode, 200);

    // Somebody who read the screen — or took a photo — knows the code, and it
    // must not be enough to take the place of the waiting screen.
    const stolen = await poll(pairing.userCode);
    assert.equal(stolen.statusCode, 404);
    assert.equal(stolen.json<{ error: string }>().error, 'unknown_code');

    // The request remains retrievable by its legitimate recipient.
    assert.equal((await poll(pairing.deviceCode)).statusCode, 200);
  });

  it('opens a session for the account that approved', async () => {
    const pairing = await start();
    const cookie = await login('famille');
    await approve(pairing.userCode, cookie);

    const response = await poll(pairing.deviceCode);
    assert.equal(response.statusCode, 200);

    const body = response.json<{ status: string; user: { username: string; admin: boolean } }>();
    assert.equal(body.status, 'approved');
    assert.equal(body.user.username, 'famille');
    assert.equal(body.user.admin, false);
    assert.ok(response.cookies.some((entry) => entry.name === 'lukarn_session'));
  });

  it("opens only that account's albums", async () => {
    const pairing = await start();
    const cookie = await login('famille');
    await approve(pairing.userCode, cookie);

    const claimed = await poll(pairing.deviceCode);
    const session = claimed.cookies.find((entry) => entry.name === 'lukarn_session');
    assert.ok(session);

    const albums = await server.inject({
      method: 'GET',
      url: '/api/albums',
      headers: { cookie: `lukarn_session=${session.value}` },
    });
    assert.deepEqual(
      albums.json<{ id: string }[]>().map((album) => album.id),
      ['vacances'],
    );
  });

  it('is valid for only one session', async () => {
    const pairing = await start();
    const cookie = await login('famille');
    await approve(pairing.userCode, cookie);

    assert.equal((await poll(pairing.deviceCode)).statusCode, 200);
    // When replayed, the secret gets the same response as an unknown code: the
    // request was deleted on retrieval.
    assert.equal((await poll(pairing.deviceCode)).statusCode, 404);
  });
});

describe('commenter identity', () => {
  it('does not follow the paired screen', async () => {
    const cookie = await login('alexis');

    // A verified identity attached to the session of whoever will approve.
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

    // Without this rule, the living-room television would sign "Mamie" for the
    // whole household: identity belongs to the person, the access key to the device.
    assert.equal(claimed.json<{ user: { identity: unknown } }>().user.identity, null);
  });
});

describe('approval', () => {
  it('requires a session', async () => {
    const pairing = await start();

    const response = await approve(pairing.userCode);
    assert.equal(response.statusCode, 401);

    // The request remains pending: a refusal does not consume it.
    assert.equal((await poll(pairing.deviceCode)).statusCode, 202);
  });

  it('can be replayed harmlessly for the same account', async () => {
    const pairing = await start();
    const cookie = await login('famille');

    assert.equal((await approve(pairing.userCode, cookie)).statusCode, 200);
    // A double-click or a reopened page is not an error.
    assert.equal((await approve(pairing.userCode, cookie)).statusCode, 200);
  });

  it('rejects approval from another account', async () => {
    const pairing = await start();
    assert.equal((await approve(pairing.userCode, await login('famille'))).statusCode, 200);

    const response = await approve(pairing.userCode, await login('alexis'));
    assert.equal(response.statusCode, 409);
    assert.equal(response.json<{ error: string }>().error, 'already_paired');

    // The first approver remains the account whose session is served.
    const claimed = await poll(pairing.deviceCode);
    assert.equal(claimed.json<{ user: { username: string } }>().user.username, 'famille');
  });

  it('accepts a manually copied code including hyphen and lowercase', async () => {
    const pairing = await start();
    const cookie = await login('famille');
    const typed = `${pairing.userCode.slice(0, 4)}-${pairing.userCode.slice(4)}`.toLowerCase();

    assert.equal((await approve(typed, cookie)).statusCode, 200);
  });
});

describe('expiry', () => {
  it('closes a request nobody retrieved', async () => {
    const pairing = await start();
    const cookie = await login('famille');
    await approve(pairing.userCode, cookie);
    expire(pairing.userCode);

    assert.equal((await poll(pairing.deviceCode)).statusCode, 404);
  });

  it('responds to an expired code like an unknown code', async () => {
    const pairing = await start();
    expire(pairing.userCode);
    const cookie = await login('famille');

    const expired = await approve(pairing.userCode, cookie);
    const unknown = await approve('ZZZZ2222', cookie);

    // Distinguishing them would tell somebody trying random codes which ones existed.
    assert.equal(expired.statusCode, unknown.statusCode);
    assert.deepEqual(expired.json(), unknown.json());
  });

  it('is purged by cleanup', () => {
    const store = new PairingStore(context.db, 'secret-de-test');
    const pairing = store.start();
    assert.ok(pairing);
    expire(pairing.userCode);

    assert.ok(store.purgeExpired() >= 1);
    assert.equal(store.find(pairing.userCode), null);
  });
});

describe('pending request limit', () => {
  it('refuses to open beyond MAX_PENDING without ever granting access', () => {
    // Separate database: the limit is global, and filling it would disrupt other cases.
    const store = new PairingStore(context.db, 'secret-de-test');
    context.db.prepare('DELETE FROM device_pairings').run();

    for (let index = 0; index < MAX_PENDING; index++) {
      assert.ok(store.start(), `request ${index} rejected before the limit`);
    }
    assert.equal(store.start(), null);

    // Capacity becomes available again as soon as pending requests expire.
    context.db.prepare('DELETE FROM device_pairings').run();
    assert.ok(store.start());
  });
});
