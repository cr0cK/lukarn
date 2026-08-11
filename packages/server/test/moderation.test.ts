import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ALL_ALBUMS, type AdminCommentsPage, type Comment } from '@nonni/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import { Mailer, type MailMessage } from '../src/mail.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * File de modération : pagination, filtres, recherche et action groupée.
 *
 * Les invariants visés sont ceux qui font qu'on peut s'y fier pour travailler :
 * deux pages voisines ne se recouvrent ni ne sautent une ligne, le total dit la
 * taille du corpus et non celle du reste, les filtres partitionnent, et une
 * recherche cherche ce qu'on a tapé — un `%` compris.
 */

const PASSWORD = 'mot-de-passe-de-test';
const silencieux = { info: () => {}, warn: () => {}, debug: () => {} };
const root = mkdtempSync(join(tmpdir(), 'nonni-moderation-'));

let server: FastifyInstance;
let context: AppContext;
let adminCookie: string;
let familleCookie: string;
const envoyes: MailMessage[] = [];

/** Les identités créées par le montage, pour cibler l'action groupée. */
const identites = new Map<string, number>();

function media(albumId: string, id: string): MediaUpsert {
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
    md5: null,
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
  const cookie = response.cookies.find((entry) => entry.name === 'nonni_session');
  assert.ok(cookie, 'cookie de session absent');
  return `nonni_session=${cookie.value}`;
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

  const commenter = context.commenters.byEmail(email);
  assert.ok(commenter, `identité ${email} absente après vérification`);
  identites.set(email, commenter.id);
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

/** Interroge la file de modération, comme le fait l'administration. */
async function file(query: Record<string, string | number> = {}): Promise<AdminCommentsPage> {
  const params = new URLSearchParams(
    Object.entries(query).map(([key, value]) => [key, String(value)]),
  );
  const response = await server.inject({
    method: 'GET',
    url: `/api/admin/comments?${params}`,
    headers: { cookie: adminCookie },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<AdminCommentsPage>();
}

async function moderate(commentId: number, action: 'hide' | 'show'): Promise<void> {
  const response = await server.inject({
    method: 'POST',
    url: `/api/admin/comments/${commentId}/${action}`,
    headers: { cookie: adminCookie },
  });
  assert.equal(response.statusCode, 200, response.body);
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
    id: 'corse',
    title: 'Corse',
    folderId: 'folder-corse',
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
    albums: [ALL_ALBUMS],
  });

  context.media.upsertMany(
    [media('vacances', 'plage'), media('vacances', 'phare'), media('corse', 'bonifacio')],
    '2025-01-01T00:00:00.000Z',
  );

  adminCookie = await login('alexis');
  familleCookie = await login('famille');

  await identify(adminCookie, 'chef@exemple.fr', 'Alexis');
  await identify(familleCookie, 'mamie@exemple.fr', 'Mamie');

  // Six messages, deux albums, deux identités. Le dernier porte un `%` : c'est
  // lui qui démasque une recherche qui n'échapperait pas les jokers de LIKE.
  await post(adminCookie, 'vacances', 'plage', 'La lumière du soir sur la plage');
  await post(familleCookie, 'vacances', 'plage', 'Celle-là mérite un tirage');
  await post(adminCookie, 'vacances', 'phare', 'Le phare au petit matin');
  await post(familleCookie, 'corse', 'bonifacio', 'Bonifacio depuis la mer');
  await post(adminCookie, 'corse', 'bonifacio', 'On y était le lendemain');
  await post(familleCookie, 'vacances', 'plage', 'Éclairci à 30 % seulement');
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('pagination de la file de modération', () => {
  it('ne recouvre ni ne saute une ligne entre deux pages consécutives', async () => {
    const premiere = await file({ limit: 4 });
    assert.equal(premiere.comments.length, 4);
    assert.ok(premiere.nextCursor, 'la première page annonce la fin alors qu’il reste des lignes');

    const seconde = await file({ limit: 4, cursor: premiere.nextCursor });

    const ids = [...premiere.comments, ...seconde.comments].map((comment) => comment.id);
    assert.equal(new Set(ids).size, ids.length, 'un commentaire apparaît sur les deux pages');
    assert.equal(ids.length, premiere.total, 'des commentaires manquent entre les deux pages');
    // Antéchronologique d'un bout à l'autre, curseur compris.
    assert.deepEqual(
      ids,
      [...ids].sort((a, b) => b - a),
    );
  });

  it('annonce la taille du corpus, pas celle du reste à parcourir', async () => {
    const entiere = await file({ limit: 100 });
    const premiere = await file({ limit: 2 });
    const suivante = await file({ limit: 2, cursor: premiere.nextCursor! });

    // Le total ignore le curseur : sinon « 3 sur 6 » deviendrait « 3 sur 4 » en
    // tournant la page, et le compte afficherait n'importe quoi.
    assert.equal(premiere.total, entiere.total);
    assert.equal(suivante.total, entiere.total);
  });

  it('rend un curseur nul sur la dernière page', async () => {
    const entiere = await file({ limit: 100 });
    assert.equal(entiere.nextCursor, null);
  });
});

describe('filtres de la file de modération', () => {
  it('partitionne : visibles et masqués font le total', async () => {
    const cible = (await file({ limit: 1 })).comments[0]!;
    await moderate(cible.id, 'hide');

    const tous = await file({ limit: 100 });
    const visibles = await file({ limit: 100, filter: 'visible' });
    const masques = await file({ limit: 100, filter: 'hidden' });

    assert.equal(visibles.total + masques.total, tous.total);
    assert.ok(masques.comments.every((comment) => comment.hiddenAt !== null));
    assert.ok(visibles.comments.every((comment) => comment.hiddenAt === null));

    await moderate(cible.id, 'show');
  });

  it('restreint à un album sans emporter les autres', async () => {
    const corse = await file({ limit: 100, albumId: 'corse' });

    assert.equal(corse.total, 2);
    assert.ok(corse.comments.every((comment) => comment.albumId === 'corse'));
  });

  it('refuse un album au format impossible plutôt que de l’ignorer', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/admin/comments?albumId=..%2Fetc',
      headers: { cookie: adminCookie },
    });
    assert.equal(response.statusCode, 400);
  });
});

describe('recherche dans la file de modération', () => {
  it('cherche dans le corps, le nom déclaré et l’adresse', async () => {
    const corps = await file({ limit: 100, q: 'phare' });
    assert.equal(corps.total, 1);
    assert.match(corps.comments[0]!.body, /phare/i);

    const nom = await file({ limit: 100, q: 'Mamie' });
    assert.ok(nom.total > 0);
    assert.ok(nom.comments.every((comment) => comment.author.displayName === 'Mamie'));

    const adresse = await file({ limit: 100, q: 'chef@exemple.fr' });
    assert.ok(adresse.total > 0);
    assert.ok(adresse.comments.every((comment) => comment.authorEmail === 'chef@exemple.fr'));
  });

  it('cherche un pourcent quand on tape un pourcent', async () => {
    const tous = await file({ limit: 100 });
    const pourcent = await file({ limit: 100, q: '%' });

    // Sans `ESCAPE`, `%` est le joker de LIKE et ramènerait tout le corpus.
    assert.notEqual(pourcent.total, tous.total);
    assert.equal(pourcent.total, 1);
    assert.match(pourcent.comments[0]!.body, /%/);
  });

  it('le souligné ne remplace pas n’importe quel caractère', async () => {
    // `_` est l'autre joker de LIKE : « l_ » ramènerait « la », « le », « lu ».
    const souligne = await file({ limit: 100, q: 'l_' });
    assert.equal(souligne.total, 0);
  });

  it('compte ce qu’elle rend', async () => {
    const trouve = await file({ limit: 100, q: 'Bonifacio' });
    assert.equal(trouve.total, trouve.comments.length);
  });
});

describe('modération groupée par identité', () => {
  it('ne touche que les messages de l’identité visée, et reste réversible', async () => {
    const mamie = identites.get('mamie@exemple.fr')!;
    const avant = await file({ limit: 100 });
    const siens = avant.comments.filter((comment) => comment.commenterId === mamie);

    const masquage = await server.inject({
      method: 'POST',
      url: `/api/admin/commenters/${mamie}/hide`,
      headers: { cookie: adminCookie },
    });
    assert.equal(masquage.statusCode, 200, masquage.body);
    assert.equal(masquage.json<{ affected: number }>().affected, siens.length);

    const apres = await file({ limit: 100 });
    for (const comment of apres.comments) {
      assert.equal(
        comment.hiddenAt !== null,
        comment.commenterId === mamie,
        `le message ${comment.id} n’a pas suivi son identité`,
      );
    }

    const retour = await server.inject({
      method: 'POST',
      url: `/api/admin/commenters/${mamie}/show`,
      headers: { cookie: adminCookie },
    });
    assert.equal(retour.json<{ affected: number }>().affected, siens.length);
    const retabli = await file({ limit: 100, filter: 'hidden' });
    assert.equal(retabli.total, 0);
  });

  it('ne réécrit pas la date d’un message déjà masqué', async () => {
    const chef = identites.get('chef@exemple.fr')!;
    const sien = (await file({ limit: 100 })).comments.find(
      (comment) => comment.commenterId === chef,
    )!;

    await moderate(sien.id, 'hide');
    const date = (await file({ limit: 100, filter: 'hidden' })).comments.find(
      (comment) => comment.id === sien.id,
    )!.hiddenAt;

    const groupe = await server.inject({
      method: 'POST',
      url: `/api/admin/commenters/${chef}/hide`,
      headers: { cookie: adminCookie },
    });
    // Le message déjà masqué ne compte pas : c'est la date de la décision
    // d'origine qui intéresse, pas celle du geste groupé.
    const touches = groupe.json<{ affected: number }>().affected;
    const inchange = (await file({ limit: 100, filter: 'hidden' })).comments.find(
      (comment) => comment.id === sien.id,
    )!;
    assert.equal(inchange.hiddenAt, date);
    assert.ok(touches >= 1, 'les autres messages de cette identité n’ont pas été masqués');

    await server.inject({
      method: 'POST',
      url: `/api/admin/commenters/${chef}/show`,
      headers: { cookie: adminCookie },
    });
  });

  it('répond 404 sur une identité inconnue, et non « 0 message touché »', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/admin/commenters/999999/hide',
      headers: { cookie: adminCookie },
    });
    assert.equal(response.statusCode, 404);
  });

  it('refuse l’action groupée à un visiteur, en 403 et non en 404', async () => {
    const mamie = identites.get('mamie@exemple.fr')!;
    const response = await server.inject({
      method: 'POST',
      url: `/api/admin/commenters/${mamie}/hide`,
      headers: { cookie: familleCookie },
    });
    // L'espace d'administration est la seule exception assumée au 404 (D12).
    assert.equal(response.statusCode, 403);
  });
});
