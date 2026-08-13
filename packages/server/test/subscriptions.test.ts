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
 * Subscription to new album content and its announcement.
 *
 * Three ideas govern what follows. Visitors subscribe **by opening the album**,
 * because an identity is not tied to any album and a checkbox would never be
 * selected. Refusal, however, is permanent: reopening the album the day after
 * unsubscribing does not resubscribe. New content is counted using `added_at`,
 * never `seen_at`, which synchronisation rewrites everywhere on every run.
 */

const root = mkdtempSync(join(tmpdir(), 'lukarn-abo-'));

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

/** Pre-verified identity: the code path is tested elsewhere. */
function identiteVerifiee(email: string, nom: string): number {
  const asked = context.commenters.requestCode(email, nom);
  assert.ok('code' in asked);
  const verified = context.commenters.verify(email, asked.code);
  assert.ok('commenter' in verified);
  return verified.commenter.id;
}

/** Opens a session with the shared access key and returns its cookie. */
async function connexion(username: string): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: MOT_DE_PASSE },
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = response.cookies.find((entry) => entry.name === 'lukarn_session');
  assert.ok(cookie);
  return `lukarn_session=${cookie.value}`;
}

/**
 * Attaches a verified identity to this session. The API never returns the code:
 * it is read from the captured message, which also verifies that it was sent.
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

  // The code is in the body, not the subject — see D65.
  const code = /\b(\d{6})\b/.exec(boiteAuxLettres.at(-1)?.text ?? '')?.[1];
  assert.ok(code, 'no code sent');

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
    hasThumbnail: true,
    videoCodec: null,
  };
}

/**
 * Notifier connected to an observable outbox. `vider` waits for the queue:
 * messages are sent outside the call path (D37), so nothing has arrived just
 * after `run()`.
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
    instanceName: () => context.settings.instanceName,
    env,
    log: silencieux,
  });

  return { passage, vider: () => mailer.drain() };
}

/** Captured messages: the test instance never opens an SMTP connection. */
const boiteAuxLettres: MailMessage[] = [];

before(async () => {
  const built = await buildApp(env);
  server = built.server;
  context = built.context;

  // Without transport, no code can be sent and nobody can identify themselves:
  // that is the intended behaviour, but it would make these tests inert.
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

describe('subscription when opening an album', () => {
  let mamie: number;

  before(() => {
    mamie = identiteVerifiee('abo-mamie@exemple.fr', 'Mamie');
  });

  beforeEach(() => {
    context.db.prepare('DELETE FROM album_subscriptions').run();
  });

  it('subscribes a verified identity that opens the album', () => {
    context.subscriptions.subscribe(mamie, 'vacances');
    assert.equal(context.subscriptions.state(mamie, 'vacances'), 'auto');
    assert.deepEqual(
      context.subscriptions.subscribers('vacances').map((abonne) => abonne.email),
      ['abo-mamie@exemple.fr'],
    );
  });

  it('never subscribes an unverified identity', () => {
    const asked = context.commenters.requestCode('abo-inconnu@exemple.fr', 'Inconnu');
    assert.ok('code' in asked);

    context.subscriptions.subscribe(asked.commenter.id, 'vacances');

    // The address has only been declared: it may belong to a third party whom
    // this gallery has no right to contact.
    assert.equal(context.subscriptions.state(asked.commenter.id, 'vacances'), null);
    assert.deepEqual(context.subscriptions.subscribers('vacances'), []);
  });

  it('preserves an unsubscribe when the album is reopened', () => {
    context.subscriptions.subscribe(mamie, 'noel');
    context.subscriptions.unsubscribe(mamie, 'noel');

    // The album is reopened the next day: because subscription is automatic,
    // this is where it matters. Resubscribing is exactly what makes people hate
    // a service.
    context.subscriptions.subscribe(mamie, 'noel');

    assert.equal(context.subscriptions.state(mamie, 'noel'), 'opted_out');
    assert.deepEqual(context.subscriptions.subscribers('noel'), []);
  });

  it('unsubscribes from only one album at a time', () => {
    context.subscriptions.subscribe(mamie, 'vacances');
    context.subscriptions.subscribe(mamie, 'noel');
    context.subscriptions.unsubscribe(mamie, 'noel');

    // Finding "Noël 2019" too noisy must not silence everything else.
    assert.equal(context.subscriptions.state(mamie, 'vacances'), 'auto');
    assert.deepEqual(
      context.subscriptions.subscribers('vacances').map((abonne) => abonne.email),
      ['abo-mamie@exemple.fr'],
    );
  });

  it('stops writing to someone who disabled all notifications', () => {
    context.subscriptions.subscribe(mamie, 'vacances');
    context.commenters.setNotify(mamie, false);

    // `notify` is the only switch that says "no more email from this gallery":
    // continuing to write would eventually be marked as spam.
    assert.deepEqual(context.subscriptions.subscribers('vacances'), []);
    context.commenters.setNotify(mamie, true);
  });
});

describe('date added to the index', () => {
  beforeEach(() => {
    context.db.prepare('DELETE FROM media').run();
  });

  it('does not change when synchronisation sees media again', () => {
    context.media.upsertMany([photo('vacances', 'img-1')], '2026-07-01T00:00:00.000Z');
    context.media.upsertMany([photo('vacances', 'img-1')], '2026-07-02T00:00:00.000Z');

    const ligne = context.db
      .prepare('SELECT added_at, seen_at FROM media WHERE album_id = ? AND id = ?')
      .get('vacances', 'img-1') as { added_at: string; seen_at: string };

    // This is the point: `seen_at` follows the latest synchronisation, while
    // `added_at` does not. Counting new content using `seen_at` would count the
    // whole album on every run.
    assert.equal(ligne.added_at, '2026-07-01T00:00:00.000Z');
    assert.equal(ligne.seen_at, '2026-07-02T00:00:00.000Z');
  });

  it('counts only media added after the boundary as new', () => {
    context.media.upsertMany([photo('vacances', 'img-1')], '2026-07-01T00:00:00.000Z');
    context.media.upsertMany(
      [photo('vacances', 'img-2'), photo('vacances', 'img-3')],
      '2026-07-03T00:00:00.000Z',
    );
    // The first item is seen again in the same run: new to `seen_at`, known here.
    context.media.upsertMany([photo('vacances', 'img-1')], '2026-07-03T00:00:00.000Z');

    assert.deepEqual(context.media.countAddedSince('vacances', '2026-07-02T00:00:00.000Z'), {
      count: 2,
      latest: '2026-07-03T00:00:00.000Z',
    });
  });
});

describe('new content announcements', () => {
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

  it('announces nothing retroactively on a newly migrated database', async () => {
    // A running instance has photos indexed before the migration, therefore
    // without `added_at`, and no announcement boundary.
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
    assert.deepEqual(envoyes, [], 'the update must not announce historical content');
    // The boundary is set without sending, so the next run starts from there.
    assert.equal(context.syncState.notifiedAt('vacances'), new Date(maintenant).toISOString());
    assert.equal(passage.run(maintenant + HEURE_MS), 0);
    await vider();
    assert.deepEqual(envoyes, []);
  });

  it('waits for synchronisation to settle', async () => {
    context.syncState.set('vacances', {
      lastSyncAt: '2026-07-01T00:00:00.000Z',
      status: 'ok',
      error: null,
    });
    context.syncState.markNotified('vacances', '2026-07-01T00:00:00.000Z');
    context.media.upsertMany([photo('vacances', 'img-1')], '2026-07-01T00:10:00.000Z');

    const envoyes: MailMessage[] = [];
    const { passage, vider } = notifieur(envoyes);

    // Ten minutes after the latest synchronisation, later batches may still
    // arrive, and announcing now would send ten emails in one day.
    assert.equal(passage.run(Date.parse('2026-07-01T00:20:00.000Z')), 0);
    await vider();
    assert.deepEqual(envoyes, []);

    // An hour later nothing is changing, so the announcement is sent.
    assert.equal(passage.run(Date.parse('2026-07-01T01:30:00.000Z')), 1);
    await vider();
    assert.equal(envoyes.length, 1);
    assert.match(envoyes[0]!.subject, /1 new photo in Vacances/);
    assert.equal(envoyes[0]!.to, 'abo-papi@exemple.fr');
    // The link leads to what the message announces. Since albums are read from
    // the beginning (D99), opening it without `?order=desc` would place the
    // reader on the oldest photos — the opposite of "there is new content".
    assert.match(envoyes[0]!.text, /\/album\/vacances\?order=desc/);
    assert.match(envoyes[0]!.html, /\/album\/vacances\?order=desc/);
  });

  it('does not announce the same photos twice', async () => {
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
    assert.match(envoyes[0]!.subject, /2 new photos in Vacances/);

    // Without the boundary, every hourly run would announce the same batch again.
    assert.equal(passage.run(maintenant + HEURE_MS), 0);
    await vider();
    assert.equal(envoyes.length, 1);
  });

  it('does not announce an album whose latest synchronisation failed', async () => {
    context.syncState.set('vacances', {
      lastSyncAt: '2026-07-01T00:00:00.000Z',
      status: 'error',
      error: 'quota dépassé',
    });
    context.syncState.markNotified('vacances', '2026-06-01T00:00:00.000Z');
    context.media.upsertMany([photo('vacances', 'img-1')], '2026-07-01T00:00:00.000Z');

    const envoyes: MailMessage[] = [];
    const { passage, vider } = notifieur(envoyes);
    // The index is partial: deriving a new-content count from it would be
    // meaningless, and the boundary must not advance either.
    assert.equal(passage.run(Date.parse('2026-07-02T00:00:00.000Z')), 0);
    await vider();
    assert.deepEqual(envoyes, []);
    assert.equal(context.syncState.notifiedAt('vacances'), '2026-06-01T00:00:00.000Z');
  });

  it('advances the boundary even without subscribers', () => {
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
    // Otherwise, a new subscriber's first email would include content that
    // arrived long before they subscribed.
    assert.equal(context.syncState.notifiedAt('vacances'), '2026-07-01T00:00:00.000Z');
  });

  it('changes nothing until SMTP is configured', () => {
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
      instanceName: () => context.settings.instanceName,
      env,
      log: silencieux,
    });

    assert.equal(inerte.run(Date.parse('2026-07-02T00:00:00.000Z')), 0);
    // The boundary remains empty: when SMTP is configured, that run will
    // initialise it without announcing earlier photos.
    assert.equal(context.syncState.notifiedAt('vacances'), null);
  });
});

describe('album unsubscribe link', () => {
  it('does not apply to another album', () => {
    const jeton = signAlbumUnsubscribeToken('abo-mamie@exemple.fr', 'noel', env.sessionSecret);

    assert.ok(
      verifyAlbumUnsubscribeToken('abo-mamie@exemple.fr', 'noel', jeton, env.sessionSecret),
    );
    // Replaying it across albums would remove a subscription that was not targeted.
    assert.ok(
      !verifyAlbumUnsubscribeToken('abo-mamie@exemple.fr', 'vacances', jeton, env.sessionSecret),
    );
    assert.ok(
      !verifyAlbumUnsubscribeToken('abo-papi@exemple.fr', 'noel', jeton, env.sessionSecret),
    );
  });

  it('rejects a truncated token without throwing', () => {
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

describe('through the API', () => {
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

  it('subscribes whoever opens the first page of the album', async () => {
    await ouvrir('/api/albums/vacances/items');
    assert.equal(context.subscriptions.state(lecteur, 'vacances'), 'auto');
  });

  it('does not subscribe from media details', async () => {
    await ouvrir('/api/albums/vacances/items/img-api');
    // Otherwise, clicking "View photo" from a comment notification would
    // subscribe to new album content, which nobody requested.
    assert.equal(context.subscriptions.state(lecteur, 'vacances'), null);
  });

  it('does not subscribe while paging', async () => {
    const curseur = encodeCursor('2026-07-01T10:00:00.000Z', 'img-api');
    await ouvrir(`/api/albums/vacances/items?cursor=${encodeURIComponent(curseur)}`);
    // Later pages are part of the same action as the first: writing on every
    // page would not change the subscription and would add a cost to each scroll.
    assert.equal(context.subscriptions.state(lecteur, 'vacances'), null);
  });

  it('unsubscribes from only the album targeted by the link without a session', async () => {
    await ouvrir('/api/albums/vacances/items');
    await ouvrir('/api/albums/noel/items');

    const jeton = signAlbumUnsubscribeToken('abo-lecteur@exemple.fr', 'noel', env.sessionSecret);
    const response = await server.inject({
      method: 'GET',
      url: `/api/subscriptions/unsubscribe?u=${encodeURIComponent('abo-lecteur@exemple.fr')}&a=noel&t=${jeton}`,
    });

    // There is no cookie because the link is opened from an inbox, often on
    // another device.
    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.headers['content-type'] as string, /text\/html/);
    assert.equal(context.subscriptions.state(lecteur, 'noel'), 'opted_out');
    assert.equal(context.subscriptions.state(lecteur, 'vacances'), 'auto');
  });

  it('rejects a token for another album', async () => {
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

describe('notifier coupling to the delivery service', () => {
  it('resolves the delivery service on every run, not at construction', async () => {
    // `comments.test.ts` replaces `context.mailer` to observe deliveries. If
    // the notifier captured the instance at construction, it would write to
    // the old one: the test would wait for a message sent elsewhere, and its
    // failure would not explain why. This test locks down the indirection that
    // prevents that.
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
      instanceName: () => context.settings.instanceName,
      env,
      log: silencieux,
    });

    // Replaced **after** construction, as a test would do when installing its
    // observer after the context is ready.
    mailer = new Mailer(async (message) => {
      envoyes.push(message);
    }, silencieux);

    passage.run(Date.parse('2026-07-01T02:00:00.000Z'));
    await mailer.drain();

    assert.equal(envoyes.length, 1, 'the notifier must see the replacement');
    assert.equal(envoyes[0]!.to, 'abo-tardif@exemple.fr');
  });
});
