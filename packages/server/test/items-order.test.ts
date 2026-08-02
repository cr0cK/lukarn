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
 * Sens du tri exposé par `GET /api/albums/:albumId/items`. Le dépôt est déjà
 * couvert unitairement ; ce qui se joue ici est le passage du paramètre de la
 * requête HTTP jusqu'à la requête SQL, et le sort réservé à une valeur que
 * personne n'a prévue.
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'gdv-order-'));

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

  const built = await buildApp(env, loadConfig(configPath));
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
  const session = response.cookies.find((entry) => entry.name === 'gdv_session');
  assert.ok(session, 'cookie de session absent');
  cookie = `gdv_session=${session.value}`;
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('sens du tri des médias', () => {
  it('rend le plus récent en premier sans paramètre', async () => {
    // Le défaut est un contrat : les liens déjà partagés ne portent pas
    // `order` et doivent continuer d'ouvrir l'album dans le même sens.
    assert.deepEqual(await ids(''), ['septembre', 'juin', 'mars']);
  });

  it('inverse la liste en ascendant', async () => {
    const desc = await ids('?order=desc');
    const asc = await ids('?order=asc');

    assert.deepEqual(asc, ['mars', 'juin', 'septembre']);
    assert.deepEqual(asc, [...desc].reverse());
  });

  it('pagine dans le sens demandé', async () => {
    // Une page suivante prise sur un curseur ascendant doit continuer vers le
    // futur : c'est là qu'une comparaison de curseur restée en `<` renverrait
    // la page déjà lue, ou rien du tout.
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
    assert.ok(page.nextCursor, 'curseur attendu après une page partielle');
    assert.deepEqual(await ids(`?order=asc&cursor=${encodeURIComponent(page.nextCursor)}`), [
      'septembre',
    ]);
  });

  it('refuse une valeur de tri inconnue sans planter', async () => {
    // Un 500 signalerait une erreur non rattrapée, et un repli silencieux sur
    // le défaut ferait afficher au client l'inverse de ce qu'il croit demander.
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

  it("ne révèle pas un album interdit, quel que soit l'ordre", async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/albums/inconnu/items?order=asc',
      headers: { cookie },
    });
    assert.equal(response.statusCode, 404);
  });
});
