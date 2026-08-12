import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Sort order exposed by `GET /api/albums/:albumId/items`. The repository already
 * has unit coverage; what matters here is carrying the parameter from the HTTP
 * request to the SQL query, and handling a value nobody anticipated.
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'lukarn-order-'));

let server: FastifyInstance;
let context: AppContext;
let cookie: string;

function media(id: string, takenAt: string): MediaUpsert {
  return {
    albumId: 'vacances',
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

async function ids(query: string): Promise<string[]> {
  const response = await server.inject({
    method: 'GET',
    url: `/api/albums/vacances/items${query}`,
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200, query);
  return (response.json() as { items: { id: string }[] }).items.map((item) => item.id);
}

before(async () => {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const configPath = join(root, 'albums.yaml');

  writeFileSync(
    configPath,
    `
users:
  - username: famille
    passwordHash: "${hash}"
    albums: ["vacances"]
albums:
  - id: vacances
    title: Vacances
    folderId: folder-vacances
sync:
  onStartup: false
  intervalMinutes: 0
`,
    'utf8',
  );

  const env = loadEnv({
    NODE_ENV: 'test',
    SESSION_SECRET: 's'.repeat(48),
    TOKEN_KEY: 't'.repeat(48),
    CONFIG_PATH: configPath,
    DATA_DIR: join(root, 'data'),
    CACHE_DIR: join(root, 'cache'),
    WEB_DIR: join(root, 'web-absent'),
    LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);

  const built = await buildApp(env);
  server = built.server;
  context = built.context;

  context.media.upsertMany(
    [
      media('mars', '2024-03-01T10:00:00.000Z'),
      media('juin', '2024-06-01T10:00:00.000Z'),
      media('septembre', '2024-09-01T10:00:00.000Z'),
    ],
    '2025-01-01T00:00:00.000Z',
  );

  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'famille', password: PASSWORD },
  });
  const session = response.cookies.find((entry) => entry.name === 'lukarn_session');
  assert.ok(session, 'session cookie missing');
  cookie = `lukarn_session=${session.value}`;
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('media sort order', () => {
  it('returns the oldest first without a parameter', async () => {
    // The default is a contract, namely `DEFAULT_SORT_ORDER`: an album is read
    // in the order it was lived unless something requests otherwise (D99). An
    // album's chosen order lives in its column, not here: this route knows only
    // what the client passes.
    assert.deepEqual(await ids(''), ['mars', 'juin', 'septembre']);
  });

  it('reverses the list in ascending order', async () => {
    const desc = await ids('?order=desc');
    const asc = await ids('?order=asc');

    assert.deepEqual(asc, ['mars', 'juin', 'septembre']);
    assert.deepEqual(asc, [...desc].reverse());
  });

  it('paginates in the requested direction', async () => {
    // A next page from an ascending cursor must continue towards the future:
    // this is where a cursor comparison left as `<` would return the page
    // already read, or nothing at all.
    const first = await server.inject({
      method: 'GET',
      url: '/api/albums/vacances/items?order=asc&limit=2',
      headers: { cookie },
    });
    const page = first.json() as { items: { id: string }[]; nextCursor: string | null };

    assert.deepEqual(
      page.items.map((item) => item.id),
      ['mars', 'juin'],
    );
    assert.ok(page.nextCursor, 'cursor expected after a partial page');
    assert.deepEqual(await ids(`?order=asc&cursor=${encodeURIComponent(page.nextCursor)}`), [
      'septembre',
    ]);
  });

  it('rejects an unknown sort value without crashing', async () => {
    // A 500 would signal an uncaught error, while silently falling back to the
    // default would show the client the opposite of what it thinks it requested.
    for (const value of ['zigzag', 'ASC', '', 'asc,desc']) {
      const response = await server.inject({
        method: 'GET',
        url: `/api/albums/vacances/items?order=${encodeURIComponent(value)}`,
        headers: { cookie },
      });
      assert.equal(response.statusCode, 400, value);
      assert.equal((response.json() as { error: string }).error, 'bad_request', value);
    }
  });

  it('does not reveal a forbidden album regardless of order', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/albums/inconnu/items?order=asc',
      headers: { cookie },
    });
    assert.equal(response.statusCode, 404);
  });
});
