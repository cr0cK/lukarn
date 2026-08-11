import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ALL_ALBUMS } from '@nonni/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import { playableKey } from '../src/media/transcode.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Version lisible d'une vidéo (D260809b).
 *
 * Le fichier est local, contrairement à `/original` qui relaie Drive : c'est la
 * route qui résout les plages, et c'est là qu'un défaut coûterait cher — un
 * `Content-Range` faux fait tourner un lecteur en rond sans rien dire.
 *
 * L'absence de version prête est un **404**, jamais une erreur : la préparation
 * est anticipée et lente, et le front en fait « en préparation ».
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'nonni-playable-'));
/** Corps du dérivé : court, et de contenu reconnaissable octet par octet. */
const CONTENU = Buffer.from('0123456789abcdef');

let server: FastifyInstance;
let context: AppContext;
let cookie: string;
/** Session d'un compte qui n'a que « films » : sert le contrôle de cloisonnement. */
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
  };
}

async function login(username: string): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: PASSWORD },
  });
  const session = response.cookies.find((entry) => entry.name === 'nonni_session');
  assert.ok(session, `connexion de « ${username} » attendue`);
  return `nonni_session=${session.value}`;
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

  // Deux versions au magasin : celle d'une vidéo qu'« invite » peut voir, et
  // celle d'une vidéo d'un album qui ne lui est pas attribué. La seconde existe
  // exprès — un refus qui ne tiendrait qu'à l'absence du fichier ne prouverait
  // rien du cloisonnement.
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

describe('version lisible d’une vidéo', () => {
  it('répond 404 tant qu’elle n’est pas préparée', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/attente/playable',
      headers: { cookie },
    });

    // C'est le contrat avec le front : pas une erreur, un « pas encore ».
    assert.equal(response.statusCode, 404);
    assert.equal((response.json() as { error: string }).error, 'not_ready');
  });

  it('sert le fichier entier une fois préparé', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/prete/playable',
      headers: { cookie },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.rawPayload.toString(), CONTENU.toString());
    // Toujours du MP4, quel que soit le conteneur d'origine — ici un `.mov`.
    assert.equal(response.headers['content-type'], 'video/mp4');
    // Sans lui, le navigateur refuse de chercher dans le film.
    assert.equal(response.headers['accept-ranges'], 'bytes');
    assert.equal(response.headers.vary, 'Cookie');
  });

  it('sert un fragment demandé, avec sa plage exacte', async () => {
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

  it('borne une plage ouverte à la fin du fichier', async () => {
    // `bytes=10-` est ce que demande un lecteur qui reprend : la fin doit être
    // le dernier octet, pas une borne inventée.
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/prete/playable',
      headers: { cookie, range: 'bytes=10-' },
    });

    assert.equal(response.statusCode, 206);
    assert.equal(response.headers['content-range'], `bytes 10-15/${CONTENU.length}`);
    assert.equal(response.rawPayload.toString(), 'abcdef');
  });

  it('refuse une plage au-delà de la fin en disant la taille réelle', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/prete/playable',
      headers: { cookie, range: 'bytes=9999-' },
    });

    // Changer de vidéo pendant qu'une requête est en vol produit couramment ce
    // cas : le `Content-Range` dit au lecteur où recommencer.
    assert.equal(response.statusCode, 416);
    assert.equal(response.headers['content-range'], `bytes */${CONTENU.length}`);
  });

  it('répond 304 sur un ETag déjà connu', async () => {
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

  it('répond 404 à qui n’a pas l’album, alors même que le fichier est prêt', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/media/secrete/playable',
      headers: { cookie: cookieRestreint },
    });

    // 404 et non 403 : l'existence d'un média dans un album non autorisé ne doit
    // pas être observable (D12).
    assert.equal(response.statusCode, 404);
    assert.equal((response.json() as { error: string }).error, 'not_found');
  });
});
