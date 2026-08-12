import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';

/**
 * Fresh installation without any account.
 *
 * The server starts and responds normally, but no login can succeed: without a
 * signal, the application appears broken when only `pnpm create-admin` is
 * missing. The login screen must be able to explain this.
 */

const root = mkdtempSync(join(tmpdir(), 'lukarn-setup-'));

let server: FastifyInstance;
let context: AppContext;

before(async () => {
  const env = loadEnv({
    NODE_ENV: 'test',
    SESSION_SECRET: 's'.repeat(48),
    TOKEN_KEY: 't'.repeat(48),
    // Neither a database account nor a bootstrap file: this is a first
    // installation where the README has been followed through to start-up.
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

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('setup state', () => {
  it('reports a database without any account', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/auth/setup-state' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { needsSetup: true });
  });

  it('responds without a session because that is when it is needed', async () => {
    // The login screen calls this route as an anonymous visitor. Requiring a
    // session would make it useless.
    const response = await server.inject({ method: 'GET', url: '/api/auth/setup-state' });
    assert.notEqual(response.statusCode, 401);
  });

  it('stops reporting setup as soon as an account exists', async () => {
    context.config.createUser({
      username: 'patron',
      passwordHash: await argon2.hash('motdepasse123', { type: argon2.argon2id }),
      admin: true,
      albums: ['*'],
    });

    const response = await server.inject({ method: 'GET', url: '/api/auth/setup-state' });
    assert.deepEqual(response.json(), { needsSetup: false });
  });

  it('does not disclose any identifier', async () => {
    // The only information exposed is "does anyone exist"; the account list
    // remains restricted to administration.
    const response = await server.inject({ method: 'GET', url: '/api/auth/setup-state' });
    assert.equal(Object.keys(response.json() as object).length, 1);
    assert.doesNotMatch(response.body, /patron/);
  });
});
