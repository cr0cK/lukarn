import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Test de bout en bout du cloisonnement des albums : un utilisateur ne doit
 * atteindre ni les métadonnées, ni les fichiers d'un album qui ne lui est pas
 * attribué — et l'API ne doit pas non plus lui révéler qu'ils existent.
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'gdv-access-'));

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
  };
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

before(async () => {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const configPath = join(root, 'albums.yaml');

  writeFileSync(
    configPath,
    `
users:
  - username: alexis
    passwordHash: "${hash}"
    admin: true
    albums: ["*"]
  - username: famille
    passwordHash: "${hash}"
    albums: ["vacances"]
albums:
  - id: vacances
    title: Vacances
    folderId: folder-vacances
  - id: prive
    title: Privé
    folderId: folder-prive
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

  const built = await buildApp(env, loadConfig(configPath));
  server = built.server;
  context = built.context;

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

describe('accès anonyme', () => {
  it('refuse les albums', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/albums' });
    assert.equal(response.statusCode, 401);
  });

  it('refuse les fichiers', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/photo-publique/thumb?s=320',
    });
    assert.equal(response.statusCode, 401);
  });

  it('refuse un mot de passe incorrect', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'famille', password: 'mauvais' },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.cookies.length, 0);
  });
});

describe('cloisonnement des albums', () => {
  it("n'expose que les albums attribués", async () => {
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

  it('renvoie 404 — et non 403 — sur un album interdit', async () => {
    const cookie = await login('famille');
    for (const url of [
      '/api/albums/prive',
      '/api/albums/prive/items',
      '/api/albums/prive/items/photo-privee',
    ]) {
      const response = await server.inject({ method: 'GET', url, headers: { cookie } });
      // Un 403 confirmerait l'existence de l'album : le 404 ne dit rien.
      assert.equal(response.statusCode, 404, url);
    }
  });

  it("refuse le fichier d'un album interdit", async () => {
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

  it('laisse passer un administrateur sur tous les albums', async () => {
    const cookie = await login('alexis');
    const response = await server.inject({
      method: 'GET',
      url: '/api/albums/prive/items/photo-privee',
      headers: { cookie },
    });
    assert.equal(response.statusCode, 200);
  });

  it("réserve l'administration aux comptes admin", async () => {
    const cookie = await login('famille');
    const response = await server.inject({
      method: 'GET',
      url: '/api/admin/status',
      headers: { cookie },
    });
    assert.equal(response.statusCode, 403);
  });
});

describe('cycle de session', () => {
  it('invalide le cookie après déconnexion', async () => {
    const cookie = await login('famille');

    const before = await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(before.statusCode, 200);

    await server.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });

    const after = await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(after.statusCode, 401);
  });

  it('rejette un cookie forgé', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: 'gdv_session=identifiant-invente' },
    });
    assert.equal(response.statusCode, 401);
  });
});
