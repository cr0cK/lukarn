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
let config: ConfigRepo;

/** Identity verified immediately: the code path is tested separately. */
function identiteVerifiee(email: string, nom: string): number {
  const asked = commenters.requestCode(email, nom);
  assert.ok('code' in asked);
  const verified = commenters.verify(email, asked.code);
  assert.ok('commenter' in verified);
  return verified.commenter.id;
}

before(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);

  config = new ConfigRepo(db);
  comments = new CommentRepo(db);
  commenters = new CommenterRepo(db, env.sessionSecret);

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
  it('rejects a wrong code and accepts the right one', () => {
    const asked = commenters.requestCode('papi@exemple.fr', 'Papi');
    assert.ok('code' in asked);
    assert.equal(asked.commenter.verifiedAt, null, 'verified before entering the code');

    assert.deepEqual(commenters.verify('papi@exemple.fr', '000000'), { failure: 'mismatch' });

    const ok = commenters.verify('papi@exemple.fr', asked.code);
    assert.ok('commenter' in ok);
    assert.ok(ok.commenter.verifiedAt);
  });

  it('exhausts the code after five attempts', () => {
    const asked = commenters.requestCode('brute@exemple.fr', 'Brute');
    assert.ok('code' in asked);

    for (let essai = 0; essai < 5; essai++) {
      assert.deepEqual(commenters.verify('brute@exemple.fr', '000000'), { failure: 'mismatch' });
    }

    // Even the right code no longer works: six digits take a million attempts
    // to exhaust, so without a limit verification would verify nothing.
    assert.deepEqual(commenters.verify('brute@exemple.fr', asked.code), {
      failure: 'too_many_attempts',
    });
  });

  it('refuses to resend a code within a minute', () => {
    commenters.requestCode('spam@exemple.fr', 'Spam');
    const second = commenters.requestCode('spam@exemple.fr', 'Spam');
    // Without this delay, the form would send bursts of email to an address the
    // requester does not own.
    assert.ok('failure' in second);
    assert.equal(second.failure, 'too_soon');
  });

  it('recognises the same person regardless of address case', () => {
    const premier = identiteVerifiee('Nadine@Exemple.FR', 'Nadine');
    assert.equal(commenters.byEmail('nadine@exemple.fr')?.id, premier);
  });

  it('never stores the code in plaintext', () => {
    const asked = commenters.requestCode('secret@exemple.fr', 'Secret');
    assert.ok('code' in asked);
    const row = db
      .prepare('SELECT code_hash FROM commenters WHERE email = ?')
      .get('secret@exemple.fr') as { code_hash: string };
    // A database dump must not provide enough to verify an address.
    assert.ok(!row.code_hash.includes(asked.code));
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
      { email: 'papi2@exemple.fr', reason: 'reply', locale: 'en' },
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
      { email: 'papi2@exemple.fr', reason: 'reply', locale: 'en' },
      env,
    );
    const versModeration = buildCommentMail(
      notification,
      { email: 'moderation@exemple.fr', reason: 'moderation', locale: 'en' },
      env,
    );

    assert.match(versAuteur.subject, /replied to your comment/);
    assert.match(versAuteur.text, /unsubscribe\?u=papi2%40exemple\.fr/);

    assert.match(versModeration.subject, /commented on a photo/);
    // The moderation address is not an identity: it is removed from /admin, not
    // through a link that would disable instance alerts.
    assert.ok(!versModeration.text.includes('unsubscribe'));
  });

  it('keeps the verification code out of the subject, which names the instance', () => {
    const message = buildVerificationMail('mamie@exemple.fr', 'Mamie', '123456', 'en', env);
    // A subject code can be read over a shoulder and remains visible in
    // notification history; the host instead explains why the email arrived.
    assert.ok(!message.subject.includes('123456'));
    assert.match(message.subject, /photos\.exemple\.fr/);
    assert.match(message.text, /123456/);
    assert.match(message.html, /123456/);
  });

  it('names the instance in both body versions', () => {
    const message = buildVerificationMail('mamie@exemple.fr', 'Mamie', '123456', 'en', env);
    // HTML had diverged from text, which alone named the instance — and the
    // recipient sees HTML.
    assert.match(message.text, /photos\.exemple\.fr/);
    assert.match(message.html, /photos\.exemple\.fr/);
  });

  it('does not group the code, which cannot be pasted into the field', () => {
    const message = buildVerificationMail('mamie@exemple.fr', 'Mamie', '123456', 'en', env);
    // `verify` requires six characters after trim(): pasted "123 456" is rejected.
    assert.ok(!message.text.includes('123 456'));
    assert.ok(!message.html.includes('123 456'));
  });

  it('offers no clickable link in the code email', () => {
    const message = buildVerificationMail('mamie@exemple.fr', 'Mamie', '123456', 'en', env);
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
