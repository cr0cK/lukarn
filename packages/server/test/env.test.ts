import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { loadEnv } from '../src/env.js';

/**
 * Environment checks at startup.
 *
 * This verifies one idea: faulty configuration must prevent startup, not
 * produce a running instance that fails weeks later when the misread setting
 * is first used.
 */

const root = mkdtempSync(join(tmpdir(), 'lukarn-env-'));
after(() => rmSync(root, { recursive: true, force: true }));

function env(surcharges: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    SESSION_SECRET: 's'.repeat(48),
    TOKEN_KEY: 'k'.repeat(48),
    CONFIG_PATH: join(root, 'albums.yaml'),
    DATA_DIR: join(root, 'data'),
    CACHE_DIR: join(root, 'cache'),
    WEB_DIR: join(root, 'web'),
    ...surcharges,
  } as NodeJS.ProcessEnv;
}

function avecSmtp(url: string): NodeJS.ProcessEnv {
  return env({ SMTP_URL: url, MAIL_FROM: 'Galerie <galerie@exemple.fr>' });
}

describe('SMTP_URL', () => {
  it('accepts a Gmail URL with the address encoded', () => {
    const config = loadEnv(avecSmtp('smtps://moi%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465'));
    assert.equal(
      config.mail?.smtpUrl,
      'smtps://moi%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465',
    );
  });

  it('accepts a local relay without credentials', () => {
    assert.ok(loadEnv(avecSmtp('smtp://localhost:1025')).mail);
    // A service name on a Docker network has no dot, and that is legitimate.
    assert.ok(loadEnv(avecSmtp('smtp://mailpit:1025')).mail);
  });

  it('rejects a password containing a character that breaks the address', () => {
    // The costly case: nodemailer then builds a transport to host "user",
    // without authentication, and the instance starts normally. The failure
    // appears only on the first send, weeks later.
    for (const motDePasse of ['a/b', 'a?b', 'a#b']) {
      assert.throws(
        () => loadEnv(avecSmtp(`smtp://user:${motDePasse}@smtp.exemple.fr:587`)),
        /SMTP_URL is not a valid URL/,
        `"${motDePasse}" must be rejected`,
      );
    }
  });

  it('allows values that break nothing', () => {
    // A check that raises false alarms is eventually bypassed: `+`, `:` and a
    // space are perfectly readable in a password.
    for (const motDePasse of ['a+b', 'a:b', 'a b']) {
      assert.ok(
        loadEnv(avecSmtp(`smtp://user:${motDePasse}@smtp.exemple.fr:587`)).mail,
        `"${motDePasse}" must be accepted`,
      );
    }
  });

  it('rejects a scheme that is not SMTP', () => {
    assert.throws(
      () => loadEnv(avecSmtp('https://smtp.exemple.fr:587')),
      /"smtp:\/\/" or "smtps:\/\/"/,
    );
  });

  it('requires MAIL_FROM with SMTP_URL and vice versa', () => {
    assert.throws(() => loadEnv(env({ SMTP_URL: 'smtp://localhost:1025' })), /together/);
    assert.throws(() => loadEnv(env({ MAIL_FROM: 'Galerie <galerie@exemple.fr>' })), /together/);
  });

  it('requires nothing when the instance sends no email', () => {
    assert.equal(loadEnv(env()).mail, null);
  });
});

describe('MAIL_REPLY_TO', () => {
  it('remains optional and treats empty as absent', () => {
    // The distinction matters: `null` sets no header, while an empty header
    // would make the email client fall back to the sender address — precisely
    // the one that receives nothing.
    assert.equal(loadEnv(avecSmtp('smtp://localhost:1025')).mailReplyTo, null);
    assert.equal(
      loadEnv(env({ ...avecSmtp('smtp://localhost:1025'), MAIL_REPLY_TO: '   ' })).mailReplyTo,
      null,
    );
  });

  it('does not need to be declared with MAIL_FROM', () => {
    // Unlike SMTP_URL and MAIL_FROM: forcing the pair would require every live
    // instance to declare an address it does not have.
    const config = loadEnv(
      env({ ...avecSmtp('smtp://localhost:1025'), MAIL_REPLY_TO: 'moi@exemple.fr' }),
    );
    assert.equal(config.mail?.from, 'Galerie <galerie@exemple.fr>');
    assert.equal(config.mailReplyTo, 'moi@exemple.fr');
  });

  it('survives a disabled relay so the problem can be reported', () => {
    // It deliberately lives outside `mail`: this lets the Mailer warn that a
    // reply address is configured while nothing can be sent.
    const config = loadEnv(env({ MAIL_REPLY_TO: 'moi@exemple.fr' }));
    assert.equal(config.mail, null);
    assert.equal(config.mailReplyTo, 'moi@exemple.fr');
  });
});

describe('address shape', () => {
  it('rejects values that reveal a typo', () => {
    // All these values enter the header as-is: the relay rejects or rewrites
    // them weeks after deployment, with nothing tying the failure to a .env line.
    for (const valeur of [
      'Galerie <galerie@exemple.fr', // unclosed angle bracket
      'galerie(at)exemple.fr', // no at sign
      'galerie@', // no domain
      '@exemple.fr', // no local part
      'a@b c@d', // two addresses
      'Galerie',
    ]) {
      assert.throws(
        () => loadEnv(env({ SMTP_URL: 'smtp://localhost:1025', MAIL_FROM: valeur })),
        /MAIL_FROM carries no usable email address/,
        `"${valeur}" must be rejected`,
      );
      assert.throws(
        () => loadEnv(env({ ...avecSmtp('smtp://localhost:1025'), MAIL_REPLY_TO: valeur })),
        /MAIL_REPLY_TO carries no usable email address/,
        `"${valeur}" must be rejected`,
      );
    }
  });

  it('allows legitimate forms', () => {
    // A check that raises false alarms is eventually bypassed: the display name,
    // sub-addressing "+" and the local relay are all valid.
    for (const valeur of [
      'galerie@exemple.fr',
      'Galerie <galerie@exemple.fr>',
      '"Galerie Photos" <galerie@exemple.fr>',
      'prenom.nom+galerie@gmail.com',
      'galerie@localhost',
    ]) {
      assert.ok(
        loadEnv(env({ SMTP_URL: 'smtp://localhost:1025', MAIL_FROM: valeur })).mail,
        `"${valeur}" must be accepted`,
      );
    }
  });
});
