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
 * Security headers. The invariant here is not the exact CSP value — it will
 * change — but that **no** response escapes it: neither the front end served by
 * `@fastify/static`, nor a 404, nor the API. A header set at the reverse proxy
 * cannot guarantee precisely this.
 */

const root = mkdtempSync(join(tmpdir(), 'lukarn-headers-'));
const webDir = join(root, 'web');

/** Builds an instance in which only `PUBLIC_URL` varies. */
async function monter(
  publicUrl: string,
): Promise<{ server: FastifyInstance; context: AppContext }> {
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

describe('security headers', () => {
  const urls = [
    ['/', 'the front end'],
    ['/assets/index-abc123.js', 'an asset'],
    ['/api/health', 'the API'],
    ['/api/inconnue', 'an API 404'],
    ['/album/vacances', 'a front-end route'],
  ] as const;

  for (const [url, quoi] of urls) {
    it(`covers ${quoi} (${url})`, async () => {
      const response = await http.inject({ method: 'GET', url });
      assert.match(response.headers['content-security-policy'] as string, /script-src 'self'/);
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.equal(response.headers['x-frame-options'], 'DENY');
      assert.equal(response.headers['referrer-policy'], 'no-referrer');
    });
  }

  it('forbids framing and third-party origins', async () => {
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
      assert.ok(csp.includes(directive), `missing directive: ${directive}`);
    }
  });

  it('does not set HSTS when PUBLIC_URL uses http', async () => {
    // Otherwise a browser that opened a development instance would require
    // HTTPS on localhost for six months, with no simple way back.
    const response = await http.inject({ method: 'GET', url: '/' });
    assert.equal(response.headers['strict-transport-security'], undefined);
  });

  it('sets HSTS when PUBLIC_URL uses https', async () => {
    const response = await https.inject({ method: 'GET', url: '/' });
    assert.equal(response.headers['strict-transport-security'], 'max-age=15552000');
  });

  it('leaves asset Cache-Control intact', async () => {
    // The hook touches every response's headers: it must not overwrite what
    // @fastify/static sets afterwards.
    const response = await http.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    assert.match(response.headers['cache-control'] as string, /immutable/);
  });
});
