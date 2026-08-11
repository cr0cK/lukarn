import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { ItemsPage, MediaDetail, MediaItem } from '@nonni/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Description d'une photo, vue de l'API.
 *
 * Quatre invariants, et ce sont ceux qui coûteraient cher à casser : le texte
 * est **cloisonné par album**, il **survit à une désindexation** (une photo
 * quitte l'index sur un simple contretemps Drive, un texte écrit à la main ne se
 * régénère pas), la **jointure ne dérange pas la pagination**, et l'écriture
 * reste sous `/api/admin`, seul préfixe qui réponde 403 (D50, D83).
 */

const PASSWORD = 'mot-de-passe-de-test';
const root = mkdtempSync(join(tmpdir(), 'nonni-notes-'));

let server: FastifyInstance;
let context: AppContext;
let hash: string;
let adminCookie: string;
let visitorCookie: string;

function photo(albumId: string, id: string, takenAt: string): MediaUpsert {
  return {
    albumId,
    id,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    size: 1234,
    width: 3000,
    height: 2000,
    takenAt,
    takenAtFromExif: true,
    modifiedTime: takenAt,
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
  return `nonni_session=${response.cookies.find((c) => c.name === 'nonni_session')!.value}`;
}

function get(url: string, cookie: string): ReturnType<typeof server.inject> {
  return server.inject({ method: 'GET', url, headers: { cookie } });
}

function patch(url: string, cookie: string, payload: unknown): ReturnType<typeof server.inject> {
  return server.inject({ method: 'PATCH', url, headers: { cookie }, payload: payload as object });
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
  for (const user of context.config.users()) context.config.deleteUser(user.username);
  for (const album of context.albums) context.config.deleteAlbum(album.id);
  context.media.pruneAlbums([]);
  context.db.prepare('DELETE FROM sessions').run();

  context.config.createAlbum({ id: 'corse', title: 'Corse', folderId: 'f1', recursive: true });
  context.config.createAlbum({ id: 'prive', title: 'Privé', folderId: 'f1', recursive: true });
  context.config.createUser({ username: 'patron', passwordHash: hash, admin: true, albums: ['*'] });
  context.config.createUser({
    username: 'famille',
    passwordHash: hash,
    admin: false,
    albums: ['corse'],
  });

  adminCookie = await login('patron');
  visitorCookie = await login('famille');
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('description de photo — cloisonnement', () => {
  it('le même fichier indexé sous deux albums porte deux textes', () => {
    // Le dossier imbriqué est le cas courant : un fichier légitimement présent
    // dans deux albums. Confondre les deux textes montrerait à un visiteur ce
    // qui a été écrit dans un album qu'il ne peut pas ouvrir (D12).
    const takenAt = '2026-07-14T10:00:00.000Z';
    context.media.upsertMany(
      [photo('corse', 'partagee', takenAt), photo('prive', 'partagee', takenAt)],
      takenAt,
    );

    context.media.setDescription('corse', 'partagee', { description: 'Léa saute du ponton' });
    context.media.setDescription('prive', 'partagee', { description: 'À ne pas montrer' });

    assert.equal(context.media.getDetail('corse', 'partagee')?.description, 'Léa saute du ponton');
    assert.equal(context.media.getDetail('prive', 'partagee')?.description, 'À ne pas montrer');
  });

  it('la description voyage avec l’item et avec le détail', async () => {
    const takenAt = '2026-07-14T10:00:00.000Z';
    context.media.upsertMany([photo('corse', 'p1', takenAt)], takenAt);
    context.media.setDescription('corse', 'p1', { description: 'Léa saute du ponton' });

    const page = (await get('/api/albums/corse/items', visitorCookie)).json() as ItemsPage;
    assert.equal(page.items[0]?.description, 'Léa saute du ponton');

    const detail = (await get('/api/albums/corse/items/p1', visitorCookie)).json() as MediaDetail;
    assert.equal(detail.description, 'Léa saute du ponton');
  });
});

describe('description de photo — survie à la désindexation', () => {
  it('survit à deleteStale, et revient avec la photo réindexée', () => {
    // Corbeille Drive le temps d'un retour en arrière, dossier renommé, sync
    // interrompue : la photo quitte l'index sans que personne n'ait décidé de
    // perdre ce qui était écrit dessus. L'identifiant Drive étant stable, elle
    // doit retrouver son texte (D83).
    context.media.upsertMany([photo('corse', 'p1', '2026-07-14T10:00:00.000Z')], 'passage-1');
    context.media.setDescription('corse', 'p1', { description: 'Léa saute du ponton' });

    assert.equal(context.media.deleteStale('corse', 'passage-2'), 1);
    assert.equal(context.media.getDetail('corse', 'p1'), null);
    assert.equal(
      (
        context.db
          .prepare('SELECT COUNT(*) AS n FROM media_notes WHERE album_id = ?')
          .get('corse') as { n: number }
      ).n,
      1,
      'la description ne part pas avec la photo',
    );

    context.media.upsertMany([photo('corse', 'p1', '2026-07-14T10:00:00.000Z')], 'passage-3');
    assert.equal(context.media.getDetail('corse', 'p1')?.description, 'Léa saute du ponton');
  });

  it('part avec l’album, seul ménage prévu', () => {
    context.media.upsertMany([photo('corse', 'p1', '2026-07-14T10:00:00.000Z')], 'passage-1');
    context.media.setDescription('corse', 'p1', { description: 'Léa saute du ponton' });

    context.config.deleteAlbum('corse');

    // La cascade sur `albums` : c'est elle, et elle seule, qui nettoie.
    assert.equal(
      (context.db.prepare('SELECT COUNT(*) AS n FROM media_notes').get() as { n: number }).n,
      0,
    );
  });
});

describe('description de photo — pagination', () => {
  it('la jointure ne duplique ni ne perd de ligne', async () => {
    const items = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id, index) =>
      photo('corse', id, `2026-07-1${index}T10:00:00.000Z`),
    );
    context.media.upsertMany(items, 'passage-1');
    // Deux photos décrites sur cinq : la jointure rend donc des lignes des deux
    // sortes dans la même page.
    context.media.setDescription('corse', 'p2', { description: 'Décrite' });
    context.media.setDescription('corse', 'p4', { description: 'Décrite aussi' });

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url = `/api/albums/corse/items?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = (await get(url, visitorCookie)).json() as ItemsPage;
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);

    assert.deepEqual(seen, ['p1', 'p2', 'p3', 'p4', 'p5']);
    assert.equal(new Set(seen).size, seen.length, 'aucun doublon');
  });
});

describe('PATCH /api/admin/albums/:id/items/:mediaId', () => {
  const url = '/api/admin/albums/corse/items/p1';

  beforeEach(() => {
    context.media.upsertMany([photo('corse', 'p1', '2026-07-14T10:00:00.000Z')], 'passage-1');
  });

  it('refuse un visiteur avec 403, et un anonyme avec 401', async () => {
    // 403 ici et nulle part ailleurs : c'est la contrepartie de la saisie
    // depuis la galerie, et cette route ne déplace pas l'invariant (D50).
    assert.equal((await patch(url, visitorCookie, { description: 'Non' })).statusCode, 403);
    assert.equal(
      (await server.inject({ method: 'PATCH', url, payload: { description: 'Non' } })).statusCode,
      401,
    );
    assert.equal(context.media.getDetail('corse', 'p1')?.description, null);
  });

  it('écrit, relit, et rend l’item à jour', async () => {
    const saved = await patch(url, adminCookie, { description: 'Léa saute du ponton' });
    assert.equal(saved.statusCode, 200);
    assert.equal((saved.json() as MediaItem).id, 'p1');
    assert.equal((saved.json() as MediaItem).description, 'Léa saute du ponton');

    const relu = await patch(url, adminCookie, { description: 'Troisième essai' });
    assert.equal((relu.json() as MediaItem).description, 'Troisième essai');
  });

  it('efface avec null comme avec une chaîne vide', async () => {
    await patch(url, adminCookie, { description: 'Une légende' });
    assert.equal((await patch(url, adminCookie, { description: null })).statusCode, 200);
    assert.equal(context.media.getDetail('corse', 'p1')?.description, null);

    await patch(url, adminCookie, { description: 'Une légende' });
    // La chaîne vide est ce qu'envoie un champ qu'on vient de vider : la
    // refuser obligerait le front à traduire « vide » en `null`.
    assert.equal((await patch(url, adminCookie, { description: '   ' })).statusCode, 200);
    assert.equal(context.media.getDetail('corse', 'p1')?.description, null);
    assert.equal(
      (context.db.prepare('SELECT COUNT(*) AS n FROM media_notes').get() as { n: number }).n,
      0,
      'une ligne vide ne dit rien de plus qu’une ligne absente',
    );
  });

  it('laisse le texte en place quand le champ est absent', async () => {
    await patch(url, adminCookie, { description: 'Une légende' });
    const inchange = await patch(url, adminCookie, {});
    assert.equal((inchange.json() as MediaItem).description, 'Une légende');
  });

  it('refuse au-delà de mille caractères', async () => {
    assert.equal(
      (await patch(url, adminCookie, { description: 'x'.repeat(1001) })).statusCode,
      400,
    );
    assert.equal(
      (await patch(url, adminCookie, { description: 'x'.repeat(1000) })).statusCode,
      200,
    );
  });

  it('répond 404 sur un album inconnu et sur un média non indexé', async () => {
    assert.equal(
      (await patch('/api/admin/albums/fantome/items/p1', adminCookie, { description: 'X' }))
        .statusCode,
      404,
    );
    // Non indexé dans **cet** album : le texte n'aurait jamais été affiché.
    assert.equal(
      (await patch('/api/admin/albums/prive/items/p1', adminCookie, { description: 'X' }))
        .statusCode,
      404,
    );
  });
});
