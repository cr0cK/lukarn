import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { classifyDevice } from '../src/device.js';
import { loadEnv } from '../src/env.js';
import { encodeCursor, type MediaUpsert } from '../src/repo.js';

/**
 * Visit telemetry (D260809h).
 *
 * Three ideas govern what follows. Counters are **aggregated on write**:
 * reopening the same album on the same day from the same session does not add
 * a row, but increments its existing one. A visitor is a **session**, not an
 * access key — a key is shared, and two browsers behind it are two visitors.
 * None of this has foreign keys: logging out or deleting an album does not
 * erase what was viewed.
 */

const root = mkdtempSync(join(tmpdir(), 'lukarn-visites-'));

const env = loadEnv({
  NODE_ENV: 'test',
  SESSION_SECRET: 's'.repeat(48),
  TOKEN_KEY: 't'.repeat(48),
  PUBLIC_URL: 'https://photos.exemple.fr',
  CONFIG_PATH: join(root, 'absent.yaml'),
  DATA_DIR: join(root, 'data'),
  CACHE_DIR: join(root, 'cache'),
  WEB_DIR: join(root, 'web'),
  LOG_LEVEL: 'fatal',
} as NodeJS.ProcessEnv);

const MOT_DE_PASSE = 'mot-de-passe-de-test';
const JOUR_MS = 24 * 60 * 60 * 1000;

/** A webOS 4 device: it reports "Mobile" and "Safari" like a phone. */
const UA_TELEVISEUR =
  'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/68.0.3440.106 Safari/537.36 WebAppManager';
const UA_TELEPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

let server: FastifyInstance;
let context: AppContext;

function photo(albumId: string, id: string): MediaUpsert {
  return {
    albumId,
    id,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    size: 1000,
    width: 400,
    height: 300,
    takenAt: '2026-07-01T10:00:00.000Z',
    takenAtFromExif: true,
    modifiedTime: '2026-07-01T10:00:00.000Z',
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
    md5: 'abcdef0123456789',
    hasThumbnail: true,
    videoCodec: null,
    sourcePath: null,
  };
}

/** Opens a session reporting the requested device and returns its cookie. */
async function connexion(username: string, userAgent: string): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'user-agent': userAgent },
    payload: { username, password: MOT_DE_PASSE },
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = response.cookies.find((entry) => entry.name === 'lukarn_session');
  assert.ok(cookie);
  return `lukarn_session=${cookie.value}`;
}

before(async () => {
  const built = await buildApp(env);
  server = built.server;
  context = built.context;

  context.config.createAlbum({ id: 'corse', title: 'Corse', folderId: 'f1', recursive: true });
  context.config.createAlbum({ id: 'noel', title: 'Noël', folderId: 'f2', recursive: true });
  context.config.createUser({
    username: 'famille',
    passwordHash: await argon2.hash(MOT_DE_PASSE, { type: argon2.argon2id }),
    admin: false,
    albums: ['corse', 'noel'],
  });
  context.media.upsertMany(
    [photo('corse', 'img-1'), photo('corse', 'img-2'), photo('corse', 'img-3')],
    '2026-07-01T00:00:00.000Z',
  );
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('visit counters', () => {
  beforeEach(() => {
    context.db.prepare('DELETE FROM album_visits').run();
  });

  it('writes one row when the same session reopens the same album on the same day', () => {
    context.visits.recordAlbumOpen('corse', 'famille', 'session-a');
    context.visits.recordAlbumOpen('corse', 'famille', 'session-a');

    const lignes = context.db.prepare('SELECT visits, photos FROM album_visits').all() as {
      visits: number;
      photos: number;
    }[];

    // This is the point of aggregation on write: one row per (album, key,
    // session, day), never one per request. Without it, the table would grow by
    // tens of thousands of rows per day.
    assert.equal(lignes.length, 1);
    assert.equal(lignes[0]!.visits, 2);
    assert.equal(lignes[0]!.photos, 0);
  });

  it('counts two visitors when the same key opens from two browsers', () => {
    context.visits.recordAlbumOpen('corse', 'famille', 'session-a');
    context.visits.recordAlbumOpen('corse', 'famille', 'session-b');

    const apercu = context.visits.overview(7);
    // An access key is shared (D38): counting it as one visitor would turn an
    // entire household into one person. The session is the best available proxy.
    assert.equal(apercu.albums[0]!.visitors, 2);
    assert.equal(apercu.albums[0]!.keys, 1);
    assert.equal(apercu.visitors.length, 1);
    assert.equal(apercu.visitors[0]!.sessions, 2);
  });

  it('retains visits from a destroyed session', () => {
    const session = context.sessions.create('famille');
    context.visits.recordAlbumOpen('corse', 'famille', session.id);

    context.sessions.destroy(session.id);

    // Logging out deletes the session, never the viewing history: `session_id`
    // is only a bucket for counting distinct visitors here, not a relationship.
    // A foreign key would have removed it.
    const apercu = context.visits.overview(7);
    assert.equal(apercu.albums[0]!.visits, 1);
    assert.equal(apercu.albums[0]!.visitors, 1);
  });

  it('retains visits to a deleted album and reports it', () => {
    context.config.createAlbum({
      id: 'ephemere',
      title: 'Éphémère',
      folderId: 'f3',
      recursive: true,
    });
    context.visits.recordAlbumOpen('ephemere', 'famille', 'session-a');

    context.config.deleteAlbum('ephemere');

    const ligne = context.visits.overview(7).albums.find((a) => a.albumId === 'ephemere');
    assert.ok(ligne, 'past traffic remains valid');
    assert.equal(ligne.visits, 1);
    // The title comes from an outer join: it becomes `null` instead of removing
    // the row, and the screen displays the identifier.
    assert.equal(ligne.title, null);
  });

  it('ignores data outside the requested window', () => {
    const maintenant = new Date('2026-08-09T12:00:00.000Z');
    const vieux = new Date(maintenant.getTime() - 30 * JOUR_MS);

    context.visits.recordAlbumOpen('corse', 'famille', 'session-a', vieux);
    context.visits.recordAlbumOpen('noel', 'famille', 'session-a', maintenant);

    const semaine = context.visits.overview(7, maintenant);
    assert.deepEqual(
      semaine.albums.map((album) => album.albumId),
      ['noel'],
    );
    assert.equal(semaine.since, '2026-08-03');

    // The wider window sees both: it is the same table and only the boundary changes.
    const trimestre = context.visits.overview(90, maintenant);
    assert.equal(trimestre.albums.length, 2);
  });

  it('forgets days beyond retention', () => {
    const maintenant = new Date('2026-08-09T12:00:00.000Z');
    context.visits.recordAlbumOpen(
      'corse',
      'famille',
      'session-a',
      new Date(maintenant.getTime() - 401 * JOUR_MS),
    );
    context.visits.recordAlbumOpen(
      'noel',
      'famille',
      'session-a',
      new Date(maintenant.getTime() - 399 * JOUR_MS),
    );

    assert.equal(context.visits.purgeOld(400, maintenant), 1);
    // Four hundred days rather than 365 allows one August to be compared with
    // the previous year's.
    assert.deepEqual(
      (context.db.prepare('SELECT album_id FROM album_visits').all() as { album_id: string }[]).map(
        (row) => row.album_id,
      ),
      ['noel'],
    );
  });
});

describe('device class', () => {
  it('recognises a television before mistaking it for a phone', () => {
    // Test order is the point: webOS reports "Mobile" and "Safari", and a
    // naive test would classify the living room as a phone.
    assert.equal(classifyDevice(UA_TELEVISEUR), 'tv');
    assert.equal(classifyDevice(UA_TELEPHONE), 'mobile');
  });

  it('does not mistake an Android tablet for a phone', () => {
    // Chrome writes "Mobile" only on a phone: its absence distinguishes the
    // two, and nothing else in the header does.
    const tablette =
      'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/120.0.0.0 Safari/537.36';
    assert.equal(classifyDevice(tablette), 'tablette');
    assert.equal(classifyDevice(`${tablette.replace('Safari', 'Mobile Safari')}`), 'mobile');
  });

  it('does not invent a class without a header', () => {
    // A default value would be indistinguishable from a measurement.
    assert.equal(classifyDevice(undefined), null);
    assert.equal(classifyDevice(''), null);
  });
});

describe('through the API', () => {
  beforeEach(() => {
    context.db.prepare('DELETE FROM album_visits').run();
    context.db.prepare('DELETE FROM sessions').run();
  });

  async function ouvrir(url: string, cookie: string): Promise<void> {
    const response = await server.inject({ method: 'GET', url, headers: { cookie } });
    assert.equal(response.statusCode, 200, response.body);
  }

  it('counts one visit and three photos for an ordinary visit', async () => {
    const cookie = await connexion('famille', UA_TELEPHONE);

    await ouvrir('/api/albums/corse/items', cookie);
    for (const id of ['img-1', 'img-2', 'img-3']) {
      await ouvrir(`/api/albums/corse/items/${id}`, cookie);
    }

    const apercu = context.visits.overview(7);
    assert.equal(apercu.albums.length, 1);
    assert.equal(apercu.albums[0]!.visits, 1);
    assert.equal(apercu.albums[0]!.photos, 3);
    assert.deepEqual(apercu.visitors[0]!.devices, ['mobile']);
  });

  it('does not count another visit while paging', async () => {
    const cookie = await connexion('famille', UA_TELEPHONE);
    await ouvrir('/api/albums/corse/items', cookie);

    const curseur = encodeCursor('2026-07-01T10:00:00.000Z', 'img-1');
    await ouvrir(`/api/albums/corse/items?cursor=${encodeURIComponent(curseur)}`, cookie);

    // Later pages are part of the same action as the first: counting them would
    // make the column report the number of pages viewed.
    assert.equal(context.visits.overview(7).albums[0]!.visits, 1);
  });

  it('does not count media that does not exist', async () => {
    const cookie = await connexion('famille', UA_TELEPHONE);
    const response = await server.inject({
      method: 'GET',
      url: '/api/albums/corse/items/inconnu',
      headers: { cookie },
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(context.visits.overview(7).albums, []);
  });

  it('stores the device class and latest request, never the user agent', async () => {
    await connexion('famille', UA_TELEVISEUR);

    const session = context.db
      .prepare('SELECT device, last_seen_at FROM sessions WHERE username = ?')
      .get('famille') as { device: string; last_seen_at: string };

    assert.equal(session.device, 'tv');
    assert.ok(session.last_seen_at, 'login itself timestamps the session');

    // No column stores the header: one class among four cannot re-identify
    // anyone, while the full user agent is a fingerprint.
    const colonnes = (context.db.pragma('table_info(sessions)') as { name: string }[]).map(
      (row) => row.name,
    );
    assert.deepEqual(colonnes, [
      'id',
      'username',
      'created_at',
      'expires_at',
      'commenter_id',
      'last_seen_at',
      'device',
    ]);
  });

  it('does not write last_seen_at on every request', async () => {
    const cookie = await connexion('famille', UA_TELEPHONE);
    const lire = (): string =>
      (
        context.db
          .prepare('SELECT last_seen_at FROM sessions WHERE username = ?')
          .get('famille') as {
          last_seen_at: string;
        }
      ).last_seen_at;

    const initial = lire();
    await ouvrir('/api/albums', cookie);
    await ouvrir('/api/albums/corse/items', cookie);

    // Capped at one write per hour per session: without this threshold, every
    // grid thumbnail would trigger a SQLite UPDATE.
    assert.equal(lire(), initial);

    // A session whose trace is over an hour old is timestamped again on the next
    // read — this is what supports "visited this week".
    context.db
      .prepare('UPDATE sessions SET last_seen_at = ? WHERE username = ?')
      .run('2020-01-01T00:00:00.000Z', 'famille');
    await ouvrir('/api/albums', cookie);
    assert.notEqual(lire(), '2020-01-01T00:00:00.000Z');
  });
});
