import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ALL_ALBUMS } from '@nonni/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * End-to-end test of album isolation: a user must not be able to reach either
 * the metadata or the files of an album they have not been assigned — and the
 * API must not reveal that they exist either.
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'nonni-access-'));

let server: FastifyInstance;
let context: AppContext;

function media(albumId: string, id: string): MediaUpsert {
  return {
    albumId,
    id,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    size: 1234,
    width: 3000,
    height: 2000,
    takenAt: '2024-06-01T12:00:00.000Z',
    takenAtFromExif: true,
    modifiedTime: '2024-06-01T12:00:00.000Z',
    durationMs: null,
    cameraMake: null,
    cameraModel: null,
    lens: null,
    isoSpeed: null,
    exposureTime: null,
    aperture: null,
    focalLength: null,
    lat: null,
    lng: null,
    md5: null,
    hasThumbnail: true,
    videoCodec: null,
  };
}

async function login(username: string): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: PASSWORD },
  });
  assert.equal(response.statusCode, 200, `login rejected for ${username}`);

  const cookie = response.cookies.find((entry) => entry.name === 'nonni_session');
  assert.ok(cookie, 'session cookie missing');
  return `nonni_session=${cookie.value}`;
}

before(async () => {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  const env = loadEnv({
    NODE_ENV: 'test',
    SESSION_SECRET: 's'.repeat(48),
    TOKEN_KEY: 't'.repeat(48),
    // No file here: accounts and albums are created in the database.
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

  context.media.upsertMany(
    [media('vacances', 'photo-publique'), media('prive', 'photo-privee')],
    '2025-01-01T00:00:00.000Z',
  );
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('anonymous access', () => {
  it('rejects album access', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/albums' });
    assert.equal(response.statusCode, 401);
  });

  it('rejects file access', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/photo-publique/thumb?s=320',
    });
    assert.equal(response.statusCode, 401);
  });

  it('accepts a username surrounded by spaces', async () => {
    // No account can contain them, but a mobile keyboard adds one after
    // autocomplete. Rejecting it here would be indistinguishable from a wrong
    // password.
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: '  famille\n', password: PASSWORD },
    });
    assert.equal(response.statusCode, 200);
    assert.equal((response.json() as { username: string }).username, 'famille');
  });

  it('rejects a username made entirely of spaces', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: '   ', password: PASSWORD },
    });
    assert.equal(response.statusCode, 400);
  });

  it('does not strip spaces from the password', async () => {
    // A password may contain them at either end: trimming it would allow a
    // login with the wrong input.
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'famille', password: ` ${PASSWORD} ` },
    });
    assert.equal(response.statusCode, 401);
  });

  it('rejects an incorrect password', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'famille', password: 'mauvais' },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.cookies.length, 0);
  });
});

describe('album isolation', () => {
  it('exposes only assigned albums', async () => {
    const cookie = await login('famille');
    const response = await server.inject({
      method: 'GET',
      url: '/api/albums',
      headers: { cookie },
    });

    assert.equal(response.statusCode, 200);
    const albums = response.json() as { id: string }[];
    assert.deepEqual(
      albums.map((album) => album.id),
      ['vacances'],
    );
  });

  it('returns 404 — not 403 — for a forbidden album', async () => {
    const cookie = await login('famille');
    for (const url of [
      '/api/albums/prive',
      '/api/albums/prive/items',
      '/api/albums/prive/items/photo-privee',
    ]) {
      const response = await server.inject({ method: 'GET', url, headers: { cookie } });
      // A 403 would confirm the album exists: a 404 reveals nothing.
      assert.equal(response.statusCode, 404, url);
    }
  });

  it('rejects a file from a forbidden album', async () => {
    const cookie = await login('famille');
    for (const url of [
      '/api/media/photo-privee/thumb?s=320',
      '/api/media/photo-privee/full',
      '/api/media/photo-privee/original',
      '/api/media/photo-privee/original?download=1',
    ]) {
      const response = await server.inject({ method: 'GET', url, headers: { cookie } });
      assert.equal(response.statusCode, 404, url);
    }
  });

  it('allows an administrator to access every album', async () => {
    const cookie = await login('alexis');
    const response = await server.inject({
      method: 'GET',
      url: '/api/albums/prive/items/photo-privee',
      headers: { cookie },
    });
    assert.equal(response.statusCode, 200);
  });

  it('reserves administration for admin accounts', async () => {
    const cookie = await login('famille');
    const response = await server.inject({
      method: 'GET',
      url: '/api/admin/status',
      headers: { cookie },
    });
    assert.equal(response.statusCode, 403);
  });
});

describe('session lifecycle', () => {
  it('invalidates the cookie after logout', async () => {
    const cookie = await login('famille');

    const before = await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(before.statusCode, 200);

    await server.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });

    const after = await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(after.statusCode, 401);
  });

  it('rejects a forged cookie', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: 'nonni_session=identifiant-invente' },
    });
    assert.equal(response.statusCode, 401);
  });

  it('sets the cookie again when the session is extended', async () => {
    const cookie = await login('famille');
    const sessionId = cookie.slice('nonni_session='.length);

    // Once the session reaches half its lifetime, the next read pushes its
    // database expiry back. The cookie still carries the login date — without
    // being reissued, it would expire while the session remains valid.
    const miVie = new Date(Date.now() + context.sessions.ttlMs / 4).toISOString();
    context.db.prepare('UPDATE sessions SET expires_at = ? WHERE id LIKE ?').run(
      miVie,
      // The cookie is signed: its value carries a suffix the database ignores.
      `${sessionId.split('.')[0]}%`,
    );

    const response = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    assert.equal(response.statusCode, 200);

    const repose = response.cookies.find((entry) => entry.name === 'nonni_session');
    assert.ok(repose, 'extending the session must reissue the cookie');
    assert.ok(
      (repose.maxAge ?? 0) > context.sessions.ttlMs / 1000 / 2,
      'the reissued cookie must carry the new expiry, not the old one',
    );
  });
});
