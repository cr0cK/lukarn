import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ALL_ALBUMS } from '@lukarn/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Video thumbnail. The image does not come from local decoding — no video byte
 * is read here (D92) — but from the preview Drive produces for the first
 * second. This verifies that the route serves the preview like an ordinary
 * thumbnail and rejects precisely the two cases where there is nothing to serve.
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'lukarn-poster-'));

let server: FastifyInstance;
let context: AppContext;
let cookie: string;

function video(id: string, hasThumbnail: boolean): MediaUpsert {
  return {
    albumId: 'films',
    id,
    name: `${id}.mp4`,
    mimeType: 'video/mp4',
    kind: 'video',
    size: 48_000_000,
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
    hasThumbnail,
    videoCodec: null,
  };
}

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

  context.media.upsertMany(
    [video('avec-apercu', true), video('sans-apercu', false)],
    '2026-01-01T00:00:00.000Z',
  );

  const jpeg = await sharp({
    create: { width: 640, height: 360, channels: 3, background: { r: 20, g: 90, b: 160 } },
  })
    .jpeg()
    .toBuffer();

  // Drive as it responds for a video: no downloadable original here, only the
  // `thumbnailLink` from `files.get`. Fetching the original is the anomaly this
  // arrangement would expose.
  context.drive.fetchFile = () => {
    throw new Error('a video original must never be downloaded for a thumbnail');
  };
  context.drive.api = () =>
    ({
      files: {
        get: () => Promise.resolve({ data: { thumbnailLink: 'https://lh3.exemple/Vid=s220' } }),
      },
    }) as unknown as ReturnType<AppContext['drive']['api']>;
  context.drive.fetchAuthorized = () => Promise.resolve(new Response(jpeg));

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

describe('video thumbnail', () => {
  it('serves the Drive preview as an ordinary thumbnail', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/avec-apercu/thumb?s=320',
      headers: { cookie },
    });

    assert.equal(response.statusCode, 200);
    // The same WebP as for a photo means the grid need not distinguish them,
    // and the derivative is cached on disk in the same way.
    assert.equal(response.headers['content-type'], 'image/webp');
    assert.match(String(response.headers['cache-control']), /immutable/);
  });

  it('rejects video for which Drive has no preview', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/sans-apercu/thumb?s=320',
      headers: { cookie },
    });

    // A codec no preview supports, or a file uploaded too recently: the column
    // says what synchronisation saw, and rejecting avoids a Drive call whose
    // outcome is already known.
    assert.equal(response.statusCode, 415);
    assert.equal(response.json().error, 'unsupported');
  });

  it('rejects full screen and zoom with or without a preview', async () => {
    for (const id of ['avec-apercu', 'sans-apercu']) {
      for (const variante of ['full', 'hd']) {
        const response = await server.inject({
          method: 'GET',
          url: `/api/media/${id}/${variante}`,
          headers: { cookie },
        });

        // The Drive preview is a few hundred pixels wide: enlarging it to 2560
        // or 4096 would show nothing beyond a blurred image, served under an
        // ETag that declares it immutable for a year.
        assert.equal(response.statusCode, 415, `${id}/${variante}`);
      }
    }
  });
});
