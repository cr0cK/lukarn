import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { signAlbumUnsubscribeToken, verifyAlbumUnsubscribeToken } from '../src/crypto.js';
import { loadEnv } from '../src/env.js';
import { Mailer, type MailMessage } from '../src/mail.js';
import { AlbumNotifier } from '../src/notifier.js';
import { encodeCursor, type MediaUpsert } from '../src/repo.js';

/**
 * Abonnement aux nouveautés d'un album, et annonce de celles-ci.
 *
 * Trois idées gouvernent ce qui suit. On s'abonne **en ouvrant l'album**, parce
 * qu'une identité n'est rattachée à aucun album et qu'une case à cocher ne
 * serait jamais cochée. Un refus, lui, ne se reprend pas : rouvrir l'album le
 * lendemain d'un désabonnement ne réabonne pas. Et ce qui est nouveau se
 * compte sur `added_at`, jamais sur `seen_at` que la synchronisation réécrit
 * partout à chaque passage.
 */

const root = mkdtempSync(join(tmpdir(), 'gdv-abo-'));

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

const silencieux = { info: () => {}, warn: () => {}, debug: () => {} };

const HEURE_MS = 60 * 60 * 1000;
const MOT_DE_PASSE = 'mot-de-passe-de-test';

let server: FastifyInstance;
let context: AppContext;

/** Identité vérifiée d'emblée : le chemin du code est éprouvé ailleurs. */
function identiteVerifiee(email: string, nom: string): number {
  const asked = context.commenters.requestCode(email, nom);
  assert.ok('code' in asked);
  const verified = context.commenters.verify(email, asked.code);
  assert.ok('commenter' in verified);
  return verified.commenter.id;
}

/** Ouvre une session sur la clé d'accès partagée et rend son cookie. */
async function connexion(username: string): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: MOT_DE_PASSE },
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = response.cookies.find((entry) => entry.name === 'gdv_session');
  assert.ok(cookie);
  return `gdv_session=${cookie.value}`;
}

/**
 * Rattache une identité vérifiée à cette session. Le code n'est jamais rendu
 * par l'API : il est relu dans le message capturé, ce qui vérifie au passage
 * qu'il part bien.
 */
async function identification(cookie: string, email: string, nom: string): Promise<void> {
  boiteAuxLettres.length = 0;
  const asked = await server.inject({
    method: 'POST',
    url: '/api/identity/request-code',
    headers: { cookie },
    payload: { email, displayName: nom },
  });
  assert.equal(asked.statusCode, 202, asked.body);
  await context.mailer.drain();

  const code = /\b(\d{6})\b/.exec(boiteAuxLettres.at(-1)?.subject ?? '')?.[1];
  assert.ok(code, 'aucun code envoyé');

  const verified = await server.inject({
    method: 'POST',
    url: '/api/identity/verify',
    headers: { cookie },
    payload: { email, code },
  });
  assert.equal(verified.statusCode, 200, verified.body);
}

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
  };
}

/**
 * Notifieur relié à une boîte d'envoi observable. `vider` attend la file : les
 * messages partent hors du chemin de l'appel (D37), donc rien n'est arrivé
 * juste après `run()`.
 */
function notifieur(envoyes: MailMessage[]): {
  passage: AlbumNotifier;
  vider: () => Promise<void>;
} {
  const mailer = new Mailer(async (message) => {
    envoyes.push(message);
  }, silencieux);

  const passage = new AlbumNotifier({
    albums: () => context.albums,
    media: context.media,
    syncState: context.syncState,
    subscriptions: context.subscriptions,
    mailer: () => mailer,
    env,
    log: silencieux,
  });

  return { passage, vider: () => mailer.drain() };
}

/** Messages capturés : l'instance de test n'ouvre évidemment pas de SMTP. */
const boiteAuxLettres: MailMessage[] = [];

before(async () => {
  const built = await buildApp(env);
  server = built.server;
  context = built.context;

  // Sans transport, aucun code ne peut partir et personne ne peut s'identifier :
  // c'est le comportement voulu, mais il rendrait ces tests inertes.
  context.mailer = new Mailer(async (message) => {
    boiteAuxLettres.push(message);
  }, silencieux);

  context.config.createAlbum({
    id: 'vacances',
    title: 'Vacances',
    folderId: 'f1',
    recursive: true,
  });
  context.config.createAlbum({ id: 'noel', title: 'Noël 2019', folderId: 'f2', recursive: true });
  context.config.createUser({
    username: 'famille',
    passwordHash: await argon2.hash(MOT_DE_PASSE, { type: argon2.argon2id }),
    admin: false,
    albums: ['vacances', 'noel'],
  });
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('abonnement à l’ouverture d’un album', () => {
  let mamie: number;

  before(() => {
    mamie = identiteVerifiee('abo-mamie@exemple.fr', 'Mamie');
  });

  beforeEach(() => {
    context.db.prepare('DELETE FROM album_subscriptions').run();
  });

  it('abonne une identité vérifiée qui ouvre l’album', () => {
    context.subscriptions.subscribe(mamie, 'vacances');
    assert.equal(context.subscriptions.state(mamie, 'vacances'), 'auto');
    assert.deepEqual(
      context.subscriptions.subscribers('vacances').map((abonne) => abonne.email),
      ['abo-mamie@exemple.fr'],
    );
  });

  it('n’abonne jamais une identité non vérifiée', () => {
    const asked = context.commenters.requestCode('abo-inconnu@exemple.fr', 'Inconnu');
    assert.ok('code' in asked);

    context.subscriptions.subscribe(asked.commenter.id, 'vacances');

    // L'adresse n'est que déclarée : elle peut être celle d'un tiers, à qui
    // cette galerie n'a rien à écrire.
    assert.equal(context.subscriptions.state(asked.commenter.id, 'vacances'), null);
    assert.deepEqual(context.subscriptions.subscribers('vacances'), []);
  });

  it('laisse un désabonnement survivre à la réouverture de l’album', () => {
    context.subscriptions.subscribe(mamie, 'noel');
    context.subscriptions.unsubscribe(mamie, 'noel');

    // Le lendemain, on rouvre l'album : l'abonnement étant automatique, c'est
    // ici que tout se joue. Réabonner serait précisément ce qui fait détester
    // un service.
    context.subscriptions.subscribe(mamie, 'noel');

    assert.equal(context.subscriptions.state(mamie, 'noel'), 'opted_out');
    assert.deepEqual(context.subscriptions.subscribers('noel'), []);
  });

  it('ne coupe qu’un album à la fois', () => {
    context.subscriptions.subscribe(mamie, 'vacances');
    context.subscriptions.subscribe(mamie, 'noel');
    context.subscriptions.unsubscribe(mamie, 'noel');

    // Trouver « Noël 2019 » trop bavard ne doit pas faire taire le reste.
    assert.equal(context.subscriptions.state(mamie, 'vacances'), 'auto');
    assert.deepEqual(
      context.subscriptions.subscribers('vacances').map((abonne) => abonne.email),
      ['abo-mamie@exemple.fr'],
    );
  });

  it('n’écrit plus à qui a coupé toutes ses notifications', () => {
    context.subscriptions.subscribe(mamie, 'vacances');
    context.commenters.setNotify(mamie, false);

    // `notify` est le seul interrupteur qui dise « plus aucun email de cette
    // galerie » : continuer à écrire finirait en indésirable.
    assert.deepEqual(context.subscriptions.subscribers('vacances'), []);
    context.commenters.setNotify(mamie, true);
  });
});

describe('date d’entrée dans l’index', () => {
  beforeEach(() => {
    context.db.prepare('DELETE FROM media').run();
  });

  it('ne bouge plus quand la synchronisation revoit un média', () => {
    context.media.upsertMany([photo('vacances', 'img-1')], '2026-07-01T00:00:00.000Z');
    context.media.upsertMany([photo('vacances', 'img-1')], '2026-07-02T00:00:00.000Z');

    const ligne = context.db
      .prepare('SELECT added_at, seen_at FROM media WHERE album_id = ? AND id = ?')
      .get('vacances', 'img-1') as { added_at: string; seen_at: string };

    // C'est tout le point : `seen_at` suit la dernière sync, `added_at` non.
    // Compter les nouveautés sur `seen_at` compterait l'album entier à chaque
    // passage.
    assert.equal(ligne.added_at, '2026-07-01T00:00:00.000Z');
    assert.equal(ligne.seen_at, '2026-07-02T00:00:00.000Z');
  });

  it('ne compte comme nouveaux que les médias entrés après la borne', () => {
    context.media.upsertMany([photo('vacances', 'img-1')], '2026-07-01T00:00:00.000Z');
    context.media.upsertMany(
      [photo('vacances', 'img-2'), photo('vacances', 'img-3')],
      '2026-07-03T00:00:00.000Z',
    );
    // Le premier média revu au même passage : nouveau pour `seen_at`, connu ici.
    context.media.upsertMany([photo('vacances', 'img-1')], '2026-07-03T00:00:00.000Z');

    assert.deepEqual(context.media.countAddedSince('vacances', '2026-07-02T00:00:00.000Z'), {
      count: 2,
      latest: '2026-07-03T00:00:00.000Z',
    });
  });
});

describe('annonce des nouveautés', () => {
  let papi: number;

  before(() => {
    papi = identiteVerifiee('abo-papi@exemple.fr', 'Papi');
  });

  beforeEach(() => {
    context.db.prepare('DELETE FROM media').run();
    context.db.prepare('DELETE FROM sync_state').run();
    context.db.prepare('DELETE FROM album_subscriptions').run();
    context.subscriptions.subscribe(papi, 'vacances');
  });

  it('n’annonce rien rétroactivement sur une base qui vient d’être migrée', async () => {
    // Une instance en service : des photos indexées avant la migration, donc
    // sans `added_at`, et aucune borne d'annonce.
    context.db
      .prepare(
        `INSERT INTO media (album_id, id, name, mime_type, kind, taken_at, modified_time, seen_at)
       VALUES ('vacances', 'ancienne', 'IMG.jpg', 'image/jpeg', 'photo',
               '2019-01-01T00:00:00.000Z', '2019-01-01T00:00:00.000Z', '2019-01-01T00:00:00.000Z')`,
      )
      .run();
    context.syncState.set('vacances', {
      lastSyncAt: '2026-07-01T00:00:00.000Z',
      status: 'ok',
      error: null,
    });

    const envoyes: MailMessage[] = [];
    const { passage, vider } = notifieur(envoyes);
    const maintenant = Date.parse('2026-07-02T00:00:00.000Z');

    assert.equal(passage.run(maintenant), 0);
    await vider();
    assert.deepEqual(envoyes, [], "la mise à jour ne doit pas annoncer l'historique");
    // La borne est posée sans envoi : le passage suivant repart de là.
    assert.equal(context.syncState.notifiedAt('vacances'), new Date(maintenant).toISOString());
    assert.equal(passage.run(maintenant + HEURE_MS), 0);
    await vider();
    assert.deepEqual(envoyes, []);
  });

  it('attend que la synchronisation soit calme', async () => {
    context.syncState.set('vacances', {
      lastSyncAt: '2026-07-01T00:00:00.000Z',
      status: 'ok',
      error: null,
    });
    context.syncState.markNotified('vacances', '2026-07-01T00:00:00.000Z');
    context.media.upsertMany([photo('vacances', 'img-1')], '2026-07-01T00:10:00.000Z');

    const envoyes: MailMessage[] = [];
    const { passage, vider } = notifieur(envoyes);

    // Dix minutes après la dernière sync : les lots suivants peuvent encore
    // arriver, et annoncer maintenant enverrait dix emails dans la journée.
    assert.equal(passage.run(Date.parse('2026-07-01T00:20:00.000Z')), 0);
    await vider();
    assert.deepEqual(envoyes, []);

    // Une heure plus tard, plus rien ne bouge : l'annonce part.
    assert.equal(passage.run(Date.parse('2026-07-01T01:30:00.000Z')), 1);
    await vider();
    assert.equal(envoyes.length, 1);
    assert.match(envoyes[0]!.subject, /1 nouvelle photo dans Vacances/);
    assert.equal(envoyes[0]!.to, 'abo-papi@exemple.fr');
  });

  it('n’annonce pas deux fois les mêmes photos', async () => {
    context.syncState.set('vacances', {
      lastSyncAt: '2026-07-01T00:00:00.000Z',
      status: 'ok',
      error: null,
    });
    context.syncState.markNotified('vacances', '2026-06-01T00:00:00.000Z');
    context.media.upsertMany(
      [photo('vacances', 'img-1'), photo('vacances', 'img-2')],
      '2026-07-01T00:00:00.000Z',
    );

    const envoyes: MailMessage[] = [];
    const { passage, vider } = notifieur(envoyes);
    const maintenant = Date.parse('2026-07-01T02:00:00.000Z');

    assert.equal(passage.run(maintenant), 1);
    await vider();
    assert.match(envoyes[0]!.subject, /2 nouvelles photos dans Vacances/);

    // Sans la borne, chaque passage horaire réannoncerait le même lot.
    assert.equal(passage.run(maintenant + HEURE_MS), 0);
    await vider();
    assert.equal(envoyes.length, 1);
  });

  it('n’annonce pas un album dont la dernière synchronisation a échoué', async () => {
    context.syncState.set('vacances', {
      lastSyncAt: '2026-07-01T00:00:00.000Z',
      status: 'error',
      error: 'quota dépassé',
    });
    context.syncState.markNotified('vacances', '2026-06-01T00:00:00.000Z');
    context.media.upsertMany([photo('vacances', 'img-1')], '2026-07-01T00:00:00.000Z');

    const envoyes: MailMessage[] = [];
    const { passage, vider } = notifieur(envoyes);
    // L'index est partiel : en tirer un compte de nouveautés dirait n'importe
    // quoi, et la borne ne doit pas avancer pour autant.
    assert.equal(passage.run(Date.parse('2026-07-02T00:00:00.000Z')), 0);
    await vider();
    assert.deepEqual(envoyes, []);
    assert.equal(context.syncState.notifiedAt('vacances'), '2026-06-01T00:00:00.000Z');
  });

  it('avance la borne même sans abonné', () => {
    context.db.prepare('DELETE FROM album_subscriptions').run();
    context.syncState.set('vacances', {
      lastSyncAt: '2026-07-01T00:00:00.000Z',
      status: 'ok',
      error: null,
    });
    context.syncState.markNotified('vacances', '2026-06-01T00:00:00.000Z');
    context.media.upsertMany([photo('vacances', 'img-1')], '2026-07-01T00:00:00.000Z');

    const envoyes: MailMessage[] = [];
    assert.equal(notifieur(envoyes).passage.run(Date.parse('2026-07-02T00:00:00.000Z')), 0);
    // Sans cela, le premier abonné venu recevrait pour son premier email les
    // nouveautés arrivées bien avant qu'il ne s'abonne.
    assert.equal(context.syncState.notifiedAt('vacances'), '2026-07-01T00:00:00.000Z');
  });

  it('ne touche à rien tant que SMTP n’est pas configuré', () => {
    context.syncState.set('vacances', {
      lastSyncAt: '2026-07-01T00:00:00.000Z',
      status: 'ok',
      error: null,
    });
    context.media.upsertMany([photo('vacances', 'img-1')], '2026-07-01T00:00:00.000Z');

    const inerte = new AlbumNotifier({
      albums: () => context.albums,
      media: context.media,
      syncState: context.syncState,
      subscriptions: context.subscriptions,
      mailer: () => new Mailer(null, silencieux),
      env,
      log: silencieux,
    });

    assert.equal(inerte.run(Date.parse('2026-07-02T00:00:00.000Z')), 0);
    // La borne reste vide : le jour où SMTP arrive, c'est ce passage-là qui
    // l'initialisera, sans annoncer les photos d'avant.
    assert.equal(context.syncState.notifiedAt('vacances'), null);
  });
});

describe('lien de désabonnement d’un album', () => {
  it('ne vaut pas pour un autre album', () => {
    const jeton = signAlbumUnsubscribeToken('abo-mamie@exemple.fr', 'noel', env.sessionSecret);

    assert.ok(
      verifyAlbumUnsubscribeToken('abo-mamie@exemple.fr', 'noel', jeton, env.sessionSecret),
    );
    // Rejouer d'un album à l'autre couperait un abonnement qu'on n'a pas visé.
    assert.ok(
      !verifyAlbumUnsubscribeToken('abo-mamie@exemple.fr', 'vacances', jeton, env.sessionSecret),
    );
    assert.ok(
      !verifyAlbumUnsubscribeToken('abo-papi@exemple.fr', 'noel', jeton, env.sessionSecret),
    );
  });

  it('rejette un jeton tronqué sans lever', () => {
    const jeton = signAlbumUnsubscribeToken('abo-mamie@exemple.fr', 'noel', env.sessionSecret);
    assert.doesNotThrow(() =>
      verifyAlbumUnsubscribeToken(
        'abo-mamie@exemple.fr',
        'noel',
        jeton.slice(0, 12),
        env.sessionSecret,
      ),
    );
  });
});

describe('par l’API', () => {
  let cookie: string;
  let lecteur: number;

  before(async () => {
    context.media.upsertMany([photo('vacances', 'img-api')], '2026-07-01T00:00:00.000Z');
    cookie = await connexion('famille');
    await identification(cookie, 'abo-lecteur@exemple.fr', 'Lecteur');
    lecteur = context.commenters.byEmail('abo-lecteur@exemple.fr')!.id;
  });

  beforeEach(() => {
    context.db.prepare('DELETE FROM album_subscriptions').run();
  });

  async function ouvrir(url: string): Promise<void> {
    const response = await server.inject({ method: 'GET', url, headers: { cookie } });
    assert.equal(response.statusCode, 200, response.body);
  }

  it('abonne celui qui ouvre la première page de l’album', async () => {
    await ouvrir('/api/albums/vacances/items');
    assert.equal(context.subscriptions.state(lecteur, 'vacances'), 'auto');
  });

  it('n’abonne pas depuis le détail d’un média', async () => {
    await ouvrir('/api/albums/vacances/items/img-api');
    // Sinon cliquer « Voir la photo » depuis une notification de commentaire
    // abonnerait aux nouveautés de l'album, ce que personne n'a demandé.
    assert.equal(context.subscriptions.state(lecteur, 'vacances'), null);
  });

  it('n’abonne pas en tournant les pages', async () => {
    const curseur = encodeCursor('2026-07-01T10:00:00.000Z', 'img-api');
    await ouvrir(`/api/albums/vacances/items?cursor=${encodeURIComponent(curseur)}`);
    // Les pages suivantes sont le même geste que la première : une écriture par
    // défilement ne changerait rien à l'abonnement et coûterait à chaque scroll.
    assert.equal(context.subscriptions.state(lecteur, 'vacances'), null);
  });

  it('coupe l’album visé par le lien, et lui seul, sans session', async () => {
    await ouvrir('/api/albums/vacances/items');
    await ouvrir('/api/albums/noel/items');

    const jeton = signAlbumUnsubscribeToken('abo-lecteur@exemple.fr', 'noel', env.sessionSecret);
    const response = await server.inject({
      method: 'GET',
      url: `/api/subscriptions/unsubscribe?u=${encodeURIComponent('abo-lecteur@exemple.fr')}&a=noel&t=${jeton}`,
    });

    // Aucun cookie : on clique ce lien depuis sa boîte aux lettres, souvent sur
    // un autre appareil.
    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.headers['content-type'] as string, /text\/html/);
    assert.equal(context.subscriptions.state(lecteur, 'noel'), 'opted_out');
    assert.equal(context.subscriptions.state(lecteur, 'vacances'), 'auto');
  });

  it('refuse le jeton d’un autre album', async () => {
    await ouvrir('/api/albums/noel/items');

    const jeton = signAlbumUnsubscribeToken(
      'abo-lecteur@exemple.fr',
      'vacances',
      env.sessionSecret,
    );
    const response = await server.inject({
      method: 'GET',
      url: `/api/subscriptions/unsubscribe?u=${encodeURIComponent('abo-lecteur@exemple.fr')}&a=noel&t=${jeton}`,
    });

    assert.equal(response.statusCode, 400);
    assert.equal(context.subscriptions.state(lecteur, 'noel'), 'auto');
  });
});

describe('couplage du notifieur au service d’envoi', () => {
  it('résout le service d’envoi à chaque passage, pas à sa construction', async () => {
    // `comments.test.ts` remplace `context.mailer` pour observer les envois. Si
    // le notifieur avait capturé l'instance à sa construction, il écrirait dans
    // l'ancienne : le test attendrait un message parti ailleurs, et son échec ne
    // dirait rien de la cause. Ce test verrouille l'indirection qui l'évite.
    const papi = identiteVerifiee('abo-tardif@exemple.fr', 'Papi');
    context.db.prepare('DELETE FROM media').run();
    context.db.prepare('DELETE FROM sync_state').run();
    context.db.prepare('DELETE FROM album_subscriptions').run();
    context.subscriptions.subscribe(papi, 'vacances');

    context.syncState.set('vacances', {
      lastSyncAt: '2026-07-01T00:00:00.000Z',
      status: 'ok',
      error: null,
    });
    context.syncState.markNotified('vacances', '2026-07-01T00:00:00.000Z');
    context.media.upsertMany([photo('vacances', 'img-tardif')], '2026-07-01T00:10:00.000Z');

    const envoyes: MailMessage[] = [];
    let mailer = new Mailer(null, silencieux);
    const passage = new AlbumNotifier({
      albums: () => context.albums,
      media: context.media,
      syncState: context.syncState,
      subscriptions: context.subscriptions,
      mailer: () => mailer,
      env,
      log: silencieux,
    });

    // Remplacé **après** la construction, comme le ferait un test qui installe
    // son observateur une fois le contexte monté.
    mailer = new Mailer(async (message) => {
      envoyes.push(message);
    }, silencieux);

    passage.run(Date.parse('2026-07-01T02:00:00.000Z'));
    await mailer.drain();

    assert.equal(envoyes.length, 1, 'le remplacement doit être vu par le notifieur');
    assert.equal(envoyes[0]!.to, 'abo-tardif@exemple.fr');
  });
});
