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
import { NoPreviewError } from '../src/media/renderer.js';
import type { StorageProvider } from '../src/storage/provider.js';
import { loadEnv } from '../src/env.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Video thumbnail. The image does not come from local decoding — no video byte
 * is read here (D92) — but from the preview the storage already holds.
 *
 * What the route decides is narrow, and this holds it to exactly that: it serves
 * the preview like an ordinary thumbnail, refuses full screen and zoom whatever
 * the file, and turns "no image can be produced at all" into a 415 rather than a
 * 500. Whether such an image can be produced is the renderer's question, and
 * `renderer.test.ts` is where it is asked — the route stopped answering it from
 * `has_thumbnail` in D260816.
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
    [video('avec-apercu', true), video('index-perime', false), video('sans-apercu', false)],
    '2026-01-01T00:00:00.000Z',
  );

  const jpeg = await sharp({
    create: { width: 640, height: 360, channels: 3, background: { r: 20, g: 90, b: 160 } },
  })
    .jpeg()
    .toBuffer();

  // A storage as it answers for a video: no downloadable original here, only the
  // preview it already holds. Fetching the original is the anomaly this
  // arrangement would expose.
  const stockage = {
    guard: <T>(operation: () => Promise<T>) => operation(),
    fetch: () => {
      throw new Error('a video original must never be downloaded for a thumbnail');
    },
    preview: () => Promise.resolve(new Response(jpeg)),
  } as unknown as StorageProvider;
  context.storage.get = () => stockage;

  // The one video for which nothing can be produced: its storage holds no preview
  // and no still can be cut from it. Stated here rather than through a fake ffmpeg
  // because the route's job is the translation, not the decision — and letting the
  // real binary decide would make this pass or fail with the machine.
  const rendu = context.renderer.render.bind(context.renderer);
  context.renderer.render = ((storage, file, ...reste) =>
    file.id === 'sans-apercu'
      ? Promise.reject(new NoPreviewError(file.id))
      : rendu(storage, file, ...reste)) as typeof context.renderer.render;

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

  it('serves the preview of a video the index recorded as having none', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/index-perime/thumb?s=320',
      headers: { cookie },
    });

    // `has_thumbnail` is what the storage said at sync time, and outside Drive every
    // backend says no. Refusing on it would leave every album read from a folder or
    // a bucket without a single video tile (D260816).
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'image/webp');
  });

  it('turns "no image can be produced" into 415, not 500', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/sans-apercu/thumb?s=320',
      headers: { cookie },
    });

    // Not a fault: the storage holds no preview and the image has no ffmpeg to cut
    // one. A 500 would make the browser retry a state that will not change.
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
