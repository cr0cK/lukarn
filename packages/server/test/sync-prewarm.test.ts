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
 * A synchronisation prepares thumbnails for what it has just indexed and names
 * the days that its geolocated photos make it possible to name.
 *
 * This is the only time the instance knows there is new content, which is
 * precisely what visitors open. Without this sequence, a freshly synchronised
 * album stays cold until hourly maintenance: its grid requests several dozen
 * thumbnails at once, the server renders only two to four concurrently
 * depending on the core count, and each starts with a two-second Drive
 * download. Places have the same problem in another form: a day's heading
 * would remain silent for an hour even though the newly indexed EXIF already
 * says where it was taken (D91).
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'nonni-sync-prewarm-'));

let server: FastifyInstance;
let context: AppContext;
let cookie: string;

before(async () => {
  const env = loadEnv({
    NODE_ENV: 'test',
    SESSION_SECRET: 's'.repeat(48),
    TOKEN_KEY: 't'.repeat(48),
    CONFIG_PATH: join(root, 'albums-absent.yaml'),
    DATA_DIR: join(root, 'data'),
    CACHE_DIR: join(root, 'cache'),
    WEB_DIR: join(root, 'web-absent'),
    LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);

  const built = await buildApp(env);
  server = built.server;
  context = built.context;

  context.config.createUser({
    username: 'patron',
    passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    admin: true,
    albums: ['*'],
  });
  context.config.createAlbum({ id: 'vacances', title: 'Vacances', folderId: 'dossier-1' });

  // The route refuses to synchronise without Drive: this is the only thing we
  // simulate; the rest of the path is real.
  Object.defineProperty(context.drive, 'connected', { get: () => true });

  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'patron', password: PASSWORD },
  });
  cookie = `nonni_session=${response.cookies.find((c) => c.name === 'nonni_session')!.value}`;
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

/** Replaces all three collaborators and records their call order. */
function espionner(): string[] {
  const ordre: string[] = [];
  const remplacable = context as unknown as {
    syncer: { syncAll: (albums: unknown[]) => Promise<unknown[]> };
    prewarmer: { run: () => Promise<unknown> };
    places: { run: () => Promise<unknown> };
  };
  remplacable.syncer = {
    syncAll: async () => {
      ordre.push('sync');
      await Promise.resolve();
      return [];
    },
  };
  remplacable.prewarmer = {
    run: () => {
      ordre.push('prechauffage');
      return Promise.resolve({});
    },
  };
  remplacable.places = {
    run: () => {
      ordre.push('lieux');
      return Promise.resolve({});
    },
  };
  return ordre;
}

describe('synchronisation followed by prewarming', () => {
  it('prewarms after synchronisation, never before', async () => {
    const ordre = espionner();

    await context.syncThenPrewarm([]);

    // Order is the point: prewarming first would use the previous index, which
    // contains everything except the photos that just arrived. Places run in
    // between because they are detached — prewarming does not wait for their
    // geocoding, which takes minutes.
    assert.deepEqual(ordre, ['sync', 'lieux', 'prechauffage']);
  });

  it('derives places from photos that have just arrived', async () => {
    const ordre = espionner();

    await context.syncThenPrewarm([]);

    // This is why the trigger exists: geolocated photos are added to Drive and
    // the day gets its place without waiting for hourly maintenance. Places run
    // after synchronisation and never before, for the same reason as prewarming:
    // beforehand, they would aggregate yesterday's positions.
    assert.equal(ordre.indexOf('lieux'), ordre.indexOf('sync') + 1);
  });

  it('also applies to resynchronisation requested from /admin', async () => {
    const ordre = espionner();

    const response = await server.inject({
      method: 'POST',
      url: '/api/admin/resync',
      headers: { cookie },
      payload: {},
    });
    assert.equal(response.statusCode, 202);

    // This runs in the background, so the response is sent before completion.
    await new Promise((resolve) => setImmediate(resolve));

    // This is the case that motivated the sequence: an album is created,
    // synchronised from /admin and immediately opened. A route calling `syncer`
    // directly would leave that album cold without any visible warning.
    assert.deepEqual(ordre, ['sync', 'lieux', 'prechauffage']);
  });
});
