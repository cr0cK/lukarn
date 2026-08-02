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
 * Installation neuve sans aucun compte.
 *
 * Le serveur démarre et répond normalement, mais aucune connexion ne peut
 * aboutir : sans signal, l'application paraît en panne alors qu'il manque
 * seulement `pnpm create-admin`. L'écran de connexion doit pouvoir le dire.
 */

const root = mkdtempSync(join(tmpdir(), 'gdv-setup-'));

let server: FastifyInstance;
let context: AppContext;

before(async () => {
  const env = loadEnv({
    NODE_ENV: 'test',
    SESSION_SECRET: 's'.repeat(48),
    TOKEN_KEY: 't'.repeat(48),
    // Ni compte en base, ni fichier d'amorçage : le cas d'une première
    // installation où l'on a suivi le README jusqu'au démarrage.
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

describe('état d’installation', () => {
  it('signale une base sans aucun compte', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/auth/setup-state' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { needsSetup: true });
  });

  it('répond sans session : c’est justement à ce moment qu’on en a besoin', async () => {
    // La route est interrogée depuis l'écran de connexion, donc par un visiteur
    // anonyme. Exiger une session la rendrait inutile.
    const response = await server.inject({ method: 'GET', url: '/api/auth/setup-state' });
    assert.notEqual(response.statusCode, 401);
  });

  it('ne signale plus rien dès qu’un compte existe', async () => {
    context.config.createUser({
      username: 'patron',
      passwordHash: await argon2.hash('motdepasse123', { type: argon2.argon2id }),
      admin: true,
      albums: ['*'],
    });

    const response = await server.inject({ method: 'GET', url: '/api/auth/setup-state' });
    assert.deepEqual(response.json(), { needsSetup: false });
  });

  it('ne divulgue aucun identifiant', async () => {
    // Le seul renseignement livré est « y a-t-il quelqu'un » ; la liste des
    // comptes reste réservée à l'administration.
    const response = await server.inject({ method: 'GET', url: '/api/auth/setup-state' });
    assert.equal(Object.keys(response.json() as object).length, 1);
    assert.doesNotMatch(response.body, /patron/);
  });
});
