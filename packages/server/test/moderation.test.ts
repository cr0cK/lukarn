import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ALL_ALBUMS, type AdminCommentsPage, type Comment } from '@lukarn/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import { Mailer, type MailMessage } from '../src/mail.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Moderation queue: pagination, filters, search and bulk action.
 *
 * These invariants make the queue reliable for work: adjacent pages neither
 * overlap nor skip a row, the total describes the corpus rather than the
 * remainder, filters partition it, and search finds exactly what was typed —
 * including `%`.
 */

const PASSWORD = 'mot-de-passe-de-test';
const silencieux = { info: () => {}, warn: () => {}, debug: () => {} };
const root = mkdtempSync(join(tmpdir(), 'lukarn-moderation-'));

let server: FastifyInstance;
let context: AppContext;
let adminCookie: string;
let familleCookie: string;
const envoyes: MailMessage[] = [];

/** Identities created by setup, used to target the bulk action. */
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
    sourcePath: null,
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

  const commenter = context.commenters.byEmail(email);
  assert.ok(commenter, `identity ${email} missing after verification`);
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

/** Queries the moderation queue as the administration interface does. */
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

  // Six messages, two albums, two identities. The last contains `%`, exposing
  // any search that fails to escape LIKE wildcards.
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

describe('moderation queue pagination', () => {
  it('neither overlaps nor skips a row between consecutive pages', async () => {
    const premiere = await file({ limit: 4 });
    assert.equal(premiere.comments.length, 4);
    assert.ok(premiere.nextCursor, 'the first page marks the end while rows remain');

    const seconde = await file({ limit: 4, cursor: premiere.nextCursor });

    const ids = [...premiere.comments, ...seconde.comments].map((comment) => comment.id);
    assert.equal(new Set(ids).size, ids.length, 'a comment appears on both pages');
    assert.equal(ids.length, premiere.total, 'comments are missing between the two pages');
    // Reverse chronological throughout, including across the cursor.
    assert.deepEqual(
      ids,
      [...ids].sort((a, b) => b - a),
    );
  });

  it('reports corpus size rather than the remaining rows', async () => {
    const entiere = await file({ limit: 100 });
    const premiere = await file({ limit: 2 });
    const suivante = await file({ limit: 2, cursor: premiere.nextCursor! });

    // Total ignores the cursor: otherwise "3 of 6" would become "3 of 4" on the
    // next page and the count would be meaningless.
    assert.equal(premiere.total, entiere.total);
    assert.equal(suivante.total, entiere.total);
  });

  it('returns a null cursor on the last page', async () => {
    const entiere = await file({ limit: 100 });
    assert.equal(entiere.nextCursor, null);
  });
});

describe('moderation queue filters', () => {
  it('partitions the total into visible and hidden', async () => {
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

  it('restricts to one album without including others', async () => {
    const corse = await file({ limit: 100, albumId: 'corse' });

    assert.equal(corse.total, 2);
    assert.ok(corse.comments.every((comment) => comment.albumId === 'corse'));
  });

  it('rejects an impossibly formatted album rather than ignoring it', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/admin/comments?albumId=..%2Fetc',
      headers: { cookie: adminCookie },
    });
    assert.equal(response.statusCode, 400);
  });
});

describe('moderation queue search', () => {
  it('searches the body, declared name and address', async () => {
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

  it('searches for a percent sign when one is entered', async () => {
    const tous = await file({ limit: 100 });
    const pourcent = await file({ limit: 100, q: '%' });

    // Without `ESCAPE`, `%` is LIKE's wildcard and would return the whole corpus.
    assert.notEqual(pourcent.total, tous.total);
    assert.equal(pourcent.total, 1);
    assert.match(pourcent.comments[0]!.body, /%/);
  });

  it('does not let underscore replace any character', async () => {
    // `_` is LIKE's other wildcard: "l_" would return "la", "le" and "lu".
    const souligne = await file({ limit: 100, q: 'l_' });
    assert.equal(souligne.total, 0);
  });

  it('counts what it returns', async () => {
    const trouve = await file({ limit: 100, q: 'Bonifacio' });
    assert.equal(trouve.total, trouve.comments.length);
  });
});

describe('moderation grouped by identity', () => {
  it('touches only messages from the targeted identity and remains reversible', async () => {
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
        `message ${comment.id} did not follow its identity`,
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

  it('does not rewrite the date of an already hidden message', async () => {
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
    // The already hidden message does not count: the original decision date
    // matters, not the bulk action date.
    const touches = groupe.json<{ affected: number }>().affected;
    const inchange = (await file({ limit: 100, filter: 'hidden' })).comments.find(
      (comment) => comment.id === sien.id,
    )!;
    assert.equal(inchange.hiddenAt, date);
    assert.ok(touches >= 1, 'other messages from this identity were not hidden');

    await server.inject({
      method: 'POST',
      url: `/api/admin/commenters/${chef}/show`,
      headers: { cookie: adminCookie },
    });
  });

  it('returns 404 for an unknown identity rather than "0 messages affected"', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/admin/commenters/999999/hide',
      headers: { cookie: adminCookie },
    });
    assert.equal(response.statusCode, 404);
  });

  it('rejects a visitor bulk action with 403 rather than 404', async () => {
    const mamie = identites.get('mamie@exemple.fr')!;
    const response = await server.inject({
      method: 'POST',
      url: `/api/admin/commenters/${mamie}/hide`,
      headers: { cookie: familleCookie },
    });
    // The administration area is the only deliberate exception to 404 (D12).
    assert.equal(response.statusCode, 403);
  });
});
