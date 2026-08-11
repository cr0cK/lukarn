import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { classifyDevice } from '../src/device.js';
import { loadEnv } from '../src/env.js';
import { encodeCursor, type MediaUpsert } from '../src/repo.js';

/**
 * Télémétrie de visite (D260809h).
 *
 * Trois idées gouvernent ce qui suit. Les compteurs sont **agrégés à
 * l'écriture** : rouvrir le même album le même jour depuis la même session
 * n'ajoute pas de ligne, elle incrémente la sienne. Un visiteur est une
 * **session**, pas une clé d'accès — une clé se partage, et deux navigateurs
 * derrière la même font bien deux visiteurs. Et rien de tout cela n'a de clé
 * étrangère : se déconnecter, ou supprimer un album, n'efface pas ce qui a été
 * regardé.
 */

const root = mkdtempSync(join(tmpdir(), 'nonni-visites-'));

const env = loadEnv({
  NODE_ENV: 'test',
  SESSION_SECRET: 's'.repeat(48),
  TOKEN_KEY: 't'.repeat(48),
  PUBLIC_URL: 'https://photos.exemple.fr',
  CONFIG_PATH: join(root, 'absent.yaml'),
  DATA_DIR: join(root, 'data'),
  CACHE_DIR: join(root, 'cache'),
  WEB_DIR: join(root, 'web'),
  LOG_LEVEL: 'fatal',
} as NodeJS.ProcessEnv);

const MOT_DE_PASSE = 'mot-de-passe-de-test';
const JOUR_MS = 24 * 60 * 60 * 1000;

/** Un webOS 4 : il annonce « Mobile » et « Safari » comme un téléphone. */
const UA_TELEVISEUR =
  'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/68.0.3440.106 Safari/537.36 WebAppManager';
const UA_TELEPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

let server: FastifyInstance;
let context: AppContext;

function photo(albumId: string, id: string): MediaUpsert {
  return {
    albumId,
    id,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    size: 1000,
    width: 400,
    height: 300,
    takenAt: '2026-07-01T10:00:00.000Z',
    takenAtFromExif: true,
    modifiedTime: '2026-07-01T10:00:00.000Z',
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
    md5: 'abcdef0123456789',
    hasThumbnail: true,
    videoCodec: null,
  };
}

/** Ouvre une session en annonçant l'appareil demandé, et rend son cookie. */
async function connexion(username: string, userAgent: string): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'user-agent': userAgent },
    payload: { username, password: MOT_DE_PASSE },
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = response.cookies.find((entry) => entry.name === 'nonni_session');
  assert.ok(cookie);
  return `nonni_session=${cookie.value}`;
}

before(async () => {
  const built = await buildApp(env);
  server = built.server;
  context = built.context;

  context.config.createAlbum({ id: 'corse', title: 'Corse', folderId: 'f1', recursive: true });
  context.config.createAlbum({ id: 'noel', title: 'Noël', folderId: 'f2', recursive: true });
  context.config.createUser({
    username: 'famille',
    passwordHash: await argon2.hash(MOT_DE_PASSE, { type: argon2.argon2id }),
    admin: false,
    albums: ['corse', 'noel'],
  });
  context.media.upsertMany(
    [photo('corse', 'img-1'), photo('corse', 'img-2'), photo('corse', 'img-3')],
    '2026-07-01T00:00:00.000Z',
  );
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('compteurs de visite', () => {
  beforeEach(() => {
    context.db.prepare('DELETE FROM album_visits').run();
  });

  it('n’écrit qu’une ligne quand la même session rouvre le même album le même jour', () => {
    context.visits.recordAlbumOpen('corse', 'famille', 'session-a');
    context.visits.recordAlbumOpen('corse', 'famille', 'session-a');

    const lignes = context.db.prepare('SELECT visits, photos FROM album_visits').all() as {
      visits: number;
      photos: number;
    }[];

    // C'est tout l'intérêt de l'agrégation à l'écriture : une ligne par
    // (album, clé, session, jour), jamais une par requête. Sans elle, la table
    // grossirait de dizaines de milliers de lignes par jour.
    assert.equal(lignes.length, 1);
    assert.equal(lignes[0]!.visits, 2);
    assert.equal(lignes[0]!.photos, 0);
  });

  it('compte deux visiteurs quand la même clé ouvre depuis deux navigateurs', () => {
    context.visits.recordAlbumOpen('corse', 'famille', 'session-a');
    context.visits.recordAlbumOpen('corse', 'famille', 'session-b');

    const apercu = context.visits.overview(7);
    // Une clé d'accès se partage (D38) : la compter pour un visiteur ferait
    // d'un foyer entier une seule personne. La session est la meilleure
    // approximation disponible.
    assert.equal(apercu.albums[0]!.visitors, 2);
    assert.equal(apercu.albums[0]!.keys, 1);
    assert.equal(apercu.visitors.length, 1);
    assert.equal(apercu.visitors[0]!.sessions, 2);
  });

  it('garde les visites d’une session détruite', () => {
    const session = context.sessions.create('famille');
    context.visits.recordAlbumOpen('corse', 'famille', session.id);

    context.sessions.destroy(session.id);

    // Une déconnexion efface la session, jamais l'historique de ce qui a été
    // regardé : `session_id` n'est ici qu'un seau pour compter des visiteurs
    // distincts, pas un lien. Une clé étrangère l'aurait emporté.
    const apercu = context.visits.overview(7);
    assert.equal(apercu.albums[0]!.visits, 1);
    assert.equal(apercu.albums[0]!.visitors, 1);
  });

  it('garde les visites d’un album supprimé, et le dit', () => {
    context.config.createAlbum({
      id: 'ephemere',
      title: 'Éphémère',
      folderId: 'f3',
      recursive: true,
    });
    context.visits.recordAlbumOpen('ephemere', 'famille', 'session-a');

    context.config.deleteAlbum('ephemere');

    const ligne = context.visits.overview(7).albums.find((a) => a.albumId === 'ephemere');
    assert.ok(ligne, 'la fréquentation passée reste vraie');
    assert.equal(ligne.visits, 1);
    // Le titre vient d'une jointure externe : il tombe à `null` plutôt que de
    // faire disparaître la ligne, et l'écran affiche l'identifiant.
    assert.equal(ligne.title, null);
  });

  it('ignore ce qui déborde de la fenêtre demandée', () => {
    const maintenant = new Date('2026-08-09T12:00:00.000Z');
    const vieux = new Date(maintenant.getTime() - 30 * JOUR_MS);

    context.visits.recordAlbumOpen('corse', 'famille', 'session-a', vieux);
    context.visits.recordAlbumOpen('noel', 'famille', 'session-a', maintenant);

    const semaine = context.visits.overview(7, maintenant);
    assert.deepEqual(
      semaine.albums.map((album) => album.albumId),
      ['noel'],
    );
    assert.equal(semaine.since, '2026-08-03');

    // La fenêtre large, elle, voit les deux : c'est la même table, seule la
    // borne change.
    const trimestre = context.visits.overview(90, maintenant);
    assert.equal(trimestre.albums.length, 2);
  });

  it('oublie les journées au-delà de la rétention', () => {
    const maintenant = new Date('2026-08-09T12:00:00.000Z');
    context.visits.recordAlbumOpen(
      'corse',
      'famille',
      'session-a',
      new Date(maintenant.getTime() - 401 * JOUR_MS),
    );
    context.visits.recordAlbumOpen(
      'noel',
      'famille',
      'session-a',
      new Date(maintenant.getTime() - 399 * JOUR_MS),
    );

    assert.equal(context.visits.purgeOld(400, maintenant), 1);
    // Quatre cents jours, et non trois cent soixante-cinq : c'est ce qui laisse
    // comparer un mois d'août à celui de l'année d'avant.
    assert.deepEqual(
      (context.db.prepare('SELECT album_id FROM album_visits').all() as { album_id: string }[]).map(
        (row) => row.album_id,
      ),
      ['noel'],
    );
  });
});

describe('classe d’appareil', () => {
  it('reconnaît un téléviseur avant d’y voir un téléphone', () => {
    // L'ordre des tests est tout le sujet : webOS annonce « Mobile » et
    // « Safari », et un test naïf classerait le salon comme un téléphone.
    assert.equal(classifyDevice(UA_TELEVISEUR), 'tv');
    assert.equal(classifyDevice(UA_TELEPHONE), 'mobile');
  });

  it('ne prend pas une tablette Android pour un téléphone', () => {
    // Chrome n'écrit « Mobile » que sur un téléphone : c'est son absence qui
    // distingue les deux, rien d'autre dans l'en-tête ne le dit.
    const tablette =
      'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/120.0.0.0 Safari/537.36';
    assert.equal(classifyDevice(tablette), 'tablette');
    assert.equal(classifyDevice(`${tablette.replace('Safari', 'Mobile Safari')}`), 'mobile');
  });

  it('n’invente aucune classe sans en-tête', () => {
    // Une valeur par défaut serait indiscernable d'une mesure.
    assert.equal(classifyDevice(undefined), null);
    assert.equal(classifyDevice(''), null);
  });
});

describe('par l’API', () => {
  beforeEach(() => {
    context.db.prepare('DELETE FROM album_visits').run();
    context.db.prepare('DELETE FROM sessions').run();
  });

  async function ouvrir(url: string, cookie: string): Promise<void> {
    const response = await server.inject({ method: 'GET', url, headers: { cookie } });
    assert.equal(response.statusCode, 200, response.body);
  }

  it('compte une visite et trois photos pour une visite ordinaire', async () => {
    const cookie = await connexion('famille', UA_TELEPHONE);

    await ouvrir('/api/albums/corse/items', cookie);
    for (const id of ['img-1', 'img-2', 'img-3']) {
      await ouvrir(`/api/albums/corse/items/${id}`, cookie);
    }

    const apercu = context.visits.overview(7);
    assert.equal(apercu.albums.length, 1);
    assert.equal(apercu.albums[0]!.visits, 1);
    assert.equal(apercu.albums[0]!.photos, 3);
    assert.deepEqual(apercu.visitors[0]!.devices, ['mobile']);
  });

  it('ne compte pas une visite de plus en tournant les pages', async () => {
    const cookie = await connexion('famille', UA_TELEPHONE);
    await ouvrir('/api/albums/corse/items', cookie);

    const curseur = encodeCursor('2026-07-01T10:00:00.000Z', 'img-1');
    await ouvrir(`/api/albums/corse/items?cursor=${encodeURIComponent(curseur)}`, cookie);

    // Les pages suivantes sont le même geste que la première : les compter
    // ferait dire à la colonne le nombre de pages tournées.
    assert.equal(context.visits.overview(7).albums[0]!.visits, 1);
  });

  it('ne compte pas un média qui n’existe pas', async () => {
    const cookie = await connexion('famille', UA_TELEPHONE);
    const response = await server.inject({
      method: 'GET',
      url: '/api/albums/corse/items/inconnu',
      headers: { cookie },
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(context.visits.overview(7).albums, []);
  });

  it('retient la classe d’appareil et la dernière requête, jamais le user-agent', async () => {
    await connexion('famille', UA_TELEVISEUR);

    const session = context.db
      .prepare('SELECT device, last_seen_at FROM sessions WHERE username = ?')
      .get('famille') as { device: string; last_seen_at: string };

    assert.equal(session.device, 'tv');
    assert.ok(session.last_seen_at, 'la connexion date elle-même la session');

    // Aucune colonne ne porte l'en-tête : une classe parmi quatre ne
    // ré-identifie personne, le user-agent complet est une empreinte.
    const colonnes = (context.db.pragma('table_info(sessions)') as { name: string }[]).map(
      (row) => row.name,
    );
    assert.deepEqual(colonnes, [
      'id',
      'username',
      'created_at',
      'expires_at',
      'commenter_id',
      'last_seen_at',
      'device',
    ]);
  });

  it('n’écrit pas last_seen_at à chaque requête', async () => {
    const cookie = await connexion('famille', UA_TELEPHONE);
    const lire = (): string =>
      (
        context.db
          .prepare('SELECT last_seen_at FROM sessions WHERE username = ?')
          .get('famille') as {
          last_seen_at: string;
        }
      ).last_seen_at;

    const initial = lire();
    await ouvrir('/api/albums', cookie);
    await ouvrir('/api/albums/corse/items', cookie);

    // Plafonnée à une écriture par heure et par session : sans ce seuil, chaque
    // vignette d'une grille déclencherait un UPDATE SQLite.
    assert.equal(lire(), initial);

    // Une session dont la trace a plus d'une heure est redatée à la lecture
    // suivante — c'est ce qui fait dire « venu cette semaine ».
    context.db
      .prepare('UPDATE sessions SET last_seen_at = ? WHERE username = ?')
      .run('2020-01-01T00:00:00.000Z', 'famille');
    await ouvrir('/api/albums', cookie);
    assert.notEqual(lire(), '2020-01-01T00:00:00.000Z');
  });
});
