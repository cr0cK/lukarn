import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { loadEnv } from '../src/env.js';
import { Mailer } from '../src/mail.js';

/**
 * Transport warnings at startup.
 *
 * These checks do not prevent the instance from running: they cover valid but
 * ineffective configurations that would otherwise be noticed only when a
 * long-forgotten expected reply never arrives.
 */

const root = mkdtempSync(join(tmpdir(), 'nonni-mail-'));
after(() => rmSync(root, { recursive: true, force: true }));

function journal() {
  const avertissements: string[] = [];
  return {
    avertissements,
    log: {
      info: () => {},
      debug: () => {},
      warn: (message: string) => avertissements.push(message),
    },
  };
}

function config(surcharges: Record<string, string | undefined> = {}) {
  return loadEnv({
    NODE_ENV: 'test',
    SESSION_SECRET: 's'.repeat(48),
    TOKEN_KEY: 'k'.repeat(48),
    CONFIG_PATH: join(root, 'albums.yaml'),
    DATA_DIR: join(root, 'data'),
    CACHE_DIR: join(root, 'cache'),
    WEB_DIR: join(root, 'web'),
    ...surcharges,
  } as NodeJS.ProcessEnv);
}

const RELAIS = { SMTP_URL: 'smtp://localhost:1025', MAIL_FROM: 'Galerie <galerie@exemple.fr>' };

describe('transport configuration warnings', () => {
  it('reports a reply address without a relay to use it', () => {
    const { avertissements, log } = journal();
    Mailer.fromEnv(config({ MAIL_REPLY_TO: 'moi@exemple.fr' }), log);
    assert.match(avertissements.join('\n'), /MAIL_REPLY_TO is set but no relay/);
  });

  it('reports a reply address identical to the sender', () => {
    const { avertissements, log } = journal();
    // The reflex is to copy MAIL_FROM. The forms differ — display name on one
    // side, case on the other — but the address is identical, so Reply-To
    // redirects nothing.
    Mailer.fromEnv(config({ ...RELAIS, MAIL_REPLY_TO: 'Galerie@Exemple.fr' }), log);
    assert.match(avertissements.join('\n'), /the same address as MAIL_FROM/);
  });

  it('stays silent when configuration is coherent', () => {
    const { avertissements, log } = journal();
    Mailer.fromEnv(config({ ...RELAIS, MAIL_REPLY_TO: 'moi@exemple.fr' }), log);
    assert.deepEqual(avertissements, []);
  });

  it('stays silent when the instance simply sends no email', () => {
    // Configuring nothing is a choice, not an error: the missing relay is
    // reported at `info` and must not surface as a fault.
    const { avertissements, log } = journal();
    const mailer = Mailer.fromEnv(config(), log);
    assert.equal(mailer.enabled, false);
    assert.deepEqual(avertissements, []);
  });
});
