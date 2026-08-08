import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ALL_ALBUMS, type Comment, type CommentsFeedPage } from '@gdv/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import { Mailer, type MailMessage } from '../src/mail.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Fil d'activité : ce qu'un visiteur voit des derniers commentaires, tous
 * albums et toutes photos confondus.
 *
 * L'invariant qui prime est le cloisonnement. Cette route est le premier
 * endroit de l'application qui rend, en une réponse, des messages venus
 * d'albums différents : une erreur de portée n'y produit pas une page vide mais
 * une fuite, et rien dans l'affichage ne la signalerait — la conversation d'un
 * album qu'on n'a pas s'y lit comme les autres.
 */

const PASSWORD = 'mot-de-passe-de-test';
const silencieux = { info: () => {}, warn: () => {}, debug: () => {} };
const root = mkdtempSync(join(tmpdir(), 'gdv-feed-'));

let server: FastifyInstance;
let context: AppContext;
let adminCookie: string;
let familleCookie: string;
let voisinCookie: string;
const envoyes: MailMessage[] = [];

function media(albumId: string, id: string, md5: string | null = null): MediaUpsert {
  return {
    albumId,
    id,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    size: 1234,
    width: 3000,
    height: 2000,
    takenAt: '2024-06-01T12:00:00.000Z',
    takenAtFromExif: true,
    modifiedTime: '2024-06-01T12:00:00.000Z',
    durationMs: null,
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
    videoCodec: null,
  };
}

async function login(username: string): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: PASSWORD },
  });
  assert.equal(response.statusCode, 200, `connexion de ${username} refusée`);
  const cookie = response.cookies.find((entry) => entry.name === 'gdv_session');
  assert.ok(cookie, 'cookie de session absent');
  return `gdv_session=${cookie.value}`;
}

async function identify(cookie: string, email: string, displayName: string): Promise<void> {
  envoyes.length = 0;
  const asked = await server.inject({
    method: 'POST',
    url: '/api/identity/request-code',
    headers: { cookie },
    payload: { email, displayName },
  });
  assert.equal(asked.statusCode, 202, asked.body);
  await context.mailer.drain();

  const message = envoyes.at(-1);
  assert.ok(message, 'aucun code envoyé');
  const code = /\b(\d{6})\b/.exec(message.text)?.[1];
  assert.ok(code, 'code introuvable');

  const verified = await server.inject({
    method: 'POST',
    url: '/api/identity/verify',
    headers: { cookie },
    payload: { email, code },
  });
  assert.equal(verified.statusCode, 200, verified.body);
}

async function post(
  cookie: string,
  albumId: string,
  mediaId: string,
  body: string,
): Promise<Comment> {
  const response = await server.inject({
    method: 'POST',
    url: `/api/comments/${albumId}/${mediaId}`,
    headers: { cookie },
    payload: { body, parentId: null },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<Comment>();
}

/** Interroge le fil, comme le fait le tiroir d'activité. */
async function feed(
  cookie: string,
  query: Record<string, string | number> = {},
): Promise<CommentsFeedPage> {
  const params = new URLSearchParams(
    Object.entries(query).map(([key, value]) => [key, String(value)]),
  );
  const response = await server.inject({
    method: 'GET',
    url: `/api/comments/feed?${params}`,
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<CommentsFeedPage>();
}

before(async () => {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

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
  context.mailer = new Mailer(async (message) => {
    envoyes.push(message);
  }, silencieux);

  context.config.createAlbum({
    id: 'vacances',
    title: 'Vacances',
    folderId: 'folder-vacances',
    recursive: true,
  });
  context.config.createAlbum({
    id: 'prive',
    title: 'Privé',
    folderId: 'folder-prive',
    recursive: true,
  });
  // Un album dont l'identifiant est le segment de la route : c'est le cas qui
  // dirait si la table de routage laissait `/:albumId` capter `/feed`.
  context.config.createAlbum({
    id: 'feed',
    title: 'Piège',
    folderId: 'folder-feed',
    recursive: true,
  });

  context.config.createUser({
    username: 'alexis',
    passwordHash: hash,
    admin: true,
    albums: [ALL_ALBUMS],
  });
  context.config.createUser({
    username: 'famille',
    passwordHash: hash,
    admin: false,
    albums: ['vacances'],
  });
  // Sans aucun album : la liste vide est le cas où un `IN ()` oublié rendrait
  // tout le corpus au lieu de rien.
  context.config.createUser({
    username: 'voisin',
    passwordHash: hash,
    admin: false,
    albums: [],
  });

  context.media.upsertMany(
    [
      media('vacances', 'plage', 'abcdef0123456789'),
      media('vacances', 'phare'),
      media('prive', 'salon'),
      media('vacances', 'ephemere'),
    ],
    '2025-01-01T00:00:00.000Z',
  );

  adminCookie = await login('alexis');
  familleCookie = await login('famille');
  voisinCookie = await login('voisin');

  await identify(adminCookie, 'chef@exemple.fr', 'Alexis');
  await identify(familleCookie, 'mamie@exemple.fr', 'Mamie');

  await post(adminCookie, 'vacances', 'plage', 'La lumière du soir');
  await post(familleCookie, 'vacances', 'plage', 'Celle-là mérite un tirage');
  await post(adminCookie, 'prive', 'salon', 'Le salon avant travaux');
  await post(adminCookie, 'vacances', 'phare', 'Le phare au petit matin');
  await post(familleCookie, 'vacances', 'plage', 'On y retourne quand ?');
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('cloisonnement du fil d’activité', () => {
  it('n’expose jamais un commentaire d’un album non attribué', async () => {
    const page = await feed(familleCookie);

    assert.ok(page.comments.length > 0, 'le fil est vide alors que l’album partagé est commenté');
    assert.ok(
      page.comments.every((comment) => comment.albumId === 'vacances'),
      'un commentaire d’un album non attribué est passé dans le fil',
    );
  });

  it('rend une page vide à un compte sans album, et non tout le corpus', async () => {
    const page = await feed(voisinCookie);
    assert.deepEqual(page, { comments: [], nextCursor: null });
  });

  it('répond 404 sur un album non attribué, comme sur un album inexistant', async () => {
    const interdit = await server.inject({
      method: 'GET',
      url: '/api/comments/feed?album=prive',
      headers: { cookie: familleCookie },
    });
    const inexistant = await server.inject({
      method: 'GET',
      url: '/api/comments/feed?album=inconnu',
      headers: { cookie: familleCookie },
    });

    assert.equal(interdit.statusCode, 404);
    assert.equal(inexistant.statusCode, 404);
    // Indistinguables : sonder des identifiants ne doit rien apprendre (D12).
    assert.deepEqual(interdit.json(), inexistant.json());
  });

  it('refuse un fil anonyme', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/comments/feed' });
    assert.equal(response.statusCode, 401);
  });

  it('reste atteignable même si un album porte « feed » pour identifiant', async () => {
    const page = await feed(adminCookie, { limit: 1 });
    // Les compteurs de l'album homonyme rendraient `{ counts: {} }`, sans
    // `comments` : c'est cette confusion-là qu'on écarte.
    assert.ok(Array.isArray(page.comments), 'le fil a été capté par la route d’album');
  });
});

describe('contenu d’une entrée du fil', () => {
  it('situe le message dans son album et sur sa photo', async () => {
    const page = await feed(adminCookie, { limit: 1, album: 'vacances' });
    const dernier = page.comments[0];

    assert.ok(dernier);
    assert.equal(dernier.body, 'On y retourne quand ?');
    assert.equal(dernier.albumId, 'vacances');
    assert.equal(dernier.albumTitle, 'Vacances');
    assert.equal(dernier.mediaId, 'plage');
    assert.equal(dernier.mediaName, 'plage.jpg');
    // Huit caractères de l'empreinte, comme partout ailleurs : la vignette est
    // servie en `immutable`, son URL doit changer avec le contenu du fichier.
    assert.equal(dernier.mediaVersion, 'abcdef01');
  });

  it('garde le message d’une photo disparue de l’index, sans vignette', async () => {
    const commentaire = await post(adminCookie, 'vacances', 'ephemere', 'Elle existait ce jour-là');
    // La photo quitte Drive : la synchronisation suivante la retire de l'index.
    context.media.upsertMany([media('vacances', 'plage')], '2025-02-01T00:00:00.000Z');
    assert.equal(context.media.deleteStale('vacances', '2025-02-01T00:00:00.000Z') > 0, true);

    const page = await feed(adminCookie, { album: 'vacances' });
    const orphelin = page.comments.find((entry) => entry.id === commentaire.id);

    assert.ok(orphelin, 'le commentaire a disparu avec sa photo');
    assert.equal(orphelin.mediaName, null);
    assert.equal(orphelin.mediaVersion, null);
    assert.equal(orphelin.body, 'Elle existait ce jour-là');
  });
});

describe('pagination du fil d’activité', () => {
  it('ne recouvre ni ne saute une ligne entre deux pages consécutives', async () => {
    const complet = await feed(adminCookie);
    assert.ok(complet.comments.length >= 4, 'trop peu de messages pour éprouver la pagination');

    const premiere = await feed(adminCookie, { limit: 2 });
    assert.equal(premiere.comments.length, 2);
    assert.ok(premiere.nextCursor, 'la première page annonce la fin alors qu’il reste des lignes');

    const seconde = await feed(adminCookie, { limit: 2, cursor: premiere.nextCursor });
    const ids = [...premiere.comments, ...seconde.comments].map((entry) => entry.id);

    assert.equal(new Set(ids).size, ids.length, 'un commentaire apparaît sur les deux pages');
    assert.deepEqual(
      ids,
      complet.comments.slice(0, 4).map((entry) => entry.id),
      'les deux pages ne reconstituent pas le début du fil complet',
    );
  });

  it('rend le plus récent en premier', async () => {
    const page = await feed(adminCookie);
    const ids = page.comments.map((entry) => entry.id);
    assert.deepEqual(
      ids,
      [...ids].sort((a, b) => b - a),
    );
  });

  it('annonce la fin par un curseur nul', async () => {
    const page = await feed(adminCookie, { limit: 100 });
    assert.equal(page.nextCursor, null);
  });
});

describe('modération et fil d’activité', () => {
  it('retire du fil un commentaire masqué', async () => {
    const cible = await post(adminCookie, 'vacances', 'plage', 'À masquer');

    const avant = await feed(adminCookie, { album: 'vacances' });
    assert.ok(avant.comments.some((entry) => entry.id === cible.id));

    const masque = await server.inject({
      method: 'POST',
      url: `/api/admin/comments/${cible.id}/hide`,
      headers: { cookie: adminCookie },
    });
    assert.equal(masque.statusCode, 200, masque.body);

    const apres = await feed(adminCookie, { album: 'vacances' });
    assert.ok(
      !apres.comments.some((entry) => entry.id === cible.id),
      'un commentaire masqué reste lisible depuis le fil',
    );
  });
});
