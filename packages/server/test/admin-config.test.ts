import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { AdminAlbum, AdminUser, AppSettings } from '@gdv/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Administration des comptes, des albums et des réglages depuis l'application.
 *
 * Les tests portent sur les garde-fous plutôt que sur la forme des payloads :
 * ce sont eux qui empêchent l'instance de devenir inadministrable, une session
 * de survivre à un retrait d'accès, ou un identifiant d'en écraser un autre.
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'gdv-admin-'));

let server: FastifyInstance;
let context: AppContext;
let hash: string;
let cookie: string;

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
    takenAt: '2026-06-01T12:00:00.000Z',
    takenAtFromExif: true,
    modifiedTime: '2026-06-01T12:00:00.000Z',
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

async function login(username: string, password = PASSWORD): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });
  assert.equal(response.statusCode, 200, `connexion de ${username} refusée`);
  const entry = response.cookies.find((c) => c.name === 'gdv_session');
  assert.ok(entry, 'cookie de session absent');
  return `gdv_session=${entry.value}`;
}

/** Remet la configuration à un état connu avant chaque test. */
function reset(): void {
  for (const user of context.config.users()) context.config.deleteUser(user.username);
  for (const album of context.albums) context.config.deleteAlbum(album.id);
  context.db.prepare('DELETE FROM media').run();
  context.db.prepare('DELETE FROM sync_state').run();
  context.db.prepare('DELETE FROM sessions').run();
  context.config.updateSettings({
    syncIntervalMinutes: 30,
    syncOnStartup: true,
    cacheMaxSizeGB: 20,
  });

  context.config.createUser({ username: 'patron', passwordHash: hash, admin: true, albums: ['*'] });
}

before(async () => {
  hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

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
});

beforeEach(async () => {
  reset();
  cookie = await login('patron');
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

async function post(url: string, payload: unknown): ReturnType<typeof server.inject> {
  return server.inject({ method: 'POST', url, headers: { cookie }, payload: payload as object });
}

async function patch(url: string, payload: unknown): ReturnType<typeof server.inject> {
  return server.inject({ method: 'PATCH', url, headers: { cookie }, payload: payload as object });
}

describe('comptes', () => {
  it('crée un compte et ne renvoie jamais son empreinte', async () => {
    const response = await post('/api/admin/users', {
      username: 'Famille',
      password: 'un-mot-de-passe',
      albums: [],
    });

    assert.equal(response.statusCode, 201);
    const user = response.json() as AdminUser;
    assert.equal(user.username, 'Famille');
    assert.equal(user.admin, false);
    assert.deepEqual(user.albums, []);
    assert.ok(user.createdAt);
    // Aucune empreinte ne doit fuiter, sous aucune clé.
    assert.doesNotMatch(response.body, /\$argon2/);

    const listing = await server.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie },
    });
    assert.doesNotMatch(listing.body, /\$argon2/);
    assert.deepEqual((listing.json() as AdminUser[]).map((entry) => entry.username).sort(), [
      'Famille',
      'patron',
    ]);
  });

  it('refuse un identifiant déjà pris, casse comprise', async () => {
    await post('/api/admin/users', { username: 'famille', password: 'un-mot-de-passe' });
    const again = await post('/api/admin/users', { username: 'FAMILLE', password: 'autre-secret' });

    assert.equal(again.statusCode, 409);
    assert.equal((again.json() as { error: string }).error, 'conflict');
    // Le mot de passe d'origine n'a pas été écrasé au passage.
    await login('famille', 'un-mot-de-passe');
  });

  it('refuse un mot de passe trop court et un identifiant mal formé', async () => {
    assert.equal(
      (await post('/api/admin/users', { username: 'court', password: 'abc' })).statusCode,
      400,
    );
    assert.equal(
      (await post('/api/admin/users', { username: 'espace interdit', password: 'un-mot-de-passe' }))
        .statusCode,
      400,
    );
  });

  it('refuse un album inexistant plutôt que de créer un accès muet', async () => {
    const response = await post('/api/admin/users', {
      username: 'famille',
      password: 'un-mot-de-passe',
      albums: ['fantome'],
    });
    assert.equal(response.statusCode, 400);
    assert.equal((response.json() as { error: string }).error, 'unknown_album');
  });

  it('renvoie 404 sur un compte inconnu', async () => {
    assert.equal((await patch('/api/admin/users/fantome', { admin: true })).statusCode, 404);
    const removed = await server.inject({
      method: 'DELETE',
      url: '/api/admin/users/fantome',
      headers: { cookie },
    });
    assert.equal(removed.statusCode, 404);
  });
});

describe('dernier administrateur', () => {
  it('refuse de le supprimer', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: '/api/admin/users/patron',
      headers: { cookie },
    });

    assert.equal(response.statusCode, 409);
    assert.equal((response.json() as { error: string }).error, 'last_admin');
    assert.ok(context.config.user('patron'));
  });

  it('refuse de lui retirer son rôle', async () => {
    const response = await patch('/api/admin/users/patron', { admin: false });
    assert.equal(response.statusCode, 409);
    assert.equal(context.config.user('patron')!.admin, true);
  });

  it('laisse faire dès qu’un second administrateur existe', async () => {
    assert.equal(
      (
        await post('/api/admin/users', {
          username: 'second',
          password: 'un-mot-de-passe',
          admin: true,
        })
      ).statusCode,
      201,
    );

    assert.equal((await patch('/api/admin/users/patron', { admin: false })).statusCode, 200);
    assert.equal(context.config.user('patron')!.admin, false);
    assert.equal(context.config.adminCount(), 1);
  });
});

describe('sessions', () => {
  it('ferme les sessions du compte supprimé', async () => {
    await post('/api/admin/users', { username: 'famille', password: 'un-mot-de-passe' });
    const victim = await login('famille', 'un-mot-de-passe');

    assert.equal(
      (await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: victim } }))
        .statusCode,
      200,
    );

    const removed = await server.inject({
      method: 'DELETE',
      url: '/api/admin/users/famille',
      headers: { cookie },
    });
    assert.equal(removed.statusCode, 200);

    assert.equal(
      (await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: victim } }))
        .statusCode,
      401,
    );
  });

  it('ferme les sessions au changement de mot de passe', async () => {
    await post('/api/admin/users', { username: 'famille', password: 'un-mot-de-passe' });
    const victim = await login('famille', 'un-mot-de-passe');

    assert.equal(
      (await patch('/api/admin/users/famille', { password: 'nouveau-secret' })).statusCode,
      200,
    );

    assert.equal(
      (await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: victim } }))
        .statusCode,
      401,
      'la session ouverte avec l’ancien mot de passe doit tomber',
    );
    await login('famille', 'nouveau-secret');
  });

  it('ne déconnecte pas un compte à qui l’on retire le rôle d’administrateur', async () => {
    await post('/api/admin/users', {
      username: 'second',
      password: 'un-mot-de-passe',
      admin: true,
    });
    const other = await login('second', 'un-mot-de-passe');

    assert.equal((await patch('/api/admin/users/second', { admin: false })).statusCode, 200);

    // La session survit — le compte reste légitime…
    const me = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: other },
    });
    assert.equal(me.statusCode, 200);
    assert.equal((me.json() as { admin: boolean }).admin, false);

    // … mais l'administration lui est refusée dès la requête suivante.
    const forbidden = await server.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie: other },
    });
    assert.equal(forbidden.statusCode, 403);
  });
});

describe('albums', () => {
  it('crée un album et refuse un id déjà pris', async () => {
    const created = await post('/api/admin/albums', {
      id: 'vacances',
      title: 'Vacances',
      folderId: 'folder-vacances',
    });
    assert.equal(created.statusCode, 201);
    const album = created.json() as AdminAlbum;
    assert.equal(album.recursive, true);
    assert.equal(album.itemCount, 0);
    assert.equal(album.syncStatus, 'never');

    const again = await post('/api/admin/albums', {
      id: 'vacances',
      title: 'Autre titre',
      folderId: 'autre-dossier',
    });
    assert.equal(again.statusCode, 409);
    // L'album d'origine n'a pas été écrasé.
    assert.equal(context.findAlbum('vacances')!.title, 'Vacances');
  });

  it('liste les comptes ayant explicitement accès', async () => {
    await post('/api/admin/albums', {
      id: 'vacances',
      title: 'Vacances',
      folderId: 'folder-vacances',
    });
    await post('/api/admin/users', {
      username: 'famille',
      password: 'un-mot-de-passe',
      albums: ['vacances'],
    });

    const albums = (
      await server.inject({ method: 'GET', url: '/api/admin/albums', headers: { cookie } })
    ).json() as AdminAlbum[];
    // `patron` a le joker : il n'apparaît pas dans les membres explicites.
    assert.deepEqual(albums[0]!.members, ['famille']);
  });

  it('vide l’index quand le dossier Drive change', async () => {
    await post('/api/admin/albums', {
      id: 'vacances',
      title: 'Vacances',
      folderId: 'folder-vacances',
    });
    context.media.upsertMany([media('vacances', 'photo-1')], '2026-07-01T00:00:00.000Z');
    context.syncState.set('vacances', {
      lastSyncAt: '2026-07-01T00:00:00.000Z',
      status: 'ok',
      error: null,
    });

    const renamed = await patch('/api/admin/albums/vacances', { title: 'Vacances 2026' });
    assert.equal(renamed.statusCode, 200);
    // Un simple renommage ne touche pas à l'index.
    assert.equal(context.media.stats('vacances').itemCount, 1);

    const moved = await patch('/api/admin/albums/vacances', { folderId: 'autre-dossier' });
    assert.equal(moved.statusCode, 200);
    assert.equal(
      context.media.stats('vacances').itemCount,
      0,
      'les médias de l’ancien dossier ne doivent plus être servis',
    );
    assert.equal(context.syncState.get('vacances').status, 'never');
  });

  it('retire les médias de l’album supprimé, et eux seuls', async () => {
    for (const id of ['vacances', 'prive']) {
      await post('/api/admin/albums', { id, title: id, folderId: `folder-${id}` });
    }
    // Même fichier Drive dans deux albums (dossiers imbriqués) : deux lignes.
    context.media.upsertMany(
      [media('vacances', 'partagee'), media('prive', 'partagee'), media('prive', 'privee')],
      '2026-07-01T00:00:00.000Z',
    );

    const removed = await server.inject({
      method: 'DELETE',
      url: '/api/admin/albums/vacances',
      headers: { cookie },
    });
    assert.equal(removed.statusCode, 200);

    assert.equal(context.findAlbum('vacances'), undefined);
    assert.equal(context.media.stats('vacances').itemCount, 0);
    assert.deepEqual(context.media.albumsContaining('partagee'), ['prive']);
    assert.equal(context.media.stats('prive').itemCount, 2);
  });

  it('renvoie 404 sur un album inconnu', async () => {
    assert.equal((await patch('/api/admin/albums/fantome', { title: 'X' })).statusCode, 404);
    const removed = await server.inject({
      method: 'DELETE',
      url: '/api/admin/albums/fantome',
      headers: { cookie },
    });
    assert.equal(removed.statusCode, 404);
  });
});

describe('cloisonnement après modification des droits', () => {
  it('suit immédiatement l’attribution puis le retrait d’un album', async () => {
    await post('/api/admin/albums', {
      id: 'vacances',
      title: 'Vacances',
      folderId: 'folder-vacances',
    });
    await post('/api/admin/albums', { id: 'prive', title: 'Privé', folderId: 'folder-prive' });
    context.media.upsertMany(
      [media('vacances', 'photo-publique'), media('prive', 'photo-privee')],
      '2026-07-01T00:00:00.000Z',
    );

    await post('/api/admin/users', {
      username: 'famille',
      password: 'un-mot-de-passe',
      albums: ['vacances'],
    });
    const visitor = await login('famille', 'un-mot-de-passe');

    const seen = async (albumId: string): Promise<number> =>
      (
        await server.inject({
          method: 'GET',
          url: `/api/albums/${albumId}`,
          headers: { cookie: visitor },
        })
      ).statusCode;
    const mediaSeen = async (mediaId: string): Promise<number> =>
      (
        await server.inject({
          method: 'GET',
          url: `/api/media/${mediaId}/thumb?s=320`,
          headers: { cookie: visitor },
        })
      ).statusCode;

    assert.equal(await seen('vacances'), 200);
    assert.equal(await seen('prive'), 404);
    assert.equal(await mediaSeen('photo-privee'), 404);

    // Droits élargis : l'album privé devient visible sans reconnexion.
    assert.equal(
      (await patch('/api/admin/users/famille', { albums: ['vacances', 'prive'] })).statusCode,
      200,
    );
    assert.equal(await seen('prive'), 200);

    // Droits repris : l'accès retombe au tir suivant, avec la même session.
    assert.equal((await patch('/api/admin/users/famille', { albums: [] })).statusCode, 200);
    assert.equal(await seen('vacances'), 404);
    assert.equal(await seen('prive'), 404);
    assert.equal(await mediaSeen('photo-privee'), 404);

    // Le joker donne tout, y compris un album créé après coup.
    assert.equal((await patch('/api/admin/users/famille', { albums: ['*'] })).statusCode, 200);
    await post('/api/admin/albums', { id: 'apres', title: 'Après', folderId: 'folder-apres' });
    assert.equal(await seen('apres'), 200);
  });
});

describe('réglages', () => {
  it('s’appliquent sans redémarrage', async () => {
    let notified: AppSettings | null = null;
    context.onSettingsChanged((settings) => {
      notified = settings;
    });

    const response = await patch('/api/admin/settings', {
      syncIntervalMinutes: 5,
      cacheMaxSizeGB: 2,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      syncIntervalMinutes: 5,
      syncOnStartup: true,
      cacheMaxSizeGB: 2,
    });

    // La limite du cache disque bouge tout de suite — le rechargement de
    // configuration d'avant ne la relisait qu'au démarrage.
    assert.equal(context.cache.stats().maxBytes, 2 * 1024 ** 3);
    // Et le minuteur de synchronisation de `main.ts` est prévenu.
    assert.equal((notified as AppSettings | null)?.syncIntervalMinutes, 5);

    const read = await server.inject({
      method: 'GET',
      url: '/api/admin/settings',
      headers: { cookie },
    });
    assert.deepEqual((read.json() as AppSettings).cacheMaxSizeGB, 2);
  });

  it('refuse une valeur hors bornes sans rien changer', async () => {
    assert.equal((await patch('/api/admin/settings', { cacheMaxSizeGB: 0 })).statusCode, 400);
    assert.equal((await patch('/api/admin/settings', { syncIntervalMinutes: -1 })).statusCode, 400);
    assert.equal(context.settings.cacheMaxSizeGB, 20);
  });
});

describe('accès aux routes d’administration', () => {
  it('exige une session administrateur', async () => {
    await post('/api/admin/users', { username: 'famille', password: 'un-mot-de-passe' });
    const visitor = await login('famille', 'un-mot-de-passe');

    for (const url of ['/api/admin/users', '/api/admin/albums', '/api/admin/settings']) {
      assert.equal((await server.inject({ method: 'GET', url })).statusCode, 401, url);
      assert.equal(
        (await server.inject({ method: 'GET', url, headers: { cookie: visitor } })).statusCode,
        403,
        url,
      );
    }
  });
});
