import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { AlbumDay } from '@nonni/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';

/**
 * Annotated days as exposed by the API.
 *
 * Only two invariants matter here: **reads** follow the album access rule — 404,
 * never 403 — while **writes** live under `/api/admin`, the only prefix that
 * returns 403. Editing still happens from the album; that is precisely what
 * this separation enables (D50).
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'nonni-days-'));

let server: FastifyInstance;
let context: AppContext;
let hash: string;
let adminCookie: string;
let visitorCookie: string;

async function login(username: string): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: PASSWORD },
  });
  assert.equal(response.statusCode, 200, `login rejected for ${username}`);
  return `nonni_session=${response.cookies.find((c) => c.name === 'nonni_session')!.value}`;
}

before(async () => {
  hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

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
});

beforeEach(async () => {
  for (const user of context.config.users()) context.config.deleteUser(user.username);
  for (const album of context.albums) context.config.deleteAlbum(album.id);
  context.db.prepare('DELETE FROM sessions').run();

  context.config.createAlbum({ id: 'corse', title: 'Corse', folderId: 'f1', recursive: true });
  context.config.createAlbum({ id: 'prive', title: 'Privé', folderId: 'f2', recursive: true });
  context.config.createUser({ username: 'patron', passwordHash: hash, admin: true, albums: ['*'] });
  context.config.createUser({
    username: 'famille',
    passwordHash: hash,
    admin: false,
    albums: ['corse'],
  });

  adminCookie = await login('patron');
  visitorCookie = await login('famille');
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

function get(url: string, cookie: string): ReturnType<typeof server.inject> {
  return server.inject({ method: 'GET', url, headers: { cookie } });
}

function patch(url: string, cookie: string, payload: unknown): ReturnType<typeof server.inject> {
  return server.inject({ method: 'PATCH', url, headers: { cookie }, payload: payload as object });
}

describe('GET /api/albums/:albumId/days', () => {
  it('returns 404 for an unassigned album, like the rest of the album', async () => {
    // A forbidden album and a missing album return the same response: other
    // people's album lists must not be discoverable (D12).
    assert.equal((await get('/api/albums/prive/days', visitorCookie)).statusCode, 404);
    assert.equal((await get('/api/albums/fantome/days', visitorCookie)).statusCode, 404);
    assert.equal((await get('/api/albums/corse/days', visitorCookie)).statusCode, 200);
  });

  it('requires a session', async () => {
    assert.equal(
      (await server.inject({ method: 'GET', url: '/api/albums/corse/days' })).statusCode,
      401,
    );
  });

  it('returns only days that carry content', async () => {
    context.days.upsertNote('corse', '2026-07-14', { description: 'Bonifacio, puis la plage' });
    context.days.upsertNote('corse', '2026-07-15', { place: 'Les falaises' });

    const days = (await get('/api/albums/corse/days', visitorCookie)).json() as AlbumDay[];
    assert.deepEqual(
      days.map((day) => day.day),
      ['2026-07-15', '2026-07-14'],
    );
    assert.deepEqual(days[1], {
      day: '2026-07-14',
      description: 'Bonifacio, puis la plage',
      place: null,
      autoPlaces: [],
    });
  });
});

describe('PATCH /api/admin/albums/:id/days/:day', () => {
  const url = '/api/admin/albums/corse/days/2026-07-14';

  it('rejects a visitor with 403 and an anonymous user with 401', async () => {
    // 403 here and nowhere else: this is the counterpart to editing from the
    // album, and the invariant this route must not shift.
    assert.equal((await patch(url, visitorCookie, { description: 'Non' })).statusCode, 403);
    assert.equal(
      (await server.inject({ method: 'PATCH', url, payload: { description: 'Non' } })).statusCode,
      401,
    );
    assert.equal(context.days.get('corse', '2026-07-14'), null);
  });

  it('writes and reads back a note while leaving omitted fields unchanged', async () => {
    const created = await patch(url, adminCookie, {
      description: 'Bonifacio, puis la plage',
      place: 'Les falaises',
    });
    assert.equal(created.statusCode, 200);
    assert.deepEqual(created.json(), {
      day: '2026-07-14',
      description: 'Bonifacio, puis la plage',
      place: 'Les falaises',
      autoPlaces: [],
    });

    const partial = await patch(url, adminCookie, { place: 'Le port' });
    assert.equal((partial.json() as AlbumDay).description, 'Bonifacio, puis la plage');
    assert.equal((partial.json() as AlbumDay).place, 'Le port');
  });

  it('clears with null and removes the day from the list', async () => {
    await patch(url, adminCookie, { description: 'Une note' });

    const cleared = await patch(url, adminCookie, { description: null });
    assert.equal(cleared.statusCode, 200);
    assert.equal((cleared.json() as AlbumDay).description, null);

    const days = (await get('/api/albums/corse/days', adminCookie)).json() as AlbumDay[];
    assert.deepEqual(days, []);
  });

  it('rejects a malformed day key and an overly long note', async () => {
    assert.equal(
      (await patch('/api/admin/albums/corse/days/14-07-2026', adminCookie, { description: 'X' }))
        .statusCode,
      400,
    );
    assert.equal((await patch(url, adminCookie, { description: 'x'.repeat(301) })).statusCode, 400);
    assert.equal((await patch(url, adminCookie, { place: 'x'.repeat(121) })).statusCode, 400);
    assert.equal(context.days.get('corse', '2026-07-14'), null);
  });

  it('returns 404 for an unknown album', async () => {
    assert.equal(
      (await patch('/api/admin/albums/fantome/days/2026-07-14', adminCookie, { description: 'X' }))
        .statusCode,
      404,
    );
  });
});
