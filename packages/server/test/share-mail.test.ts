import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import type { MailMessage } from '../src/mail.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * What reaches the inbox of somebody who commented through a link.
 *
 * The four surfaces D260825e enumerates — the page, the address they were sent, the
 * addresses their requests use, the mail carrying their code — are held by
 * `shares.test.ts`. This file holds the fifth thing the decision names and the one
 * that arrives days later: **anything sent to them afterwards**. A reply
 * notification is the only message this application composes for a link's
 * recipient, and the album it must not name is the album its ordinary address is
 * built from.
 */

const root = mkdtempSync(join(tmpdir(), 'lukarn-share-mail-'));

const env = loadEnv({
  NODE_ENV: 'test',
  SESSION_SECRET: 's'.repeat(48),
  TOKEN_KEY: 't'.repeat(48),
  PUBLIC_URL: 'https://photos.exemple.fr',
  CONFIG_PATH: join(root, 'absent.yaml'),
  DATA_DIR: join(root, 'data'),
  CACHE_DIR: join(root, 'cache'),
  WEB_DIR: join(root, 'web'),
  SMTP_URL: 'smtp://127.0.0.1:1',
  MAIL_FROM: 'Lukarn <galerie@exemple.fr>',
  LOG_LEVEL: 'fatal',
} as NodeJS.ProcessEnv);

const PASSWORD = 'mot-de-passe-de-test';
const ALBUM_TITLE = 'Corse en août';

let server: FastifyInstance;
let context: AppContext;
/** Every message the mailer was handed, in place of an SMTP server. */
let sent: MailMessage[];

function photo(id: string): MediaUpsert {
  return {
    albumId: 'corse',
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
    sourcePath: null,
  };
}

/** A verified person, and the session identifier a link opened for them. */
function identify(token: string, email: string, name: string): number {
  const commenter = context.commenters.declare(email, name);
  context.commenters.markVerified(email);
  const session = context.db
    .prepare('SELECT id FROM sessions WHERE share_token = ?')
    .get(token) as { id: string };
  context.sessions.attachCommenter(session.id, commenter.id);
  return commenter.id;
}

/** Opens a link and returns its cookie. */
async function open(token: string): Promise<string> {
  const response = await server.inject({ method: 'GET', url: `/api/share/${token}` });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = response.cookies.find((entry) => entry.name === 'lukarn_session');
  assert.ok(cookie);
  return `lukarn_session=${cookie.value}`;
}

before(async () => {
  const built = await buildApp(env);
  server = built.server;
  context = built.context;

  context.config.createAlbum({ id: 'corse', title: ALBUM_TITLE, folderId: 'f1', recursive: true });
  context.config.createUser({
    username: 'patron',
    passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    admin: true,
    albums: ['corse'],
  });
  context.media.upsertMany([photo('img-1')], '2026-07-01T00:00:00.000Z');

  // The queue is never drained against a real relay: what this file asserts is what
  // was composed, and `Mailer.queue` is the last place that is still true.
  sent = [];
  const mailer = context.mailer as unknown as { queue(message: MailMessage): void };
  mailer.queue = (message: MailMessage): void => void sent.push(message);
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('a reply to somebody who commented through a photograph link', () => {
  /** Writes a comment through a live link and returns its identifier. */
  async function commentThrough(token: string): Promise<number> {
    const cookie = await open(token);
    identify(token, `${token.slice(0, 8)}@exemple.fr`, 'Tante');

    const written = await server.inject({
      method: 'POST',
      url: `/api/share/${token}/comments/img-1`,
      headers: { cookie },
      payload: { body: 'Elle est très belle' },
    });
    assert.equal(written.statusCode, 201, written.body);
    return (written.json() as { id: number }).id;
  }

  /**
   * Has the owner reply, and returns the message composed for the link's recipient.
   *
   * The reply goes through the **album** path, which is where it comes from in
   * practice: the person who issued the link is reading the thread from their own
   * gallery.
   */
  async function replyTo(token: string, parentId: number): Promise<MailMessage> {
    const owner =
      context.commenters.byEmail('patron@exemple.fr') ??
      context.commenters.declare('patron@exemple.fr', 'Patron');
    context.commenters.markVerified('patron@exemple.fr');
    const login = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'patron', password: PASSWORD },
    });
    const session = login.cookies.find((entry) => entry.name === 'lukarn_session')!;
    const sessionRow = context.db
      .prepare('SELECT id FROM sessions WHERE username = ? ORDER BY created_at DESC')
      .get('patron') as { id: string };
    context.sessions.attachCommenter(sessionRow.id, owner.id);

    sent = [];
    const reply = await server.inject({
      method: 'POST',
      url: '/api/comments/corse/img-1',
      headers: { cookie: `lukarn_session=${session.value}` },
      payload: { body: 'Merci !', parentId },
    });
    assert.equal(reply.statusCode, 201, reply.body);

    const message = sent.find((entry) => entry.to.startsWith(token.slice(0, 8)));
    assert.ok(message, 'the link recipient was written to');
    return message;
  }

  it('opens at the link and never names the album, live', async () => {
    const token = context.shares.create({
      albumId: 'corse',
      mediaId: 'img-1',
      label: null,
      createdBy: 'patron',
      expiresAt: null,
    }).token;

    const message = await replyTo(token, await commentThrough(token));

    assert.match(message.text, new RegExp(`/s/${token}`));
    assert.ok(!message.text.includes('/album/corse'));
    assert.ok(!message.text.includes(ALBUM_TITLE));
    assert.ok(!message.html.includes(ALBUM_TITLE));
    // The photograph is still named: it is what they were sent.
    assert.match(message.text, /img-1\.jpg/);
  });

  it('still opens at the link, and still hides the album, once revoked', async () => {
    const token = context.shares.create({
      albumId: 'corse',
      mediaId: 'img-1',
      label: null,
      createdBy: 'patron',
      expiresAt: null,
    }).token;

    const parentId = await commentThrough(token);
    context.shares.revoke(token);

    // Composed **after** revocation, which is the case under test: the recipient
    // stops being able to open anything, and a fallback to the album address would
    // answer them with a 404 and spell out the album on the way. `/s/<token>` says
    // it was taken back and says nothing else (D260825b, D260825e).
    const message = await replyTo(token, parentId);
    assert.match(message.text, new RegExp(`/s/${token}`));
    assert.ok(!message.text.includes('/album/corse'));
    assert.ok(!message.text.includes(ALBUM_TITLE));
    assert.ok(!message.html.includes(ALBUM_TITLE));
  });

  it('still hides the album once the link has been deleted outright', async () => {
    const token = context.shares.create({
      albumId: 'corse',
      mediaId: 'img-1',
      label: null,
      createdBy: 'patron',
      expiresAt: null,
    }).token;

    const parentId = await commentThrough(token);
    // Deleting takes the row and the openings; the comment stays, which is what
    // `comments.account` carrying no foreign key is for. Nothing is left to look the
    // credential up in, and the album must still not appear.
    context.shares.remove(token);

    const message = await replyTo(token, parentId);
    assert.match(message.text, new RegExp(`/s/${token}`));
    assert.ok(!message.text.includes('/album/corse'));
    assert.ok(!message.text.includes(ALBUM_TITLE));
    assert.ok(!message.html.includes(ALBUM_TITLE));
  });

  it('names the album for a shared album, which its recipient already reads', async () => {
    const token = context.shares.create({
      albumId: 'corse',
      mediaId: null,
      label: null,
      createdBy: 'patron',
      expiresAt: null,
    }).token;

    const message = await replyTo(token, await commentThrough(token));

    // They were sent the album and its title is on their page; what they must not
    // get is `/album/<id>`, which their session answers 404 for.
    assert.match(message.text, new RegExp(`/s/${token}`));
    assert.ok(!message.text.includes('/album/corse'));
    assert.match(message.text, new RegExp(ALBUM_TITLE));
  });
});
