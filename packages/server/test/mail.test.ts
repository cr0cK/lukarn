import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { loadEnv } from '../src/env.js';
import { Mailer } from '../src/mail.js';

/**
 * Avertissements du transport au démarrage.
 *
 * Ce qui est vérifié ici n'empêche pas l'instance de tourner : ce sont des
 * configurations valides mais inopérantes, qui autrement ne se remarqueraient
 * qu'en constatant l'absence d'une réponse qu'on n'attendait plus.
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

describe('avertissements de configuration du transport', () => {
  it('signale une adresse de réponse sans relais pour l’utiliser', () => {
    const { avertissements, log } = journal();
    Mailer.fromEnv(config({ MAIL_REPLY_TO: 'moi@exemple.fr' }), log);
    assert.match(avertissements.join('\n'), /MAIL_REPLY_TO is set but no relay/);
  });

  it('signale une adresse de réponse identique à l’expéditeur', () => {
    const { avertissements, log } = journal();
    // Le geste réflexe : recopier MAIL_FROM. La forme diffère — nom d'affichage
    // d'un côté, casse de l'autre — mais l'adresse est la même, et le Reply-To
    // ne détourne alors rien.
    Mailer.fromEnv(config({ ...RELAIS, MAIL_REPLY_TO: 'Galerie@Exemple.fr' }), log);
    assert.match(avertissements.join('\n'), /the same address as MAIL_FROM/);
  });

  it('se tait quand la configuration est cohérente', () => {
    const { avertissements, log } = journal();
    Mailer.fromEnv(config({ ...RELAIS, MAIL_REPLY_TO: 'moi@exemple.fr' }), log);
    assert.deepEqual(avertissements, []);
  });

  it('se tait quand l’instance n’envoie simplement pas d’email', () => {
    // Ne rien configurer est un choix, pas une erreur : l'absence de relais est
    // dite en `info`, et n'a pas à ressortir comme un défaut.
    const { avertissements, log } = journal();
    const mailer = Mailer.fromEnv(config(), log);
    assert.equal(mailer.enabled, false);
    assert.deepEqual(avertissements, []);
  });
});
