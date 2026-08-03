import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ALL_ALBUMS, type Comment, type CommentsPage, type MediaDetail } from '@gdv/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Commentaires : cloisonnement, profondeur, modération et droits de
 * suppression.
 *
 * Ces tests portent sur les invariants, pas sur la forme des payloads. Le
 * cloisonnement est le plus important : un fil appartient au couple (album,
 * média), et un album qu'on ne voit pas doit rester indistinguable d'un album
 * qui n'existe pas — y compris à travers les commentaires, qui sont un chemin
 * de lecture de plus vers le même contenu.
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'gdv-comments-'));

let server: FastifyInstance;
let context: AppContext;

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

/** Poste un commentaire et rend l'objet créé, en vérifiant le code de retour. */
async function post(
  cookie: string,
  albumId: string,
  mediaId: string,
  body: string,
  parentId: number | null = null,
): Promise<Comment> {
  const response = await server.inject({
    method: 'POST',
    url: `/api/comments/${albumId}/${mediaId}`,
    headers: { cookie },
    payload: { body, parentId },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<Comment>();
}

async function read(cookie: string, albumId: string, mediaId: string): Promise<CommentsPage> {
  const response = await server.inject({
    method: 'GET',
    url: `/api/comments/${albumId}/${mediaId}`,
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<CommentsPage>();
}

let adminCookie: string;
let familleCookie: string;

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
    displayName: 'Mamie',
  });

  // La même photo Drive indexée dans les deux albums : c'est le cas qui rend le
  // cloisonnement des fils nécessaire.
  context.media.upsertMany(
    [media('vacances', 'photo-partagee'), media('prive', 'photo-partagee')],
    '2025-01-01T00:00:00.000Z',
  );

  adminCookie = await login('alexis');
  familleCookie = await login('famille');
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('cloisonnement des fils', () => {
  it('sépare les conversations d’un même fichier indexé sous deux albums', async () => {
    await post(adminCookie, 'vacances', 'photo-partagee', 'Vu depuis les vacances');
    await post(adminCookie, 'prive', 'photo-partagee', 'Vu depuis le privé');

    const publique = await read(familleCookie, 'vacances', 'photo-partagee');
    assert.equal(publique.total, 1);
    assert.equal(publique.threads[0]!.root.body, 'Vu depuis les vacances');
  });

  it('répond 404 sur le fil d’un album non attribué, comme pour un album inexistant', async () => {
    const interdit = await server.inject({
      method: 'GET',
      url: '/api/comments/prive/photo-partagee',
      headers: { cookie: familleCookie },
    });
    const inexistant = await server.inject({
      method: 'GET',
      url: '/api/comments/inconnu/photo-partagee',
      headers: { cookie: familleCookie },
    });

    assert.equal(interdit.statusCode, 404);
    assert.equal(inexistant.statusCode, 404);
    // Indistinguables : c'est tout l'intérêt du 404 (D12).
    assert.deepEqual(interdit.json(), inexistant.json());
  });

  it('refuse de rattacher une réponse à un fil d’un autre album', async () => {
    const ailleurs = await post(adminCookie, 'prive', 'photo-partagee', 'Racine privée');

    const response = await server.inject({
      method: 'POST',
      url: '/api/comments/vacances/photo-partagee',
      headers: { cookie: familleCookie },
      payload: { body: 'Greffe interdite', parentId: ailleurs.id },
    });

    assert.equal(response.statusCode, 404);
  });

  it('refuse un commentaire anonyme', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/comments/vacances/photo-partagee',
      payload: { body: 'Bonjour' },
    });
    assert.equal(response.statusCode, 401);
  });
});

describe('profondeur limitée à un niveau', () => {
  it('rattache la réponse d’une réponse à la racine du fil', async () => {
    const racine = await post(adminCookie, 'vacances', 'photo-partagee', 'Racine');
    const reponse = await post(familleCookie, 'vacances', 'photo-partagee', 'Réponse', racine.id);
    // On répond à la réponse : le serveur doit remonter à la racine plutôt que
    // de créer un second niveau.
    const petiteFille = await post(
      adminCookie,
      'vacances',
      'photo-partagee',
      'Réponse à la réponse',
      reponse.id,
    );

    assert.equal(reponse.parentId, racine.id);
    assert.equal(petiteFille.parentId, racine.id, 'un second niveau a été créé');

    const page = await read(adminCookie, 'vacances', 'photo-partagee');
    const thread = page.threads.find((entry) => entry.root.id === racine.id);
    assert.ok(thread);
    assert.equal(thread.replies.length, 2);
    assert.ok(thread.replies.every((reply) => reply.parentId === racine.id));
  });
});

describe('identité de l’auteur', () => {
  it('signe du nom affiché quand il est renseigné, de l’identifiant sinon', async () => {
    const parMamie = await post(familleCookie, 'vacances', 'photo-partagee', 'Signé');
    const parAdmin = await post(adminCookie, 'vacances', 'photo-partagee', 'Signé aussi');

    assert.equal(parMamie.author.displayName, 'Mamie');
    assert.equal(parMamie.author.username, 'famille');
    assert.equal(parAdmin.author.displayName, 'alexis');
  });
});

describe('suppression', () => {
  it('laisse l’auteur supprimer son commentaire', async () => {
    const mien = await post(familleCookie, 'vacances', 'photo-partagee', 'À supprimer');

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/comments/${mien.id}`,
      headers: { cookie: familleCookie },
    });

    assert.equal(response.statusCode, 204);
    assert.equal(mien.canDelete, true);
  });

  it('refuse en 404 la suppression du commentaire d’un autre', async () => {
    const autrui = await post(adminCookie, 'vacances', 'photo-partagee', 'Pas touche');

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/comments/${autrui.id}`,
      headers: { cookie: familleCookie },
    });

    assert.equal(response.statusCode, 404);
    const page = await read(adminCookie, 'vacances', 'photo-partagee');
    assert.ok(page.threads.some((thread) => thread.root.id === autrui.id));
  });

  it('laisse un administrateur supprimer n’importe quel commentaire', async () => {
    const dUnAutre = await post(familleCookie, 'vacances', 'photo-partagee', 'Supprimé par admin');

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/comments/${dUnAutre.id}`,
      headers: { cookie: adminCookie },
    });

    assert.equal(response.statusCode, 204);
  });
});

describe('modération', () => {
  it('retire un commentaire masqué de la lecture, y compris pour son auteur', async () => {
    const gênant = await post(familleCookie, 'vacances', 'photo-partagee', 'À modérer');

    const masquage = await server.inject({
      method: 'POST',
      url: `/api/admin/comments/${gênant.id}/hide`,
      headers: { cookie: adminCookie },
    });
    assert.equal(masquage.statusCode, 200);

    const vuParAuteur = await read(familleCookie, 'vacances', 'photo-partagee');
    assert.ok(
      !vuParAuteur.threads.some((thread) => thread.root.id === gênant.id),
      'un commentaire masqué reste visible pour son auteur',
    );

    // Rendu visible, il revient — masquer est réversible, c'est ce qui distingue
    // la modération de la suppression.
    await server.inject({
      method: 'POST',
      url: `/api/admin/comments/${gênant.id}/show`,
      headers: { cookie: adminCookie },
    });
    const revenu = await read(familleCookie, 'vacances', 'photo-partagee');
    assert.ok(revenu.threads.some((thread) => thread.root.id === gênant.id));
  });

  it('refuse la modération à un visiteur, en 403 et non en 404', async () => {
    const cible = await post(familleCookie, 'vacances', 'photo-partagee', 'Tentative');

    const response = await server.inject({
      method: 'POST',
      url: `/api/admin/comments/${cible.id}/hide`,
      headers: { cookie: familleCookie },
    });

    // L'espace d'administration est la seule exception assumée au 404 (D12).
    assert.equal(response.statusCode, 403);
  });

  it('remonte une réponse en tête de fil quand sa racine est masquée', async () => {
    const racine = await post(adminCookie, 'vacances', 'photo-partagee', 'Racine à masquer');
    const reponse = await post(familleCookie, 'vacances', 'photo-partagee', 'Orpheline', racine.id);

    await server.inject({
      method: 'POST',
      url: `/api/admin/comments/${racine.id}/hide`,
      headers: { cookie: adminCookie },
    });

    const page = await read(familleCookie, 'vacances', 'photo-partagee');
    const promue = page.threads.find((thread) => thread.root.id === reponse.id);
    assert.ok(promue, 'la réponse a disparu avec sa racine');
    // Elle est devenue une racine : son parent ne doit plus être annoncé.
    assert.equal(promue.root.parentId, null);
  });
});

describe('compteur servi avec le détail du média', () => {
  it('compte les commentaires visibles, réponses comprises, masqués exclus', async () => {
    const detail = await server.inject({
      method: 'GET',
      url: '/api/albums/vacances/items/photo-partagee',
      headers: { cookie: familleCookie },
    });
    assert.equal(detail.statusCode, 200);

    const page = await read(familleCookie, 'vacances', 'photo-partagee');
    assert.equal(detail.json<MediaDetail>().commentCount, page.total);
  });
});
