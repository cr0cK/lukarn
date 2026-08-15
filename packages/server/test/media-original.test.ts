import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ALL_ALBUMS } from '@lukarn/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Original file relay. The route transforms nothing: it copies the status and
 * range headers from Drive because the browser player knows how to use them.
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'lukarn-original-'));

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

  context.config.createAlbum({
    id: 'films',
    title: 'Films',
    folderId: 'dossier-films',
    recursive: true,
  });
  context.config.createUser({
    username: 'alexis',
    passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    admin: true,
    albums: [ALL_ALBUMS],
  });

  const video: MediaUpsert = {
    albumId: 'films',
    id: 'clip',
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    kind: 'video',
    size: 4096,
    width: 1920,
    height: 1080,
    takenAt: '2026-01-01T00:00:00.000Z',
    takenAtFromExif: false,
    modifiedTime: '2026-01-01T00:00:00.000Z',
    durationMs: 12_000,
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
  context.media.upsertMany([video], '2026-01-01T00:00:00.000Z');

  const login = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'alexis', password: PASSWORD },
  });
  const session = login.cookies.find((entry) => entry.name === 'lukarn_session');
  assert.ok(session);
  cookie = `lukarn_session=${session.value}`;
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('original file relay', () => {
  it('copies a 206 fragment and its headers', async () => {
    context.storage.fetch = () =>
      Promise.resolve(
        new Response('abc', {
          status: 206,
          headers: { 'content-range': 'bytes 0-2/4096', 'content-length': '3' },
        }),
      );

    const response = await server.inject({
      method: 'GET',
      url: '/api/media/clip/original',
      headers: { cookie, range: 'bytes=0-2' },
    });

    assert.equal(response.statusCode, 206);
    assert.equal(response.headers['content-range'], 'bytes 0-2/4096');
    assert.equal(response.headers['accept-ranges'], 'bytes');
  });

  it('relays a 416 rather than turning it into a server error', async () => {
    context.storage.fetch = () =>
      Promise.resolve(
        new Response(null, { status: 416, headers: { 'content-range': 'bytes */4096' } }),
      );

    // Changing video while a request is in flight commonly produces an offset
    // request beyond the end: this is normal `Range` protocol that the player
    // understands — a 500 tells it nothing.
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/clip/original',
      headers: { cookie, range: 'bytes=99999-' },
    });

    assert.equal(response.statusCode, 416);
    assert.equal(response.headers['content-range'], 'bytes */4096');
  });
});

describe('browser cache for protected media', () => {
  it('keys the entry by the session that obtained it', async () => {
    context.storage.fetch = () => Promise.resolve(new Response('des octets'));

    const response = await server.inject({
      method: 'GET',
      url: '/api/media/clip/original',
      headers: { cookie },
    });

    assert.equal(response.statusCode, 200);
    // Without `Vary`, two accounts used successively in the same browser profile
    // — the living-room computer — share entries: the second reopens from history
    // media it was never allowed to see, without any request reaching access control.
    assert.equal(response.headers.vary, 'Cookie');
    assert.match(String(response.headers['cache-control']), /private/);
  });
});
