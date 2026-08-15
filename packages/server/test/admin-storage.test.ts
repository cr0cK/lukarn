import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ALL_ALBUMS, type AdminAlbum, type AdminStatus } from '@lukarn/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Administering several storages, and what an album does when it moves between
 * them.
 *
 * The rules worth holding to account are the ones whose absence is silent: a
 * connection deleted while an album still reads it leaves every thumbnail of
 * that album failing, and an album moved to another storage keeps an index whose
 * identifiers address nothing there.
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'lukarn-admin-storage-'));

let server: FastifyInstance;
let context: AppContext;
let cookie: string;

function photo(albumId: string, id: string): MediaUpsert {
  return {
    albumId,
    id,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    size: 1234,
    width: 3000,
    height: 2000,
    takenAt: '2026-06-01T12:00:00.000Z',
    takenAtFromExif: true,
    modifiedTime: '2026-06-01T12:00:00.000Z',
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

before(async () => {
  const env = loadEnv({
    NODE_ENV: 'test',
    SESSION_SECRET: 's'.repeat(48),
    TOKEN_KEY: 't'.repeat(48),
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    CONFIG_PATH: join(root, 'albums-absent.yaml'),
    DATA_DIR: join(root, 'data'),
    CACHE_DIR: join(root, 'cache'),
    WEB_DIR: join(root, 'web-absent'),
    LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);

  const built = await buildApp(env);
  server = built.server;
  context = built.context;

  context.config.createUser({
    username: 'patron',
    passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    admin: true,
    albums: [ALL_ALBUMS],
  });

  const login = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'patron', password: PASSWORD },
  });
  cookie = `lukarn_session=${login.cookies.find((entry) => entry.name === 'lukarn_session')!.value}`;
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  for (const album of context.albums) context.config.deleteAlbum(album.id);
  context.db.prepare('DELETE FROM media').run();
  for (const connection of context.connections.list()) {
    if (connection.id !== 'drive') context.connections.delete(connection.id);
  }
  context.storage.invalidate();
});

describe('the storage list', () => {
  it('names the Drive connection an upgraded instance already had', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/admin/storage',
      headers: { cookie },
    });

    assert.equal(response.statusCode, 200);
    const [drive, ...others] = response.json<AdminStatus['storage']>();
    assert.deepEqual(others, []);
    assert.equal(drive?.id, 'drive');
    assert.equal(drive?.kind, 'drive');
    // `consent`: a button starts the OAuth flow. A service-account instance
    // answers `key` instead — see `service-account.test.ts`.
    assert.equal(drive?.authorization, 'consent');
    assert.equal(drive?.connected, false);
  });

  it('reports the kinds this build can create, and refuses the others', async () => {
    const status = await server.inject({
      method: 'GET',
      url: '/api/admin/status',
      headers: { cookie },
    });
    assert.deepEqual(status.json<AdminStatus>().storageKinds, ['drive']);

    const refused = await server.inject({
      method: 'POST',
      url: '/api/admin/storage',
      headers: { cookie },
      payload: { id: 'archives', kind: 's3', label: 'Archives' },
    });

    // Accepting it would create a connection nothing can serve from, discovered
    // only once an album on it stays empty.
    assert.equal(refused.statusCode, 400);
    assert.equal(refused.json<{ error: string }>().error, 'unsupported_kind');
  });

  it('refuses a second connection with the same identifier', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/admin/storage',
      headers: { cookie },
      payload: { id: 'drive', kind: 'drive', label: 'Another Drive' },
    });

    assert.equal(response.statusCode, 409);
  });

  it('creates a second Drive connection, which the single-row table forbade', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/admin/storage',
      headers: { cookie },
      payload: { id: 'photos-pro', kind: 'drive', label: 'Drive professionnel' },
    });

    assert.equal(response.statusCode, 201);
    // `oauth_token` carried CHECK (id = 1): one instance, one Drive. That was the
    // schema stating a scope decision, and the decision changed (D260815g).
    assert.deepEqual(
      context.connections.list().map((connection) => connection.id),
      ['drive', 'photos-pro'],
    );
  });
});

describe('deleting a storage', () => {
  it('is refused while an album reads it, and names the album', async () => {
    context.config.createAlbum({
      id: 'vacances',
      title: 'Vacances',
      folderId: 'dossier',
      recursive: true,
    });

    const response = await server.inject({
      method: 'DELETE',
      url: '/api/admin/storage/drive',
      headers: { cookie },
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json<{ error: string }>().error, 'storage_in_use');
    // The list of albums to move first is the point of the refusal.
    assert.match(response.json<{ message: string }>().message, /Vacances/);
    assert.ok(context.connections.get('drive'));
  });

  it('goes through once nothing reads it', async () => {
    await server.inject({
      method: 'POST',
      url: '/api/admin/storage',
      headers: { cookie },
      payload: { id: 'photos-pro', kind: 'drive', label: 'Drive professionnel' },
    });

    const response = await server.inject({
      method: 'DELETE',
      url: '/api/admin/storage/photos-pro',
      headers: { cookie },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(context.connections.get('photos-pro'), undefined);
  });
});

describe('an album and its storage', () => {
  it('reads the instance default when the request names none', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/admin/albums',
      headers: { cookie },
      payload: { id: 'vacances', title: 'Vacances', folderId: 'dossier' },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json<AdminAlbum>().connectionId, 'drive');
  });

  it('refuses a connection that does not exist', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/admin/albums',
      headers: { cookie },
      payload: {
        id: 'vacances',
        title: 'Vacances',
        folderId: 'dossier',
        connectionId: 'inexistant',
      },
    });

    // An album pointing at nothing indexes nothing and explains none of it.
    assert.equal(response.statusCode, 400);
    assert.equal(response.json<{ error: string }>().error, 'unknown_storage');
  });

  it('purges the index when the album moves to another storage', async () => {
    await server.inject({
      method: 'POST',
      url: '/api/admin/storage',
      headers: { cookie },
      payload: { id: 'photos-pro', kind: 'drive', label: 'Drive professionnel' },
    });
    context.config.createAlbum({
      id: 'vacances',
      title: 'Vacances',
      folderId: 'dossier',
      recursive: true,
    });
    context.media.upsertMany([photo('vacances', 'abc')], '2026-06-01T12:00:00.000Z');
    context.syncState.set('vacances', {
      lastSyncAt: '2026-06-01T12:00:00.000Z',
      status: 'ok',
      error: null,
    });

    const response = await server.inject({
      method: 'PATCH',
      url: '/api/admin/albums/vacances',
      headers: { cookie },
      payload: { connectionId: 'photos-pro' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json<AdminAlbum>().connectionId, 'photos-pro');
    // The same path on another storage is another set of files, and the
    // identifiers of the old one address nothing there. Waiting for the next
    // sync would leave those photos visible — and accessible — meanwhile (D26).
    assert.equal(context.media.stats('vacances').itemCount, 0);
    assert.equal(context.syncState.get('vacances').status, 'never');
  });
});
