import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  ALBUM_ID_PATTERN,
  ALL_ALBUMS,
  type AdminAlbum,
  type AdminStatus,
  type StorageConnectionStatus,
} from '@lukarn/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import type { MediaUpsert } from '../src/repo.js';
import { SUPPORTED_KINDS } from '../src/storage/registry.js';

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
    sourcePath: null,
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
    // The list the form offers is the list the factory can build, and the point is
    // that it is the *same* list: naming the kinds here again would let the two drift
    // the day one arrives, which is the drift this route exists to prevent.
    assert.deepEqual(status.json<AdminStatus>().storageKinds, SUPPORTED_KINDS);
    assert.ok(status.json<AdminStatus>().storageKinds.includes('drive'));

    // Every kind `StorageKind` declares is now buildable, so the `unsupported_kind`
    // refusal has nothing left to refuse through this route — it guards the gap
    // between a kind existing in the contract and the factory being able to build
    // it, and that gap is currently closed. What still has to hold is that a kind
    // nobody declared is refused, one guard earlier.
    const refused = await server.inject({
      method: 'POST',
      url: '/api/admin/storage',
      headers: { cookie },
      payload: { id: 'archives', kind: 'ftp', label: 'Archives' },
    });

    // Accepting it would create a connection nothing can serve from, discovered
    // only once an album on it stays empty.
    assert.equal(refused.statusCode, 400);
  });

  it('creates a bucket from what the form typed into it', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/api/admin/storage',
      headers: { cookie },
      payload: {
        id: 'archives',
        kind: 's3',
        label: 'Archives',
        settings: { endpoint: 'https://s3.example.com', bucket: 'famille', pathStyle: 'true' },
        secret: JSON.stringify({ accessKeyId: 'AKIA…', secretAccessKey: 'secret' }),
      },
    });

    assert.equal(created.statusCode, 201);
    const connection = created.json<StorageConnectionStatus>();
    // `settings`: there is no consent screen to come back from, so a bucket is
    // authorised by the same request that creates it.
    assert.equal(connection.authorization, 'settings');
    assert.equal(connection.connected, true);
    // Neither half of the key pair comes back, under any key: the response is
    // built from the row, and the row's secret stays encrypted.
    assert.equal(JSON.stringify(connection).includes('secret'), false);
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

  it('derives a readable identifier from the name when the request sends none', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/api/admin/storage',
      headers: { cookie },
      payload: { kind: 'drive', label: 'Archives Été 2026' },
    });

    assert.equal(created.statusCode, 201);
    // A slug rather than a number: this value is what `connection_id` reads as in a
    // log line and in a database dump, and that is the whole reason it is not a
    // counter (D260816h).
    assert.equal(created.json<StorageConnectionStatus>().id, 'archives-ete-2026');
    assert.match(created.json<StorageConnectionStatus>().id, ALBUM_ID_PATTERN);
  });

  it('suffixes a derived identifier rather than refusing the name a second time', async () => {
    const payload = { kind: 'drive', label: 'Archives' };
    const ids: string[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const created = await server.inject({
        method: 'POST',
        url: '/api/admin/storage',
        headers: { cookie },
        payload,
      });
      assert.equal(created.statusCode, 201);
      ids.push(created.json<StorageConnectionStatus>().id);
    }

    // Two storages may legitimately be called the same thing, and the form has no
    // identifier field to correct a 409 in: refusing here would be a dead end.
    assert.deepEqual(ids, ['archives', 'archives-2', 'archives-3']);
  });

  it('still produces a usable identifier for a name that slugifies to nothing', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/api/admin/storage',
      headers: { cookie },
      payload: { kind: 'drive', label: '📷' },
    });

    assert.equal(created.statusCode, 201);
    // An empty identifier would be stored, then refused by every route that names a
    // connection — an album could never be pointed at it.
    const { id } = created.json<StorageConnectionStatus>();
    assert.match(id, ALBUM_ID_PATTERN);
    assert.ok(context.connections.get(id));
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
