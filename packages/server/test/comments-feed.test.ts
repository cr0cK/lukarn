import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ALL_ALBUMS, type Comment, type CommentsFeedPage } from '@lukarn/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import { Mailer, type MailMessage } from '../src/mail.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Activity feed: what a visitor sees of the latest comments across all albums
 * and photos.
 *
 * Isolation is the primary invariant. This route is the first place in the
 * application to return messages from different albums in a single response:
 * a scoping error produces a leak rather than an empty page, and nothing in the
 * display would reveal it — a conversation from an inaccessible album looks
 * like any other.
 */

const PASSWORD = 'mot-de-passe-de-test';
const silencieux = { info: () => {}, warn: () => {}, debug: () => {} };
const root = mkdtempSync(join(tmpdir(), 'lukarn-feed-'));

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
  assert.equal(response.statusCode, 200, `login rejected for ${username}`);
  const cookie = response.cookies.find((entry) => entry.name === 'lukarn_session');
  assert.ok(cookie, 'session cookie missing');
  return `lukarn_session=${cookie.value}`;
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
  assert.ok(message, 'no code sent');
  const code = /\b(\d{6})\b/.exec(message.text)?.[1];
  assert.ok(code, 'code not found');

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

/** Queries the feed as the activity drawer does. */
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
  // An album whose identifier is the route segment: this reveals whether the
  // routing table lets `/:albumId` capture `/feed`.
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
  // With no albums, an empty list is the case where a forgotten `IN ()` would
  // return the entire corpus instead of nothing.
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

describe('activity feed isolation', () => {
  it('never exposes a comment from an unassigned album', async () => {
    const page = await feed(familleCookie);

    assert.ok(page.comments.length > 0, 'the feed is empty despite comments on the shared album');
    assert.ok(
      page.comments.every((comment) => comment.albumId === 'vacances'),
      'a comment from an unassigned album entered the feed',
    );
  });

  it('returns an empty page to an account without albums, not the whole corpus', async () => {
    const page = await feed(voisinCookie);
    assert.deepEqual(page, { comments: [], nextCursor: null });
  });

  it('returns 404 for an unassigned album as it does for a missing album', async () => {
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
    // Indistinguishable: probing identifiers must reveal nothing (D12).
    assert.deepEqual(interdit.json(), inexistant.json());
  });

  it('rejects an anonymous feed', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/comments/feed' });
    assert.equal(response.statusCode, 401);
  });

  it('remains reachable when an album uses "feed" as its identifier', async () => {
    const page = await feed(adminCookie, { limit: 1 });
    // The counters for the namesake album would return `{ counts: {} }`, without
    // `comments`: this is the ambiguity being prevented.
    assert.ok(Array.isArray(page.comments), 'the feed was captured by the album route');
  });
});

describe('feed entry content', () => {
  it('places the message in its album and on its photo', async () => {
    const page = await feed(adminCookie, { limit: 1, album: 'vacances' });
    const dernier = page.comments[0];

    assert.ok(dernier);
    assert.equal(dernier.body, 'On y retourne quand ?');
    assert.equal(dernier.albumId, 'vacances');
    assert.equal(dernier.albumTitle, 'Vacances');
    assert.equal(dernier.mediaId, 'plage');
    assert.equal(dernier.mediaName, 'plage.jpg');
    // Eight hash characters, as everywhere else: the thumbnail is served as
    // `immutable`, so its URL must change with the file content.
    assert.equal(dernier.mediaVersion, 'abcdef01');
  });

  it('keeps the message for a photo missing from the index, without a thumbnail', async () => {
    const commentaire = await post(adminCookie, 'vacances', 'ephemere', 'Elle existait ce jour-là');
    // The photo leaves Drive: the next synchronisation removes it from the index.
    context.media.upsertMany([media('vacances', 'plage')], '2025-02-01T00:00:00.000Z');
    assert.equal(context.media.deleteStale('vacances', '2025-02-01T00:00:00.000Z') > 0, true);

    const page = await feed(adminCookie, { album: 'vacances' });
    const orphelin = page.comments.find((entry) => entry.id === commentaire.id);

    assert.ok(orphelin, 'the comment disappeared with its photo');
    assert.equal(orphelin.mediaName, null);
    assert.equal(orphelin.mediaVersion, null);
    assert.equal(orphelin.body, 'Elle existait ce jour-là');
  });
});

describe('activity feed pagination', () => {
  it('neither overlaps nor skips a row between consecutive pages', async () => {
    const complet = await feed(adminCookie);
    assert.ok(complet.comments.length >= 4, 'too few messages to exercise pagination');

    const premiere = await feed(adminCookie, { limit: 2 });
    assert.equal(premiere.comments.length, 2);
    assert.ok(premiere.nextCursor, 'the first page marks the end while rows remain');

    const seconde = await feed(adminCookie, { limit: 2, cursor: premiere.nextCursor });
    const ids = [...premiere.comments, ...seconde.comments].map((entry) => entry.id);

    assert.equal(new Set(ids).size, ids.length, 'a comment appears on both pages');
    assert.deepEqual(
      ids,
      complet.comments.slice(0, 4).map((entry) => entry.id),
      'the two pages do not reconstruct the start of the full feed',
    );
  });

  it('returns the most recent first', async () => {
    const page = await feed(adminCookie);
    const ids = page.comments.map((entry) => entry.id);
    assert.deepEqual(
      ids,
      [...ids].sort((a, b) => b - a),
    );
  });

  it('marks the end with a null cursor', async () => {
    const page = await feed(adminCookie, { limit: 100 });
    assert.equal(page.nextCursor, null);
  });
});

describe('moderation and activity feed', () => {
  it('removes a hidden comment from the feed', async () => {
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
      'a hidden comment remains visible in the feed',
    );
  });
});
