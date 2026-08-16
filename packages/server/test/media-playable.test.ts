import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ALL_ALBUMS } from '@lukarn/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import { playableKey } from '../src/media/transcode.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Playable version of a video (D260809b).
 *
 * The file is local, unlike `/original`, which relays Drive: the route resolves
 * ranges, and this is where a defect would be costly — an incorrect
 * `Content-Range` makes a player loop without explanation.
 *
 * A missing prepared version is a **404**, never an error: preparation is
 * proactive and slow, and the front end presents it as "preparing".
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'lukarn-playable-'));
/** Derived file body: short, with content recognisable byte by byte. */
const CONTENU = Buffer.from('0123456789abcdef');

let server: FastifyInstance;
let context: AppContext;
let cookie: string;
/** Session for an account with only "films": used to verify isolation. */
let cookieRestreint: string;

function video(albumId: string, id: string, md5: string | null): MediaUpsert {
  return {
    albumId,
    id,
    name: `${id}.mp4`,
    mimeType: 'video/quicktime',
    kind: 'video',
    size: 150_000_000,
    width: 1920,
    height: 1080,
    takenAt: '2026-01-01T00:00:00.000Z',
    takenAtFromExif: true,
    modifiedTime: '2026-01-01T00:00:00.000Z',
    durationMs: 60_000,
    cameraMake: null,
    cameraModel: null,
    lens: null,
    isoSpeed: null,
    exposureTime: null,
    aperture: null,
    focalLength: null,
    lat: null,
    lng: null,
    md5,
    hasThumbnail: true,
    videoCodec: 'hvc1',
    sourcePath: null,
  };
}

async function login(username: string): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: PASSWORD },
  });
  const session = response.cookies.find((entry) => entry.name === 'lukarn_session');
  assert.ok(session, `expected login for "${username}"`);
  return `lukarn_session=${session.value}`;
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

  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  for (const id of ['films', 'prive']) {
    context.config.createAlbum({ id, title: id, folderId: `dossier-${id}`, recursive: true });
  }
  context.config.createUser({
    username: 'alexis',
    passwordHash: hash,
    admin: true,
    albums: [ALL_ALBUMS],
  });
  context.config.createUser({
    username: 'invite',
    passwordHash: hash,
    admin: false,
    albums: ['films'],
  });

  context.media.upsertMany(
    [
      video('films', 'prete', 'empreinte-prete'),
      video('films', 'attente', 'empreinte-attente'),
      video('prive', 'secrete', 'empreinte-secrete'),
    ],
    '2026-01-01T00:00:00.000Z',
  );

  // Two versions in the store: one for a video "invite" can see, and one for a
  // video from an unassigned album. The second exists deliberately — a refusal
  // caused only by a missing file would prove nothing about isolation.
  for (const [id, md5] of [
    ['prete', 'empreinte-prete'],
    ['secrete', 'empreinte-secrete'],
  ] as const) {
    const source = join(root, `${id}.tmp`);
    writeFileSync(source, CONTENU);
    await context.videoStore.putFile(playableKey(id, md5), source);
  }

  cookie = await login('alexis');
  cookieRestreint = await login('invite');
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('playable version of a video', () => {
  it('returns 404 until it is prepared', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/attente/playable',
      headers: { cookie },
    });

    // This is the front-end contract: not an error, but "not yet".
    assert.equal(response.statusCode, 404);
    assert.equal((response.json() as { error: string }).error, 'not_ready');
  });

  it('serves the whole file once prepared', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/prete/playable',
      headers: { cookie },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.rawPayload.toString(), CONTENU.toString());
    // Always MP4, regardless of the original container — here a `.mov`.
    assert.equal(response.headers['content-type'], 'video/mp4');
    // Without it, the browser refuses to seek in the video.
    assert.equal(response.headers['accept-ranges'], 'bytes');
    assert.equal(response.headers.vary, 'Cookie');
  });

  it('serves a requested fragment with its exact range', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/prete/playable',
      headers: { cookie, range: 'bytes=4-9' },
    });

    assert.equal(response.statusCode, 206);
    assert.equal(response.headers['content-range'], `bytes 4-9/${CONTENU.length}`);
    assert.equal(response.headers['content-length'], '6');
    assert.equal(response.rawPayload.toString(), '456789');
  });

  it('bounds an open range at the end of the file', async () => {
    // `bytes=10-` is what a resuming player requests: the end must be the last
    // byte, not an invented boundary.
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/prete/playable',
      headers: { cookie, range: 'bytes=10-' },
    });

    assert.equal(response.statusCode, 206);
    assert.equal(response.headers['content-range'], `bytes 10-15/${CONTENU.length}`);
    assert.equal(response.rawPayload.toString(), 'abcdef');
  });

  it('rejects a range beyond the end while reporting the real size', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/prete/playable',
      headers: { cookie, range: 'bytes=9999-' },
    });

    // Changing video while a request is in flight commonly produces this case:
    // `Content-Range` tells the player where to restart.
    assert.equal(response.statusCode, 416);
    assert.equal(response.headers['content-range'], `bytes */${CONTENU.length}`);
  });

  it('returns 304 for an already known ETag', async () => {
    const premier = await server.inject({
      method: 'GET',
      url: '/api/media/prete/playable',
      headers: { cookie },
    });
    const etag = premier.headers.etag as string;

    const second = await server.inject({
      method: 'GET',
      url: '/api/media/prete/playable',
      headers: { cookie, 'if-none-match': etag },
    });

    assert.equal(second.statusCode, 304);
  });

  it('returns 404 without album access even when the file is ready', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/secrete/playable',
      headers: { cookie: cookieRestreint },
    });

    // 404, not 403: the existence of media in an unauthorised album must not be
    // observable (D12).
    assert.equal(response.statusCode, 404);
    assert.equal((response.json() as { error: string }).error, 'not_found');
  });
});
