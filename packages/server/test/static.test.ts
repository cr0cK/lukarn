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
 * Serving the built front end. Routing lives on the client: any URL that is
 * neither an API nor an existing file must return `index.html`, otherwise a
 * simple page reload would fail.
 */

const root = mkdtempSync(join(tmpdir(), 'lukarn-static-'));
const webDir = join(root, 'web');

let server: FastifyInstance;
let context: AppContext;

before(async () => {
  mkdirSync(join(webDir, 'assets'), { recursive: true });
  writeFileSync(
    join(webDir, 'index.html'),
    '<!doctype html><html lang="en" style="--color-accent: #eb2020"><title>Photos</title></html>',
    'utf8',
  );
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

describe('front-end serving', () => {
  for (const url of ['/', '/login', '/album/vacances-2025', '/admin', '/nimporte/quoi']) {
    it(`returns the application at ${url}`, async () => {
      const response = await server.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 200, url);
      assert.match(response.headers['content-type'] as string, /text\/html/);
      assert.match(response.body, /<title>Photos<\/title>/);
    });
  }

  it('serves an asset with its real MIME type', async () => {
    const response = await server.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] as string, /javascript/);
    // Hashed name: content will never change at this URL.
    assert.match(response.headers['cache-control'] as string, /immutable/);
  });

  it('does not allow long-term caching of index.html', async () => {
    const response = await server.inject({ method: 'GET', url: '/' });
    // Otherwise browsers that loaded the page once would never see a deployment.
    assert.match(response.headers['cache-control'] as string, /no-cache/);
  });

  it('returns 404 for a missing asset rather than index.html', async () => {
    // Returning HTML would cause a browser MIME error that hides the real
    // problem: an incomplete deployment.
    const response = await server.inject({ method: 'GET', url: '/assets/absent.js' });
    assert.equal(response.statusCode, 404);
  });

  it('returns a JSON 404 for an unknown API route', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/inconnue' });
    assert.equal(response.statusCode, 404);
    assert.equal((response.json() as { error: string }).error, 'not_found');
  });

  it('responds to the health check', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok' });
  });

  it('carries a renamed instance and a new colour without a restart', async () => {
    // The shell is rendered once and kept, so the risk here is not performance
    // but a rename that never reaches the tab. What drops the cache is the
    // settings listener — the same mechanism that reschedules the sync timer
    // (D260813c). Last in this file: it changes state the others read.
    context.updateSettings({ instanceName: 'Chez les Martin', primaryColor: '#3fae2a' });

    const page = await server.inject({ method: 'GET', url: '/album/vacances' });
    assert.match(page.body, /<title>Chez les Martin<\/title>/);
    assert.match(page.body, /--color-accent: #3fae2a/);
  });
});
