import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ALL_ALBUMS } from '@nonni/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Vignette d'une vidéo. L'image ne vient pas d'un décodage local — aucun octet
 * de vidéo n'est lu ici (D92) — mais de l'aperçu que Drive produit de la
 * première seconde. Ce qui est vérifié : la route sert cet aperçu comme une
 * vignette ordinaire, et refuse précisément les deux cas où il n'y a rien à
 * servir.
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'nonni-poster-'));

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

  // Drive tel qu'il répond sur une vidéo : pas d'original téléchargeable ici,
  // seulement le `thumbnailLink` de `files.get`. Tirer l'original serait
  // l'anomalie que ce montage rend visible.
  context.drive.fetchFile = () => {
    throw new Error('un original de vidéo ne doit jamais être téléchargé pour une vignette');
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
  const session = login.cookies.find((entry) => entry.name === 'nonni_session');
  assert.ok(session);
  cookie = `nonni_session=${session.value}`;
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('vignette d’une vidéo', () => {
  it('sert l’aperçu Drive comme une vignette ordinaire', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/avec-apercu/thumb?s=320',
      headers: { cookie },
    });

    assert.equal(response.statusCode, 200);
    // Le même WebP que pour une photo : la grille n'a pas à distinguer les
    // deux, et le dérivé est mis en cache disque de la même façon.
    assert.equal(response.headers['content-type'], 'image/webp');
    assert.match(String(response.headers['cache-control']), /immutable/);
  });

  it('refuse la vidéo dont Drive n’a pas d’aperçu', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/sans-apercu/thumb?s=320',
      headers: { cookie },
    });

    // Codec qu'aucun aperçu ne couvre, ou fichier déposé trop récemment : la
    // colonne dit ce que la sync a vu, et le refus évite un appel à Drive dont
    // on connaît déjà l'issue.
    assert.equal(response.statusCode, 415);
    assert.equal(response.json().error, 'unsupported');
  });

  it('refuse le plein écran et le zoom, avec ou sans aperçu', async () => {
    for (const id of ['avec-apercu', 'sans-apercu']) {
      for (const variante of ['full', 'hd']) {
        const response = await server.inject({
          method: 'GET',
          url: `/api/media/${id}/${variante}`,
          headers: { cookie },
        });

        // L'aperçu Drive fait quelques centaines de pixels : l'agrandir à
        // 2560 ou 4096 ne montrerait rien de plus qu'une image floue, servie
        // sous un ETag qui la déclare immuable pour un an.
        assert.equal(response.statusCode, 415, `${id}/${variante}`);
      }
    }
  });
});
