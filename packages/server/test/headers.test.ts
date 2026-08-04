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
 * En-têtes de sécurité. L'invariant tenu ici n'est pas la valeur exacte de la
 * CSP — elle bougera — mais le fait qu'**aucune** réponse n'y échappe : ni le
 * front servi par `@fastify/static`, ni une 404, ni l'API. C'est précisément ce
 * qu'un en-tête posé au reverse-proxy ne garantit pas.
 */

const root = mkdtempSync(join(tmpdir(), 'gdv-headers-'));
const webDir = join(root, 'web');

/** Monte une instance dont seule `PUBLIC_URL` varie. */
async function monter(publicUrl: string): Promise<{ server: FastifyInstance; context: AppContext }> {
  const hash = await argon2.hash('x', { type: argon2.argon2id });
  const configPath = join(root, `albums-${encodeURIComponent(publicUrl)}.yaml`);
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
    PUBLIC_URL: publicUrl,
    SESSION_SECRET: 's'.repeat(48),
    TOKEN_KEY: 't'.repeat(48),
    CONFIG_PATH: configPath,
    DATA_DIR: join(root, `data-${encodeURIComponent(publicUrl)}`),
    CACHE_DIR: join(root, `cache-${encodeURIComponent(publicUrl)}`),
    WEB_DIR: webDir,
    LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);

  return buildApp(env);
}

let http: FastifyInstance;
let httpContext: AppContext;
let https: FastifyInstance;
let httpsContext: AppContext;

before(async () => {
  mkdirSync(join(webDir, 'assets'), { recursive: true });
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Photos</title>', 'utf8');
  writeFileSync(join(webDir, 'assets', 'index-abc123.js'), 'export default 1;\n', 'utf8');

  ({ server: http, context: httpContext } = await monter('http://localhost:8080'));
  ({ server: https, context: httpsContext } = await monter('https://photos.exemple.fr'));
});

after(async () => {
  await http?.close();
  await https?.close();
  httpContext?.close();
  httpsContext?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('en-têtes de sécurité', () => {
  const urls = [
    ['/', 'le front'],
    ['/assets/index-abc123.js', 'un asset'],
    ['/api/health', "l'API"],
    ['/api/inconnue', 'une 404 API'],
    ['/album/vacances', 'une route du front'],
  ] as const;

  for (const [url, quoi] of urls) {
    it(`couvre ${quoi} (${url})`, async () => {
      const response = await http.inject({ method: 'GET', url });
      assert.match(response.headers['content-security-policy'] as string, /script-src 'self'/);
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.equal(response.headers['x-frame-options'], 'DENY');
      assert.equal(response.headers['referrer-policy'], 'no-referrer');
    });
  }

  it("interdit l'encadrement et les origines tierces", async () => {
    const csp = (await http.inject({ method: 'GET', url: '/' })).headers[
      'content-security-policy'
    ] as string;
    for (const directive of [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "connect-src 'self'",
    ]) {
      assert.ok(csp.includes(directive), `directive absente : ${directive}`);
    }
  });

  it('ne pose pas HSTS quand PUBLIC_URL est en http', async () => {
    // Sinon un navigateur ayant ouvert une instance de développement réclamerait
    // du HTTPS à localhost pendant six mois, sans moyen simple de revenir.
    const response = await http.inject({ method: 'GET', url: '/' });
    assert.equal(response.headers['strict-transport-security'], undefined);
  });

  it('pose HSTS quand PUBLIC_URL est en https', async () => {
    const response = await https.inject({ method: 'GET', url: '/' });
    assert.equal(response.headers['strict-transport-security'], 'max-age=15552000');
  });

  it('laisse intact le Cache-Control des assets', async () => {
    // Le hook touche aux en-têtes de toutes les réponses : il ne doit pas
    // écraser ce que @fastify/static pose ensuite.
    const response = await http.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    assert.match(response.headers['cache-control'] as string, /immutable/);
  });
});
