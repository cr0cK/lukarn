import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { ItemsPage, MediaDetail, MediaItem } from '@nonni/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Photo description as exposed by the API.
 *
 * Four invariants would be costly to break: text is **isolated by album**, it
 * **survives deindexing** (a photo can leave the index after a transient Drive
 * problem, while manually written text cannot be regenerated), the **join does
 * not disrupt pagination**, and writes remain under `/api/admin`, the only
 * prefix that returns 403 (D50, D83).
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'nonni-notes-'));

let server: FastifyInstance;
let context: AppContext;
let hash: string;
let adminCookie: string;
let visitorCookie: string;

function photo(albumId: string, id: string, takenAt: string): MediaUpsert {
  return {
    albumId,
    id,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    size: 1234,
    width: 3000,
    height: 2000,
    takenAt,
    takenAtFromExif: true,
    modifiedTime: takenAt,
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
  return `nonni_session=${response.cookies.find((c) => c.name === 'nonni_session')!.value}`;
}

function get(url: string, cookie: string): ReturnType<typeof server.inject> {
  return server.inject({ method: 'GET', url, headers: { cookie } });
}

function patch(url: string, cookie: string, payload: unknown): ReturnType<typeof server.inject> {
  return server.inject({ method: 'PATCH', url, headers: { cookie }, payload: payload as object });
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
  context.media.pruneAlbums([]);
  context.db.prepare('DELETE FROM sessions').run();

  context.config.createAlbum({ id: 'corse', title: 'Corse', folderId: 'f1', recursive: true });
  context.config.createAlbum({ id: 'prive', title: 'Privé', folderId: 'f1', recursive: true });
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

describe('photo description — isolation', () => {
  it('stores two texts for the same file indexed under two albums', () => {
    // A nested folder is the common case: one file legitimately present in two
    // albums. Mixing the texts would show a visitor what was written in an
    // album they cannot open (D12).
    const takenAt = '2026-07-14T10:00:00.000Z';
    context.media.upsertMany(
      [photo('corse', 'partagee', takenAt), photo('prive', 'partagee', takenAt)],
      takenAt,
    );

    context.media.setDescription('corse', 'partagee', { description: 'Léa saute du ponton' });
    context.media.setDescription('prive', 'partagee', { description: 'À ne pas montrer' });

    assert.equal(context.media.getDetail('corse', 'partagee')?.description, 'Léa saute du ponton');
    assert.equal(context.media.getDetail('prive', 'partagee')?.description, 'À ne pas montrer');
  });

  it('carries the description with both the item and the detail', async () => {
    const takenAt = '2026-07-14T10:00:00.000Z';
    context.media.upsertMany([photo('corse', 'p1', takenAt)], takenAt);
    context.media.setDescription('corse', 'p1', { description: 'Léa saute du ponton' });

    const page = (await get('/api/albums/corse/items', visitorCookie)).json() as ItemsPage;
    assert.equal(page.items[0]?.description, 'Léa saute du ponton');

    const detail = (await get('/api/albums/corse/items/p1', visitorCookie)).json() as MediaDetail;
    assert.equal(detail.description, 'Léa saute du ponton');
  });
});

describe('photo description — survival after deindexing', () => {
  it('survives deleteStale and returns with the reindexed photo', () => {
    // A temporary move to the Drive bin, a renamed folder or an interrupted sync
    // removes the photo from the index without anybody deciding to lose its
    // text. Since the Drive identifier is stable, the text must return (D83).
    context.media.upsertMany([photo('corse', 'p1', '2026-07-14T10:00:00.000Z')], 'passage-1');
    context.media.setDescription('corse', 'p1', { description: 'Léa saute du ponton' });

    assert.equal(context.media.deleteStale('corse', 'passage-2'), 1);
    assert.equal(context.media.getDetail('corse', 'p1'), null);
    assert.equal(
      (
        context.db
          .prepare('SELECT COUNT(*) AS n FROM media_notes WHERE album_id = ?')
          .get('corse') as { n: number }
      ).n,
      1,
      'the description must not leave with the photo',
    );

    context.media.upsertMany([photo('corse', 'p1', '2026-07-14T10:00:00.000Z')], 'passage-3');
    assert.equal(context.media.getDetail('corse', 'p1')?.description, 'Léa saute du ponton');
  });

  it('leaves with the album, the only intended cleanup', () => {
    context.media.upsertMany([photo('corse', 'p1', '2026-07-14T10:00:00.000Z')], 'passage-1');
    context.media.setDescription('corse', 'p1', { description: 'Léa saute du ponton' });

    context.config.deleteAlbum('corse');

    // The cascade on `albums`, and only it, performs cleanup.
    assert.equal(
      (context.db.prepare('SELECT COUNT(*) AS n FROM media_notes').get() as { n: number }).n,
      0,
    );
  });
});

describe('photo description — pagination', () => {
  it('makes the join neither duplicate nor lose rows', async () => {
    const items = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id, index) =>
      photo('corse', id, `2026-07-1${index}T10:00:00.000Z`),
    );
    context.media.upsertMany(items, 'passage-1');
    // Two described photos out of five: the join therefore returns both kinds
    // of row on the same page.
    context.media.setDescription('corse', 'p2', { description: 'Décrite' });
    context.media.setDescription('corse', 'p4', { description: 'Décrite aussi' });

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url = `/api/albums/corse/items?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = (await get(url, visitorCookie)).json() as ItemsPage;
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);

    assert.deepEqual(seen, ['p1', 'p2', 'p3', 'p4', 'p5']);
    assert.equal(new Set(seen).size, seen.length, 'no duplicates');
  });
});

describe('PATCH /api/admin/albums/:id/items/:mediaId', () => {
  const url = '/api/admin/albums/corse/items/p1';

  beforeEach(() => {
    context.media.upsertMany([photo('corse', 'p1', '2026-07-14T10:00:00.000Z')], 'passage-1');
  });

  it('rejects a visitor with 403 and an anonymous user with 401', async () => {
    // 403 here and nowhere else: this is the counterpart to editing from the
    // gallery, and this route does not shift the invariant (D50).
    assert.equal((await patch(url, visitorCookie, { description: 'Non' })).statusCode, 403);
    assert.equal(
      (await server.inject({ method: 'PATCH', url, payload: { description: 'Non' } })).statusCode,
      401,
    );
    assert.equal(context.media.getDetail('corse', 'p1')?.description, null);
  });

  it('writes, reads back and returns the updated item', async () => {
    const saved = await patch(url, adminCookie, { description: 'Léa saute du ponton' });
    assert.equal(saved.statusCode, 200);
    assert.equal((saved.json() as MediaItem).id, 'p1');
    assert.equal((saved.json() as MediaItem).description, 'Léa saute du ponton');

    const relu = await patch(url, adminCookie, { description: 'Troisième essai' });
    assert.equal((relu.json() as MediaItem).description, 'Troisième essai');
  });

  it('clears with null or an empty string', async () => {
    await patch(url, adminCookie, { description: 'Une légende' });
    assert.equal((await patch(url, adminCookie, { description: null })).statusCode, 200);
    assert.equal(context.media.getDetail('corse', 'p1')?.description, null);

    await patch(url, adminCookie, { description: 'Une légende' });
    // An empty string is what a field sends after being cleared: rejecting it
    // would force the front end to translate "empty" into `null`.
    assert.equal((await patch(url, adminCookie, { description: '   ' })).statusCode, 200);
    assert.equal(context.media.getDetail('corse', 'p1')?.description, null);
    assert.equal(
      (context.db.prepare('SELECT COUNT(*) AS n FROM media_notes').get() as { n: number }).n,
      0,
      'an empty line says no more than an absent line',
    );
  });

  it('leaves the text in place when the field is absent', async () => {
    await patch(url, adminCookie, { description: 'Une légende' });
    const inchange = await patch(url, adminCookie, {});
    assert.equal((inchange.json() as MediaItem).description, 'Une légende');
  });

  it('rejects more than one thousand characters', async () => {
    assert.equal(
      (await patch(url, adminCookie, { description: 'x'.repeat(1001) })).statusCode,
      400,
    );
    assert.equal(
      (await patch(url, adminCookie, { description: 'x'.repeat(1000) })).statusCode,
      200,
    );
  });

  it('returns 404 for an unknown album and unindexed media', async () => {
    assert.equal(
      (await patch('/api/admin/albums/fantome/items/p1', adminCookie, { description: 'X' }))
        .statusCode,
      404,
    );
    // Not indexed in **this** album: the text could never have been displayed.
    assert.equal(
      (await patch('/api/admin/albums/prive/items/p1', adminCookie, { description: 'X' }))
        .statusCode,
      404,
    );
  });
});
