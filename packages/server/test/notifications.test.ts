import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { CommentRepo } from '../src/comments.js';
import { CommenterRepo } from '../src/commenters.js';
import { ConfigRepo } from '../src/config-repo.js';
import { signUnsubscribeToken, verifyUnsubscribeToken } from '../src/crypto.js';
import { migrate } from '../src/db.js';
import { loadEnv } from '../src/env.js';
import { Mailer, buildCommentMail, buildVerificationMail, type MailMessage } from '../src/mail.js';
import { VerificationCodeRepo } from '../src/verification-codes.js';

/**
 * Commenter identity, code verification and notification recipients.
 *
 * The recipient rule is simple: moderation is notified of every new comment,
 * a thread author is notified of replies, and nobody is notified of what they
 * just wrote.
 */

const root = mkdtempSync(join(tmpdir(), 'lukarn-notif-'));

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

let db: Database.Database;
let comments: CommentRepo;
let commenters: CommenterRepo;
let codes: VerificationCodeRepo;
let config: ConfigRepo;

/**
 * Identity verified immediately: the code path lives in
 * `packages/server/test/verification-codes.test.ts`.
 */
function identiteVerifiee(email: string, nom: string): number {
  commenters.declare(email, nom);
  const verified = commenters.markVerified(email);
  assert.ok(verified);
  return verified.id;
}

before(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);

  config = new ConfigRepo(db);
  comments = new CommentRepo(db);
  commenters = new CommenterRepo(db);
  codes = new VerificationCodeRepo(db, env.sessionSecret);

  config.createAlbum({ id: 'vacances', title: 'Vacances', folderId: 'f', recursive: true });
  // One access key shared by the household: identity, not the account,
  // distinguishes people.
  config.createUser({ username: 'famille', passwordHash: 'x', admin: false, albums: ['vacances'] });
});

after(() => {
  db?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('address verification', () => {
  it('marks the address verified once its code is checked', () => {
    const asked = codes.mint('papi@exemple.fr', 'identity');
    assert.ok('code' in asked);
    const declared = commenters.declare('papi@exemple.fr', 'Papi');
    assert.equal(declared.verifiedAt, null, 'verified before entering the code');

    assert.deepEqual(codes.check('papi@exemple.fr', 'identity', '000000'), {
      failure: 'mismatch',
    });
    assert.ok('row' in codes.check('papi@exemple.fr', 'identity', asked.code));

    const verified = commenters.markVerified('papi@exemple.fr');
    assert.ok(verified?.verifiedAt);
  });

  it('recognises the same person regardless of address case', () => {
    const premier = identiteVerifiee('Nadine@Exemple.FR', 'Nadine');
    assert.equal(commenters.byEmail('nadine@exemple.fr')?.id, premier);
  });

  it('renames a verified identity only once the code is checked', () => {
    const id = identiteVerifiee('rename@exemple.fr', 'Mamie');

    // Declaring another name writes nothing visible: knowing an address would
    // otherwise be enough to rename somebody, and a comment signature is reread
    // on every request (D42).
    commenters.declare('rename@exemple.fr', 'Sale gosse');
    assert.equal(commenters.byId(id)?.displayName, 'Mamie');

    assert.equal(commenters.markVerified('rename@exemple.fr')?.displayName, 'Sale gosse');
  });
});

describe('recipient selection', () => {
  let mamie: number;
  let papi: number;

  // Identities are created once: resend protection would reject a second code
  // within a minute, which is precisely its job.
  before(() => {
    mamie = identiteVerifiee('mamie@exemple.fr', 'Mamie');
    papi = identiteVerifiee('papi2@exemple.fr', 'Papi');
  });

  beforeEach(() => {
    db.prepare('DELETE FROM comments').run();
  });

  it('notifies nobody but moderation of a new thread', () => {
    const racine = comments.create({
      albumId: 'vacances',
      mediaId: 'photo-1',
      commenterId: mamie,
      account: 'famille',
      body: 'Quelle belle journée',
      parentId: null,
    });

    // A new thread replies to nobody; only moderation is concerned, and its
    // address comes from settings rather than this table.
    assert.equal(commenters.recipientForReply(racine.id, mamie), null);
  });

  it('notifies the thread author when somebody replies', () => {
    const racine = comments.create({
      albumId: 'vacances',
      mediaId: 'photo-2',
      commenterId: mamie,
      account: 'famille',
      body: 'Qui est sur la photo ?',
      parentId: null,
    });

    assert.equal(commenters.recipientForReply(racine.id, papi)?.email, 'mamie@exemple.fr');
  });

  it('never notifies somebody of their own reply', () => {
    const racine = comments.create({
      albumId: 'vacances',
      mediaId: 'photo-3',
      commenterId: mamie,
      account: 'famille',
      body: 'Je me réponds',
      parentId: null,
    });

    // Receiving email for what one just wrote is the quickest way to make
    // people disable notifications.
    assert.equal(commenters.recipientForReply(racine.id, mamie), null);
  });

  it('does not email an unsubscribed identity', () => {
    const racine = comments.create({
      albumId: 'vacances',
      mediaId: 'photo-4',
      commenterId: mamie,
      account: 'famille',
      body: 'Encore une',
      parentId: null,
    });

    commenters.setNotify(mamie, false);
    assert.equal(commenters.recipientForReply(racine.id, papi), null);
    commenters.setNotify(mamie, true);
  });
});

describe('unsubscribe token', () => {
  it('accepts the address token and rejects another address token', () => {
    const jeton = signUnsubscribeToken('mamie@exemple.fr', env.sessionSecret);

    assert.ok(verifyUnsubscribeToken('mamie@exemple.fr', jeton, env.sessionSecret));
    assert.ok(!verifyUnsubscribeToken('papi2@exemple.fr', jeton, env.sessionSecret));
    // Case-insensitive, like the address itself.
    assert.ok(verifyUnsubscribeToken('Mamie@Exemple.fr', jeton, env.sessionSecret));
  });

  it('rejects a truncated token without throwing', () => {
    const jeton = signUnsubscribeToken('mamie@exemple.fr', env.sessionSecret);
    assert.doesNotThrow(() =>
      verifyUnsubscribeToken('mamie@exemple.fr', jeton.slice(0, 10), env.sessionSecret),
    );
    assert.ok(!verifyUnsubscribeToken('mamie@exemple.fr', jeton.slice(0, 10), env.sessionSecret));
  });
});

describe('message composition', () => {
  const notification = {
    albumId: 'vacances',
    albumTitle: 'Vacances',
    mediaId: 'photo-5',
    mediaName: 'IMG_0042.jpg',
    authorDisplayName: 'Mamie',
    body: 'Coucou',
  };

  it('links to the commented photo and escapes the body in HTML', () => {
    const message = buildCommentMail(
      { ...notification, body: '<script>alert(1)</script>' },
      { email: 'papi2@exemple.fr', reason: 'reply', share: null, locale: 'en' },
      'Chez les Martin',
      env,
    );

    assert.match(message.html, /photos\.exemple\.fr\/album\/vacances\?photo=photo-5/);
    // A visitor enters the body: it must never become markup in the recipient's
    // email client.
    assert.ok(!message.html.includes('<script>'));
    assert.match(message.html, /&lt;script&gt;/);
    // Plain text does not need escaping.
    assert.match(message.text, /<script>/);
  });

  it('adds an unsubscribe link only for a person', () => {
    const versAuteur = buildCommentMail(
      notification,
      { email: 'papi2@exemple.fr', reason: 'reply', share: null, locale: 'en' },
      'Chez les Martin',
      env,
    );
    const versModeration = buildCommentMail(
      notification,
      { email: 'moderation@exemple.fr', reason: 'moderation', share: null, locale: 'en' },
      'Chez les Martin',
      env,
    );

    assert.match(versAuteur.subject, /replied to your comment/);
    assert.match(versAuteur.text, /unsubscribe\?u=papi2%40exemple\.fr/);

    assert.match(versModeration.subject, /commented on a photo/);
    // The moderation address is not an identity: it is removed from /admin, not
    // through a link that would disable instance alerts.
    assert.ok(!versModeration.text.includes('unsubscribe'));
  });

  it('writes to a link recipient at their link, and names the album only when they hold one', () => {
    const album = buildCommentMail(
      notification,
      {
        email: 'mamie@exemple.fr',
        reason: 'reply',
        share: { token: 'jeton-album', namesAlbum: true },
        locale: 'en',
      },
      'Chez les Martin',
      env,
    );
    const photo = buildCommentMail(
      notification,
      {
        email: 'tante@exemple.fr',
        reason: 'reply',
        share: { token: 'jeton-photo', namesAlbum: false },
        locale: 'en',
      },
      'Chez les Martin',
      env,
    );

    // `/album/<id>` answers 404 to a link's session, so the ordinary address opens
    // nothing for the one recipient this message was written for.
    for (const message of [album, photo]) {
      assert.ok(!message.text.includes('/album/vacances'));
      assert.match(message.text, /\/s\/jeton-/);
    }

    // A shared album's recipient was sent the album and reads its title on their
    // page; a shared photograph's recipient must not meet it anywhere, and that
    // includes what is sent to them afterwards (D260825e).
    assert.match(album.text, /Vacances/);
    assert.ok(!photo.text.includes('Vacances'));
    assert.ok(!photo.html.includes('Vacances'));
    // The photograph itself is still named: it is what they were sent.
    assert.match(photo.text, /IMG_0042\.jpg/);
  });

  it('still keeps the album out of a deleted photograph link', () => {
    // Deleting a link removes its row, and the comment it carried stays — that is
    // what `comments.account` having no foreign key is for. Falling back to the
    // album address here would spell out, for the recipient of one photograph, the
    // name they were never sent (D260825e). `/s/<token>` answers 404 now, which is
    // what deleting means, and 404 says nothing.
    const message = buildCommentMail(
      notification,
      {
        email: 'tante@exemple.fr',
        reason: 'reply',
        share: { token: 'jeton-supprime', namesAlbum: false },
        locale: 'en',
      },
      'Chez les Martin',
      env,
    );

    assert.ok(!message.text.includes('Vacances'));
    assert.ok(!message.html.includes('Vacances'));
    assert.ok(!message.text.includes('/album/vacances'));
  });

  it('keeps the verification code out of the subject, which names the instance', () => {
    const message = buildVerificationMail(
      'mamie@exemple.fr',
      'Mamie',
      '123456',
      'en',
      'Chez les Martin',
      env,
    );
    // A subject code can be read over a shoulder and remains visible in
    // notification history; the host instead explains why the email arrived.
    assert.ok(!message.subject.includes('123456'));
    assert.match(message.subject, /photos\.exemple\.fr/);
    assert.match(message.text, /123456/);
    assert.match(message.html, /123456/);
  });

  it('names the instance in both body versions', () => {
    const message = buildVerificationMail(
      'mamie@exemple.fr',
      'Mamie',
      '123456',
      'en',
      'Chez les Martin',
      env,
    );
    // HTML had diverged from text, which alone named the instance — and the
    // recipient sees HTML.
    assert.match(message.text, /photos\.exemple\.fr/);
    assert.match(message.html, /photos\.exemple\.fr/);
  });

  it('does not group the code, which cannot be pasted into the field', () => {
    const message = buildVerificationMail(
      'mamie@exemple.fr',
      'Mamie',
      '123456',
      'en',
      'Chez les Martin',
      env,
    );
    // `verify` requires six characters after trim(): pasted "123 456" is rejected.
    assert.ok(!message.text.includes('123 456'));
    assert.ok(!message.html.includes('123 456'));
  });

  it('offers no clickable link in the code email', () => {
    const message = buildVerificationMail(
      'mamie@exemple.fr',
      'Mamie',
      '123456',
      'en',
      'Chez les Martin',
      env,
    );
    // A link would open a second session in another browser while the code is
    // expected in the tab left open.
    assert.ok(!message.html.includes('<a '));
  });
});

describe('sending', () => {
  it('sends nothing when SMTP is not configured', async () => {
    const mailer = new Mailer(null, silencieux);
    assert.equal(mailer.enabled, false);
    // Does not throw: callers need not inspect configuration.
    mailer.queue({ to: 'a@b.fr', subject: 's', text: 't', html: '<p>t</p>' });
    await mailer.drain();
  });

  it('absorbs a send failure and continues the queue', async () => {
    const envoyes: MailMessage[] = [];
    const mailer = new Mailer(async (message) => {
      if (message.to === 'casse@exemple.fr') throw new Error('relais injoignable');
      envoyes.push(message);
    }, silencieux);

    mailer.queue({ to: 'casse@exemple.fr', subject: 's', text: 't', html: '<p>t</p>' });
    mailer.queue({ to: 'ok@exemple.fr', subject: 's', text: 't', html: '<p>t</p>' });

    // An unhandled background rejection would terminate the process: the second
    // message must be sent despite the first failing.
    await mailer.drain();
    assert.deepEqual(
      envoyes.map((message) => message.to),
      ['ok@exemple.fr'],
    );
  });
});
