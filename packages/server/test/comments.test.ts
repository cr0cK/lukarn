import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  ALL_ALBUMS,
  type AlbumCommentCounts,
  type Comment,
  type CommentsPage,
  type MediaDetail,
} from '@lukarn/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import { Mailer, type MailMessage } from '../src/mail.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Comments: isolation, depth, moderation and deletion rights.
 *
 * These tests cover invariants, not payload shapes. Isolation matters most: a
 * thread belongs to the (album, media) pair, and an inaccessible album must
 * remain indistinguishable from one that does not exist — including through
 * comments, which provide another read path to the same content.
 */

const PASSWORD = 'mot-de-passe-de-test';
const silencieux = { info: () => {}, warn: () => {}, debug: () => {} };
const root = mkdtempSync(join(tmpdir(), 'lukarn-comments-'));

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

/**
 * Declares an identity for this session and validates the received code.
 *
 * The API never returns the code: it is sent by email. The test therefore
 * retrieves it from the message captured by the fake transport, also verifying
 * that it was sent.
 */
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
  // The code is in the body, not the subject — see D65.
  const code = /\b(\d{6})\b/.exec(message.text)?.[1];
  assert.ok(code, `code not found in the body of message "${message.subject}"`);

  const verified = await server.inject({
    method: 'POST',
    url: '/api/identity/verify',
    headers: { cookie },
    payload: { email, code },
  });
  assert.equal(verified.statusCode, 200, verified.body);
}

/** Posts a comment and returns the created object after checking the status code. */
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
/** Captured messages: the test instance does not open an SMTP connection. */
const envoyes: MailMessage[] = [];

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

  // Without a transport, no code can be sent and nobody can comment: this is
  // the intended behaviour, but it would make these tests inert.
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

  context.config.createUser({
    username: 'alexis',
    passwordHash: hash,
    admin: true,
    albums: [ALL_ALBUMS],
  });
  // One access key for the whole household: this is the intended use, which is
  // why identity cannot come from the account.
  context.config.createUser({
    username: 'famille',
    passwordHash: hash,
    admin: false,
    albums: ['vacances'],
  });

  // The same Drive photo indexed in both albums: this is why thread isolation
  // is necessary.
  context.media.upsertMany(
    [media('vacances', 'photo-partagee'), media('prive', 'photo-partagee')],
    '2025-01-01T00:00:00.000Z',
  );

  adminCookie = await login('alexis');
  familleCookie = await login('famille');

  await identify(adminCookie, 'chef@exemple.fr', 'Alexis');
  await identify(familleCookie, 'mamie@exemple.fr', 'Mamie');
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('thread isolation', () => {
  it('separates conversations for one file indexed under two albums', async () => {
    await post(adminCookie, 'vacances', 'photo-partagee', 'Vu depuis les vacances');
    await post(adminCookie, 'prive', 'photo-partagee', 'Vu depuis le privé');

    const publique = await read(familleCookie, 'vacances', 'photo-partagee');
    assert.equal(publique.total, 1);
    assert.equal(publique.threads[0]!.root.body, 'Vu depuis les vacances');
  });

  it('returns 404 for an unassigned album thread as it does for a missing album', async () => {
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
    // Indistinguishable: that is the entire purpose of the 404 (D12).
    assert.deepEqual(interdit.json(), inexistant.json());
  });

  it('refuses to attach a reply to a thread from another album', async () => {
    const ailleurs = await post(adminCookie, 'prive', 'photo-partagee', 'Racine privée');

    const response = await server.inject({
      method: 'POST',
      url: '/api/comments/vacances/photo-partagee',
      headers: { cookie: familleCookie },
      payload: { body: 'Greffe interdite', parentId: ailleurs.id },
    });

    assert.equal(response.statusCode, 404);
  });

  it('rejects an anonymous comment', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/comments/vacances/photo-partagee',
      payload: { body: 'Bonjour' },
    });
    assert.equal(response.statusCode, 401);
  });
});

describe('depth limited to one level', () => {
  it('attaches a reply to a reply at the thread root', async () => {
    const racine = await post(adminCookie, 'vacances', 'photo-partagee', 'Racine');
    const reponse = await post(familleCookie, 'vacances', 'photo-partagee', 'Réponse', racine.id);
    // When replying to a reply, the server must move back to the root rather
    // than creating a second level.
    const petiteFille = await post(
      adminCookie,
      'vacances',
      'photo-partagee',
      'Réponse à la réponse',
      reponse.id,
    );

    assert.equal(reponse.parentId, racine.id);
    assert.equal(petiteFille.parentId, racine.id, 'a second level was created');

    const page = await read(adminCookie, 'vacances', 'photo-partagee');
    const thread = page.threads.find((entry) => entry.root.id === racine.id);
    assert.ok(thread);
    assert.equal(thread.replies.length, 2);
    assert.ok(thread.replies.every((reply) => reply.parentId === racine.id));
  });
});

describe('author identity', () => {
  it('signs with the declared name, not the shared access key', async () => {
    const parMamie = await post(familleCookie, 'vacances', 'photo-partagee', 'Signé');
    const parAdmin = await post(adminCookie, 'vacances', 'photo-partagee', 'Signé aussi');

    assert.equal(parMamie.author.displayName, 'Mamie');
    assert.equal(parAdmin.author.displayName, 'Alexis');
  });

  it('never exposes the email address in a thread', async () => {
    const page = await read(familleCookie, 'vacances', 'photo-partagee');
    // The address identifies and notifies; it must not circulate among the
    // thread's other readers.
    assert.ok(!JSON.stringify(page).includes('@exemple.fr'));
  });

  it('refuses comments until an identity is verified', async () => {
    const anonyme = await login('famille');
    const response = await server.inject({
      method: 'POST',
      url: '/api/comments/vacances/photo-partagee',
      headers: { cookie: anonyme },
      payload: { body: 'Sans identité' },
    });

    // 403, not 404: the refusal concerns the state of the user's own account,
    // not somebody else's resource whose existence must be hidden.
    assert.equal(response.statusCode, 403);
    assert.equal(response.json<{ error: string }>().error, 'identity_required');
  });

  it('recovers its comments after identifying again with the same address', async () => {
    const mien = await post(familleCookie, 'vacances', 'photo-partagee', 'À retrouver');

    // New device: fresh session, no identity.
    const autreAppareil = await login('famille');
    // The resend delay rejects a second code within a minute — desirable in
    // production, but it would make this test depend on a real wait.
    context.db
      .prepare("UPDATE commenters SET code_sent_at = '2020-01-01T00:00:00.000Z' WHERE email = ?")
      .run('mamie@exemple.fr');
    await identify(autreAppareil, 'mamie@exemple.fr', 'Mamie');

    const page = await read(autreAppareil, 'vacances', 'photo-partagee');
    const retrouve = page.threads.find((thread) => thread.root.id === mien.id);
    assert.ok(retrouve, 'the comment disappeared');
    // The address identifies the person: they retain control over their messages.
    assert.equal(retrouve.root.canDelete, true);
  });

  it('renames nobody until the code is validated', async () => {
    const signe = await post(familleCookie, 'vacances', 'photo-partagee', 'Écrit par Mamie');
    assert.equal(signe.author.displayName, 'Mamie');

    // Someone else behind the same shared key requests a code for Mamie's
    // address while declaring any name they choose. The code goes to her: they
    // will never see it.
    const usurpateur = await login('famille');
    context.db
      .prepare("UPDATE commenters SET code_sent_at = '2020-01-01T00:00:00.000Z' WHERE email = ?")
      .run('mamie@exemple.fr');
    const demande = await server.inject({
      method: 'POST',
      url: '/api/identity/request-code',
      headers: { cookie: usurpateur },
      payload: { email: 'mamie@exemple.fr', displayName: 'Sale gosse' },
    });
    assert.equal(demande.statusCode, 202, demande.body);

    // The signature is read on every request: if the request had written the
    // name, Mamie's entire history would already carry the impersonator's name.
    const page = await read(familleCookie, 'vacances', 'photo-partagee');
    const apres = page.threads.find((thread) => thread.root.id === signe.id);
    assert.equal(apres?.root.author.displayName, 'Mamie');
  });

  it('applies the new name once the code is validated', async () => {
    const avant = await post(familleCookie, 'vacances', 'photo-partagee', 'Avant le renommage');
    assert.equal(avant.author.displayName, 'Mamie');

    context.db
      .prepare("UPDATE commenters SET code_sent_at = '2020-01-01T00:00:00.000Z' WHERE email = ?")
      .run('mamie@exemple.fr');
    await identify(familleCookie, 'mamie@exemple.fr', 'Grand-mère');

    const page = await read(familleCookie, 'vacances', 'photo-partagee');
    const apres = page.threads.find((thread) => thread.root.id === avant.id);
    assert.equal(apres?.root.author.displayName, 'Grand-mère');

    // Restored: subsequent tests expect "Mamie".
    context.db
      .prepare("UPDATE commenters SET code_sent_at = '2020-01-01T00:00:00.000Z' WHERE email = ?")
      .run('mamie@exemple.fr');
    await identify(familleCookie, 'mamie@exemple.fr', 'Mamie');
  });
});

describe('deletion', () => {
  it('allows the author to delete their comment', async () => {
    const mien = await post(familleCookie, 'vacances', 'photo-partagee', 'À supprimer');

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/comments/${mien.id}`,
      headers: { cookie: familleCookie },
    });

    assert.equal(response.statusCode, 204);
    assert.equal(mien.canDelete, true);
  });

  it("returns 404 when deleting someone else's comment", async () => {
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

  it('allows an administrator to delete any comment', async () => {
    const dUnAutre = await post(familleCookie, 'vacances', 'photo-partagee', 'Supprimé par admin');

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/comments/${dUnAutre.id}`,
      headers: { cookie: adminCookie },
    });

    assert.equal(response.statusCode, 204);
  });
});

describe('moderation', () => {
  it('removes a hidden comment from reads, including for its author', async () => {
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
      'a hidden comment remains visible to its author',
    );

    // Once visible again, it returns — hiding is reversible, which distinguishes
    // moderation from deletion.
    await server.inject({
      method: 'POST',
      url: `/api/admin/comments/${gênant.id}/show`,
      headers: { cookie: adminCookie },
    });
    const revenu = await read(familleCookie, 'vacances', 'photo-partagee');
    assert.ok(revenu.threads.some((thread) => thread.root.id === gênant.id));
  });

  it('rejects visitor moderation with 403 rather than 404', async () => {
    const cible = await post(familleCookie, 'vacances', 'photo-partagee', 'Tentative');

    const response = await server.inject({
      method: 'POST',
      url: `/api/admin/comments/${cible.id}/hide`,
      headers: { cookie: familleCookie },
    });

    // The administration area is the only deliberate exception to 404 (D12).
    assert.equal(response.statusCode, 403);
  });

  it('promotes a reply to the thread root when its root is hidden', async () => {
    const racine = await post(adminCookie, 'vacances', 'photo-partagee', 'Racine à masquer');
    const reponse = await post(familleCookie, 'vacances', 'photo-partagee', 'Orpheline', racine.id);

    await server.inject({
      method: 'POST',
      url: `/api/admin/comments/${racine.id}/hide`,
      headers: { cookie: adminCookie },
    });

    const page = await read(familleCookie, 'vacances', 'photo-partagee');
    const promue = page.threads.find((thread) => thread.root.id === reponse.id);
    assert.ok(promue, 'the reply disappeared with its root');
    // It has become a root: its parent must no longer be reported.
    assert.equal(promue.root.parentId, null);
  });
});

describe('counter served with media details', () => {
  it('counts visible comments including replies and excluding hidden ones', async () => {
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

describe('editing within the window after publication', () => {
  async function patch(cookie: string, id: number, body: string) {
    return server.inject({
      method: 'PATCH',
      url: `/api/comments/${id}`,
      headers: { cookie },
      payload: { body },
    });
  }

  it('accepts an edit from its author', async () => {
    const publie = await post(familleCookie, 'vacances', 'photo-partagee', 'Boujour');
    const corrige = await patch(familleCookie, publie.id, 'Bonjour');

    assert.equal(corrige.statusCode, 200, corrige.body);
    assert.equal(corrige.json<Comment>().body, 'Bonjour');

    const page = await read(familleCookie, 'vacances', 'photo-partagee');
    const relu = page.threads.find((thread) => thread.root.id === publie.id);
    assert.equal(relu?.root.body, 'Bonjour');
    // The publication date does not change: the message must stay in place in a
    // thread that others may already be reading.
    assert.equal(relu?.root.createdAt, publie.createdAt);
  });

  it('rejects the edit once the window has elapsed and says why', async () => {
    // The window uses `created_at`: backdating the comment crosses it without
    // making the test wait thirty seconds.
    const vieux = await post(familleCookie, 'vacances', 'photo-partagee', 'Trop tard');
    context.db
      .prepare('UPDATE comments SET created_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', vieux.id);

    const tentative = await patch(familleCookie, vieux.id, 'Corrigé');

    // 409, not 404: the refusal concerns the message state, not access rights —
    // its author can already see it, so there is nothing to hide.
    assert.equal(tentative.statusCode, 409);
    assert.equal(tentative.json<{ error: string }>().error, 'edit_window_closed');

    const page = await read(familleCookie, 'vacances', 'photo-partagee');
    const inchange = page.threads.find((thread) => thread.root.id === vieux.id);
    assert.equal(inchange?.root.body, 'Trop tard');
    assert.equal(inchange?.root.canEdit, false);
  });

  it("rejects edits to someone else's comment", async () => {
    const dautrui = await post(adminCookie, 'vacances', 'photo-partagee', 'À moi');
    const tentative = await patch(familleCookie, dautrui.id, 'Volé');

    // 404, not 403: nothing must distinguish "not yours" from "does not exist".
    assert.equal(tentative.statusCode, 404);

    const page = await read(adminCookie, 'vacances', 'photo-partagee');
    assert.ok(
      page.threads.some((thread) => thread.root.body === 'À moi'),
      'the comment was rewritten by somebody else',
    );
  });

  it('gives the administrator no rewriting privilege', async () => {
    // Moderation means hiding or deleting. Putting different words under
    // somebody's name is a different kind of power.
    const deMamie = await post(familleCookie, 'vacances', 'photo-partagee', 'Mot de Mamie');
    const tentative = await patch(adminCookie, deMamie.id, 'Mot réécrit');

    assert.equal(tentative.statusCode, 404);
  });

  it('rejects an empty body', async () => {
    const publie = await post(familleCookie, 'vacances', 'photo-partagee', 'Quelque chose');
    const vide = await patch(familleCookie, publie.id, '   ');

    assert.equal(vide.statusCode, 400);
  });

  it("does not advertise editing on someone else's message", async () => {
    const deMamie = await post(familleCookie, 'vacances', 'photo-partagee', 'Frais');
    const vuParAlexis = await read(adminCookie, 'vacances', 'photo-partagee');
    const trouve = vuParAlexis.threads.find((thread) => thread.root.id === deMamie.id);

    assert.equal(trouve?.root.canEdit, false);
    // It may still delete it: the two rights are distinct.
    assert.equal(trouve?.root.canDelete, true);
  });
});

describe('whole-album counters', () => {
  async function counts(cookie: string, albumId: string): Promise<AlbumCommentCounts> {
    const response = await server.inject({
      method: 'GET',
      url: `/api/comments/${albumId}`,
      headers: { cookie },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json<AlbumCommentCounts>();
  }

  it('matches the thread for each photo', async () => {
    const page = await read(familleCookie, 'vacances', 'photo-partagee');
    const groupe = await counts(familleCookie, 'vacances');

    // The invariant that matters: the badge and the thread cannot diverge,
    // otherwise comments are announced that the panel does not show.
    assert.equal(groupe.counts['photo-partagee'], page.total);
  });

  it('does not expose comments from an inaccessible album', async () => {
    // `photo-partagee` is indexed in both albums: if isolation failed here, the
    // private album count would leak under the same key.
    const groupe = await counts(familleCookie, 'vacances');
    const prive = await read(adminCookie, 'prive', 'photo-partagee');

    assert.ok(prive.total > 0, 'the private thread is empty, so the test proves nothing');
    assert.notEqual(groupe.counts['photo-partagee'], prive.total);

    const refus = await server.inject({
      method: 'GET',
      url: '/api/comments/prive',
      headers: { cookie: familleCookie },
    });
    assert.equal(refus.statusCode, 404);
  });

  it('omits photos without comments', async () => {
    context.media.upsertMany([media('vacances', 'photo-muette')], '2025-01-01T00:00:00.000Z');

    const groupe = await counts(familleCookie, 'vacances');
    assert.equal(groupe.counts['photo-muette'], undefined);
  });

  it('allows unsubscribe through despite the parameterised route', async () => {
    // `/:albumId` and `/unsubscribe` share the same prefix. If the parameter
    // took precedence, links in emails already sent would return 401 —
    // impossible to remedy once the messages have gone out.
    const response = await server.inject({ method: 'GET', url: '/api/comments/unsubscribe' });
    assert.equal(response.statusCode, 400, 'the route without a session is no longer reached');
  });
});
