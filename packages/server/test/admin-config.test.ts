import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  DEFAULT_PRIMARY_COLOR,
  type AdminAlbum,
  type AdminUser,
  type AppSettings,
} from '@lukarn/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Administration of accounts, albums and settings from the application.
 *
 * The tests cover safeguards rather than payload shapes: they prevent the
 * instance from becoming impossible to administer, a session from surviving
 * revoked access, or one username from overwriting another.
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'lukarn-admin-'));

let server: FastifyInstance;
let context: AppContext;
let hash: string;
let cookie: string;

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

async function login(username: string, password = PASSWORD): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });
  assert.equal(response.statusCode, 200, `login rejected for ${username}`);
  const entry = response.cookies.find((c) => c.name === 'lukarn_session');
  assert.ok(entry, 'session cookie missing');
  return `lukarn_session=${entry.value}`;
}

/** Restores the configuration to a known state before each test. */
function reset(): void {
  for (const user of context.config.users()) context.config.deleteUser(user.username);
  for (const album of context.albums) context.config.deleteAlbum(album.id);
  context.db.prepare('DELETE FROM media').run();
  context.db.prepare('DELETE FROM sync_state').run();
  context.db.prepare('DELETE FROM sessions').run();
  context.config.updateSettings({
    syncIntervalMinutes: 30,
    syncOnStartup: true,
    cacheMaxSizeGB: 20,
  });

  context.config.createUser({ username: 'patron', passwordHash: hash, admin: true, albums: ['*'] });
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
  reset();
  cookie = await login('patron');
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

async function post(url: string, payload: unknown): ReturnType<typeof server.inject> {
  return server.inject({ method: 'POST', url, headers: { cookie }, payload: payload as object });
}

async function patch(url: string, payload: unknown): ReturnType<typeof server.inject> {
  return server.inject({ method: 'PATCH', url, headers: { cookie }, payload: payload as object });
}

describe('accounts', () => {
  it('creates an account and never returns its hash', async () => {
    const response = await post('/api/admin/users', {
      username: 'Famille',
      password: 'un-mot-de-passe',
      albums: [],
    });

    assert.equal(response.statusCode, 201);
    const user = response.json() as AdminUser;
    assert.equal(user.username, 'Famille');
    assert.equal(user.admin, false);
    assert.deepEqual(user.albums, []);
    assert.ok(user.createdAt);
    // No hash may leak under any key.
    assert.doesNotMatch(response.body, /\$argon2/);

    const listing = await server.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie },
    });
    assert.doesNotMatch(listing.body, /\$argon2/);
    assert.deepEqual((listing.json() as AdminUser[]).map((entry) => entry.username).sort(), [
      'Famille',
      'patron',
    ]);
  });

  it('rejects an existing username regardless of case', async () => {
    await post('/api/admin/users', { username: 'famille', password: 'un-mot-de-passe' });
    const again = await post('/api/admin/users', { username: 'FAMILLE', password: 'autre-secret' });

    assert.equal(again.statusCode, 409);
    assert.equal((again.json() as { error: string }).error, 'conflict');
    // The original password was not overwritten along the way.
    await login('famille', 'un-mot-de-passe');
  });

  it('rejects a short password and a malformed username', async () => {
    assert.equal(
      (await post('/api/admin/users', { username: 'court', password: 'abc' })).statusCode,
      400,
    );
    assert.equal(
      (await post('/api/admin/users', { username: 'espace interdit', password: 'un-mot-de-passe' }))
        .statusCode,
      400,
    );
  });

  it('rejects a missing album rather than creating silent access', async () => {
    const response = await post('/api/admin/users', {
      username: 'famille',
      password: 'un-mot-de-passe',
      albums: ['fantome'],
    });
    assert.equal(response.statusCode, 400);
    assert.equal((response.json() as { error: string }).error, 'unknown_album');
  });

  it('returns 404 for an unknown account', async () => {
    assert.equal((await patch('/api/admin/users/fantome', { admin: true })).statusCode, 404);
    const removed = await server.inject({
      method: 'DELETE',
      url: '/api/admin/users/fantome',
      headers: { cookie },
    });
    assert.equal(removed.statusCode, 404);
  });
});

describe('last administrator', () => {
  it('refuses to delete it', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: '/api/admin/users/patron',
      headers: { cookie },
    });

    assert.equal(response.statusCode, 409);
    assert.equal((response.json() as { error: string }).error, 'last_admin');
    assert.ok(context.config.user('patron'));
  });

  it('refuses to remove its role', async () => {
    const response = await patch('/api/admin/users/patron', { admin: false });
    assert.equal(response.statusCode, 409);
    assert.equal(context.config.user('patron')!.admin, true);
  });

  it('allows it once a second administrator exists', async () => {
    assert.equal(
      (
        await post('/api/admin/users', {
          username: 'second',
          password: 'un-mot-de-passe',
          admin: true,
        })
      ).statusCode,
      201,
    );

    assert.equal((await patch('/api/admin/users/patron', { admin: false })).statusCode, 200);
    assert.equal(context.config.user('patron')!.admin, false);
    assert.equal(context.config.adminCount(), 1);
  });
});

describe('sessions', () => {
  it('closes the deleted account sessions', async () => {
    await post('/api/admin/users', { username: 'famille', password: 'un-mot-de-passe' });
    const victim = await login('famille', 'un-mot-de-passe');

    assert.equal(
      (await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: victim } }))
        .statusCode,
      200,
    );

    const removed = await server.inject({
      method: 'DELETE',
      url: '/api/admin/users/famille',
      headers: { cookie },
    });
    assert.equal(removed.statusCode, 200);

    assert.equal(
      (await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: victim } }))
        .statusCode,
      401,
    );
  });

  it('closes sessions when the password changes', async () => {
    await post('/api/admin/users', { username: 'famille', password: 'un-mot-de-passe' });
    const victim = await login('famille', 'un-mot-de-passe');

    assert.equal(
      (await patch('/api/admin/users/famille', { password: 'nouveau-secret' })).statusCode,
      200,
    );

    assert.equal(
      (await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: victim } }))
        .statusCode,
      401,
      'the session opened with the old password must be closed',
    );
    await login('famille', 'nouveau-secret');
  });

  it('does not log out an account whose administrator role is removed', async () => {
    await post('/api/admin/users', {
      username: 'second',
      password: 'un-mot-de-passe',
      admin: true,
    });
    const other = await login('second', 'un-mot-de-passe');

    assert.equal((await patch('/api/admin/users/second', { admin: false })).statusCode, 200);

    // The session survives — the account remains legitimate…
    const me = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: other },
    });
    assert.equal(me.statusCode, 200);
    assert.equal((me.json() as { admin: boolean }).admin, false);

    // …but administration is denied from the very next request.
    const forbidden = await server.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie: other },
    });
    assert.equal(forbidden.statusCode, 403);
  });
});

describe('albums', () => {
  it('creates an album and rejects an existing id', async () => {
    const created = await post('/api/admin/albums', {
      id: 'vacances',
      title: 'Vacances',
      folderId: 'folder-vacances',
    });
    assert.equal(created.statusCode, 201);
    const album = created.json() as AdminAlbum;
    assert.equal(album.recursive, true);
    assert.equal(album.itemCount, 0);
    assert.equal(album.syncStatus, 'never');

    const again = await post('/api/admin/albums', {
      id: 'vacances',
      title: 'Autre titre',
      folderId: 'autre-dossier',
    });
    assert.equal(again.statusCode, 409);
    // The original album was not overwritten.
    assert.equal(context.findAlbum('vacances')!.title, 'Vacances');
  });

  it('round-trips the default grouping on creation and update', async () => {
    // Grouping used to live in the URL, hence nowhere: without this column,
    // reopening a holiday album would group it by month every time.
    const parMois = await post('/api/admin/albums', {
      id: 'quotidien',
      title: 'Quotidien',
      folderId: 'folder-quotidien',
    });
    assert.equal((parMois.json() as AdminAlbum).groupBy, 'month', 'month remains the default');

    const parJour = await post('/api/admin/albums', {
      id: 'sejour',
      title: 'Séjour',
      folderId: 'folder-sejour',
      groupBy: 'day',
    });
    assert.equal((parJour.json() as AdminAlbum).groupBy, 'day');
    // The gallery reads it too: it opens the album with the right grouping.
    const vue = await server.inject({
      method: 'GET',
      url: '/api/albums/sejour',
      headers: { cookie },
    });
    assert.equal((vue.json() as { groupBy: string }).groupBy, 'day');

    const bascule = await patch('/api/admin/albums/sejour', { groupBy: 'month' });
    assert.equal((bascule.json() as AdminAlbum).groupBy, 'month');
    // Changing the grouping does not affect the Drive scope: nothing needs reindexing.
    assert.equal(context.syncState.get('sejour').status, 'never');

    assert.equal((await patch('/api/admin/albums/sejour', { groupBy: 'annee' })).statusCode, 400);
    assert.equal(context.findAlbum('sejour')!.groupBy, 'month');
  });

  it('round-trips the sort order on creation and update', async () => {
    const chronologique = await post('/api/admin/albums', {
      id: 'sejour',
      title: 'Séjour',
      folderId: 'folder-sejour',
    });
    assert.equal(
      (chronologique.json() as AdminAlbum).sortOrder,
      'asc',
      'an album starts at its beginning unless told otherwise',
    );

    const recentes = await post('/api/admin/albums', {
      id: 'quotidien',
      title: 'Quotidien',
      folderId: 'folder-quotidien',
      sortOrder: 'desc',
    });
    assert.equal((recentes.json() as AdminAlbum).sortOrder, 'desc');
    // The gallery reads it too: this is the default it applies when neither the
    // URL nor browser storage imposes an order.
    const vue = await server.inject({
      method: 'GET',
      url: '/api/albums/quotidien',
      headers: { cookie },
    });
    assert.equal((vue.json() as { sortOrder: string }).sortOrder, 'desc');

    const bascule = await patch('/api/admin/albums/quotidien', { sortOrder: 'asc' });
    assert.equal((bascule.json() as AdminAlbum).sortOrder, 'asc');
    // The order does not affect the Drive scope: nothing needs reindexing.
    assert.equal(context.syncState.get('quotidien').status, 'never');

    assert.equal(
      (await patch('/api/admin/albums/quotidien', { sortOrder: 'aleatoire' })).statusCode,
      400,
    );
    assert.equal(context.findAlbum('quotidien')!.sortOrder, 'asc');
  });

  it('chooses a cover, rejects one outside the album, and falls back without it', async () => {
    await post('/api/admin/albums', {
      id: 'vacances',
      title: 'Vacances',
      folderId: 'folder-vacances',
    });
    await post('/api/admin/albums', {
      id: 'ailleurs',
      title: 'Ailleurs',
      folderId: 'folder-ailleurs',
    });
    context.media.upsertMany(
      [
        { ...media('vacances', 'ancienne'), takenAt: '2026-06-01T12:00:00.000Z' },
        { ...media('vacances', 'recente'), takenAt: '2026-08-01T12:00:00.000Z' },
        { ...media('ailleurs', 'etrangere'), takenAt: '2026-07-01T12:00:00.000Z' },
      ],
      '2026-08-02T00:00:00.000Z',
    );

    const vue = async (): Promise<string | null> => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/albums/vacances',
        headers: { cookie },
      });
      return (response.json() as { coverId: string | null }).coverId;
    };

    // Without a choice, use the most recent — the behaviour before the column.
    assert.equal(await vue(), 'recente');

    const choisie = await patch('/api/admin/albums/vacances', { coverId: 'ancienne' });
    assert.equal(choisie.statusCode, 200);
    assert.equal((choisie.json() as AdminAlbum).coverId, 'ancienne');
    assert.equal(await vue(), 'ancienne');

    // A photo from another album could never be displayed: rejecting it
    // immediately exposes what a silent fallback would reveal from the home page.
    const etrangere = await patch('/api/admin/albums/vacances', { coverId: 'etrangere' });
    assert.equal(etrangere.statusCode, 400);
    assert.equal((etrangere.json() as { error: string }).error, 'unknown_cover');
    assert.equal(context.findAlbum('vacances')!.coverMediaId, 'ancienne', 'choice preserved');

    // The photo leaves the index — Drive bin, renamed folder: the album returns
    // to the most recent without losing the choice, which applies again on return.
    context.db.prepare("DELETE FROM media WHERE album_id = 'vacances' AND id = 'ancienne'").run();
    assert.equal(await vue(), 'recente');
    assert.equal(context.findAlbum('vacances')!.coverMediaId, 'ancienne');

    // `null` restores automatic cover selection: this is the /admin button.
    const rendue = await patch('/api/admin/albums/vacances', { coverId: null });
    assert.equal((rendue.json() as AdminAlbum).coverId, null);
    assert.equal(context.findAlbum('vacances')!.coverMediaId, null);
  });

  it('lists accounts with explicit access', async () => {
    await post('/api/admin/albums', {
      id: 'vacances',
      title: 'Vacances',
      folderId: 'folder-vacances',
    });
    await post('/api/admin/users', {
      username: 'famille',
      password: 'un-mot-de-passe',
      albums: ['vacances'],
    });

    const albums = (
      await server.inject({ method: 'GET', url: '/api/admin/albums', headers: { cookie } })
    ).json() as AdminAlbum[];
    // `patron` has the wildcard: it does not appear among explicit members.
    assert.deepEqual(albums[0]!.members, ['famille']);
  });

  it('clears the index when the Drive folder changes', async () => {
    await post('/api/admin/albums', {
      id: 'vacances',
      title: 'Vacances',
      folderId: 'folder-vacances',
    });
    context.media.upsertMany([media('vacances', 'photo-1')], '2026-07-01T00:00:00.000Z');
    context.syncState.set('vacances', {
      lastSyncAt: '2026-07-01T00:00:00.000Z',
      status: 'ok',
      error: null,
    });

    const renamed = await patch('/api/admin/albums/vacances', { title: 'Vacances 2026' });
    assert.equal(renamed.statusCode, 200);
    // A simple rename does not affect the index.
    assert.equal(context.media.stats('vacances').itemCount, 1);

    const moved = await patch('/api/admin/albums/vacances', { folderId: 'autre-dossier' });
    assert.equal(moved.statusCode, 200);
    assert.equal(
      context.media.stats('vacances').itemCount,
      0,
      'media from the old folder must no longer be served',
    );
    assert.equal(context.syncState.get('vacances').status, 'never');
  });

  it('clears the index when recursion changes', async () => {
    await post('/api/admin/albums', {
      id: 'profondeur',
      title: 'Profondeur',
      folderId: 'folder-profondeur',
      recursive: true,
    });
    context.media.upsertMany(
      [media('profondeur', 'photo-sous-dossier')],
      '2026-07-01T00:00:00.000Z',
    );

    // Returning to a flat folder removes subfolders from the scope: their photos
    // must not remain accessible until the next sync, which may never run on an
    // instance where automatic sync is disabled.
    const aplati = await patch('/api/admin/albums/profondeur', { recursive: false });
    assert.equal(aplati.statusCode, 200);
    assert.equal(context.media.stats('profondeur').itemCount, 0);
    assert.equal(context.syncState.get('profondeur').status, 'never');
  });

  it('removes media from the deleted album, and only that album', async () => {
    for (const id of ['vacances', 'prive']) {
      await post('/api/admin/albums', { id, title: id, folderId: `folder-${id}` });
    }
    // Same Drive file in two albums (nested folders): two rows.
    context.media.upsertMany(
      [media('vacances', 'partagee'), media('prive', 'partagee'), media('prive', 'privee')],
      '2026-07-01T00:00:00.000Z',
    );

    const removed = await server.inject({
      method: 'DELETE',
      url: '/api/admin/albums/vacances',
      headers: { cookie },
    });
    assert.equal(removed.statusCode, 200);

    assert.equal(context.findAlbum('vacances'), undefined);
    assert.equal(context.media.stats('vacances').itemCount, 0);
    assert.deepEqual(context.media.albumsContaining('partagee'), ['prive']);
    assert.equal(context.media.stats('prive').itemCount, 2);
  });

  it('returns 404 for an unknown album', async () => {
    assert.equal((await patch('/api/admin/albums/fantome', { title: 'X' })).statusCode, 404);
    const removed = await server.inject({
      method: 'DELETE',
      url: '/api/admin/albums/fantome',
      headers: { cookie },
    });
    assert.equal(removed.statusCode, 404);
  });
});

describe('isolation after access changes', () => {
  it('immediately follows album assignment and removal', async () => {
    await post('/api/admin/albums', {
      id: 'vacances',
      title: 'Vacances',
      folderId: 'folder-vacances',
    });
    await post('/api/admin/albums', { id: 'prive', title: 'Privé', folderId: 'folder-prive' });
    context.media.upsertMany(
      [media('vacances', 'photo-publique'), media('prive', 'photo-privee')],
      '2026-07-01T00:00:00.000Z',
    );

    await post('/api/admin/users', {
      username: 'famille',
      password: 'un-mot-de-passe',
      albums: ['vacances'],
    });
    const visitor = await login('famille', 'un-mot-de-passe');

    const seen = async (albumId: string): Promise<number> =>
      (
        await server.inject({
          method: 'GET',
          url: `/api/albums/${albumId}`,
          headers: { cookie: visitor },
        })
      ).statusCode;
    const mediaSeen = async (mediaId: string): Promise<number> =>
      (
        await server.inject({
          method: 'GET',
          url: `/api/media/${mediaId}/thumb?s=320`,
          headers: { cookie: visitor },
        })
      ).statusCode;

    assert.equal(await seen('vacances'), 200);
    assert.equal(await seen('prive'), 404);
    assert.equal(await mediaSeen('photo-privee'), 404);

    // Expanded access: the private album becomes visible without logging in again.
    assert.equal(
      (await patch('/api/admin/users/famille', { albums: ['vacances', 'prive'] })).statusCode,
      200,
    );
    assert.equal(await seen('prive'), 200);

    // Revoked access: the next request is denied with the same session.
    assert.equal((await patch('/api/admin/users/famille', { albums: [] })).statusCode, 200);
    assert.equal(await seen('vacances'), 404);
    assert.equal(await seen('prive'), 404);
    assert.equal(await mediaSeen('photo-privee'), 404);

    // The wildcard grants everything, including an album created later.
    assert.equal((await patch('/api/admin/users/famille', { albums: ['*'] })).statusCode, 200);
    await post('/api/admin/albums', { id: 'apres', title: 'Après', folderId: 'folder-apres' });
    assert.equal(await seen('apres'), 200);
  });
});

describe('settings', () => {
  it('apply without restarting', async () => {
    let notified: AppSettings | null = null;
    context.onSettingsChanged((settings) => {
      notified = settings;
    });

    const response = await patch('/api/admin/settings', {
      syncIntervalMinutes: 5,
      cacheMaxSizeGB: 2,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      syncIntervalMinutes: 5,
      syncOnStartup: true,
      cacheMaxSizeGB: 2,
      // Untouched by this PATCH: only the submitted fields change.
      instanceName: 'Photos',
      primaryColor: DEFAULT_PRIMARY_COLOR,
      prewarmCache: true,
      transcodeVideos: true,
      videoCacheMaxSizeGB: 5,
      moderationEmail: null,
    });

    // The disk cache limit changes immediately — the previous configuration
    // reload read it only at startup.
    assert.equal(context.cache.stats().maxBytes, 2 * 1024 ** 3);
    // The synchronisation timer in `main.ts` is notified too.
    assert.equal((notified as AppSettings | null)?.syncIntervalMinutes, 5);

    const read = await server.inject({
      method: 'GET',
      url: '/api/admin/settings',
      headers: { cookie },
    });
    assert.deepEqual((read.json() as AppSettings).cacheMaxSizeGB, 2);
  });

  it('rejects an out-of-range value without changing anything', async () => {
    assert.equal((await patch('/api/admin/settings', { cacheMaxSizeGB: 0 })).statusCode, 400);
    assert.equal((await patch('/api/admin/settings', { syncIntervalMinutes: -1 })).statusCode, 400);
    assert.equal(context.settings.cacheMaxSizeGB, 20);
  });
});

describe('access to administration routes', () => {
  it('requires an administrator session', async () => {
    await post('/api/admin/users', { username: 'famille', password: 'un-mot-de-passe' });
    const visitor = await login('famille', 'un-mot-de-passe');

    for (const url of ['/api/admin/users', '/api/admin/albums', '/api/admin/settings']) {
      assert.equal((await server.inject({ method: 'GET', url })).statusCode, 401, url);
      assert.equal(
        (await server.inject({ method: 'GET', url, headers: { cookie: visitor } })).statusCode,
        403,
        url,
      );
    }
  });
});
