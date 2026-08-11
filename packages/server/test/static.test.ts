import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';

/**
 * Service du front buildé. Le routage vit côté client : toute URL qui n'est ni
 * une API ni un fichier existant doit rendre `index.html`, sans quoi un simple
 * rechargement de page tomberait en erreur.
 */

const root = mkdtempSync(join(tmpdir(), 'nonni-static-'));
const webDir = join(root, 'web');

let server: FastifyInstance;
let context: AppContext;

before(async () => {
  mkdirSync(join(webDir, 'assets'), { recursive: true });
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Photos</title>', 'utf8');
  writeFileSync(join(webDir, 'assets', 'index-abc123.js'), 'export default 1;\n', 'utf8');

  const hash = await argon2.hash('x', { type: argon2.argon2id });
  const configPath = join(root, 'albums.yaml');
  writeFileSync(
    configPath,
    `
users:
  - username: alexis
    passwordHash: "${hash}"
    albums: ["a"]
albums:
  - id: a
    title: A
    folderId: f
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
    WEB_DIR: webDir,
    LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);

  const built = await buildApp(env);
  server = built.server;
  context = built.context;
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('service du front', () => {
  for (const url of ['/', '/login', '/album/vacances-2025', '/admin', '/nimporte/quoi']) {
    it(`rend l'application sur ${url}`, async () => {
      const response = await server.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 200, url);
      assert.match(response.headers['content-type'] as string, /text\/html/);
      assert.match(response.body, /<title>Photos<\/title>/);
    });
  }

  it('sert un asset avec son vrai type MIME', async () => {
    const response = await server.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] as string, /javascript/);
    // Nom haché : le contenu ne changera jamais à cette URL.
    assert.match(response.headers['cache-control'] as string, /immutable/);
  });

  it("n'autorise pas la mise en cache longue de index.html", async () => {
    const response = await server.inject({ method: 'GET', url: '/' });
    // Sans ça, un déploiement ne serait jamais vu par les navigateurs qui ont
    // déjà chargé la page une fois.
    assert.match(response.headers['cache-control'] as string, /no-cache/);
  });

  it('renvoie 404 pour un asset absent, pas index.html', async () => {
    // Répondre du HTML donnerait une erreur de type MIME côté navigateur, qui
    // masquerait le vrai problème : un déploiement incomplet.
    const response = await server.inject({ method: 'GET', url: '/assets/absent.js' });
    assert.equal(response.statusCode, 404);
  });

  it('renvoie 404 JSON sur une route API inconnue', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/inconnue' });
    assert.equal(response.statusCode, 404);
    assert.equal((response.json() as { error: string }).error, 'not_found');
  });

  it('répond au health check', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok' });
  });
});
