import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { loadEnv } from '../src/env.js';

/**
 * Contrôles de l'environnement au démarrage.
 *
 * Ce qui est vérifié ici tient en une idée : une configuration fautive doit
 * empêcher le démarrage, pas produire une instance qui tourne et qui échouera
 * des semaines plus tard, au premier usage de ce qu'elle a mal lu.
 */

const root = mkdtempSync(join(tmpdir(), 'nonni-env-'));
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
  it('accepte une URL Gmail avec l’adresse encodée', () => {
    const config = loadEnv(avecSmtp('smtps://moi%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465'));
    assert.equal(
      config.mail?.smtpUrl,
      'smtps://moi%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465',
    );
  });

  it('accepte un relais local sans identifiants', () => {
    assert.ok(loadEnv(avecSmtp('smtp://localhost:1025')).mail);
    // Nom de service dans un réseau Docker : pas de point, et c'est légitime.
    assert.ok(loadEnv(avecSmtp('smtp://mailpit:1025')).mail);
  });

  it('refuse un mot de passe dont un caractère coupe l’adresse', () => {
    // Le cas coûteux : nodemailer construit alors un transport vers l'hôte
    // « user », sans authentification, et l'instance démarre normalement. La
    // panne ne se voit qu'au premier envoi, des semaines plus tard.
    for (const motDePasse of ['a/b', 'a?b', 'a#b']) {
      assert.throws(
        () => loadEnv(avecSmtp(`smtp://user:${motDePasse}@smtp.exemple.fr:587`)),
        /SMTP_URL n'est pas une URL valide/,
        `« ${motDePasse} » doit être refusé`,
      );
    }
  });

  it('laisse passer ce qui ne casse rien', () => {
    // Un contrôle qui crie à tort finit contourné : `+`, `:` et l'espace sont
    // parfaitement lisibles dans un mot de passe.
    for (const motDePasse of ['a+b', 'a:b', 'a b']) {
      assert.ok(
        loadEnv(avecSmtp(`smtp://user:${motDePasse}@smtp.exemple.fr:587`)).mail,
        `« ${motDePasse} » doit être accepté`,
      );
    }
  });

  it('refuse un schéma qui n’est pas SMTP', () => {
    assert.throws(
      () => loadEnv(avecSmtp('https://smtp.exemple.fr:587')),
      /smtp:\/\/ » ou « smtps:\/\//,
    );
  });

  it('exige MAIL_FROM avec SMTP_URL, et réciproquement', () => {
    assert.throws(() => loadEnv(env({ SMTP_URL: 'smtp://localhost:1025' })), /ensemble/);
    assert.throws(() => loadEnv(env({ MAIL_FROM: 'Galerie <galerie@exemple.fr>' })), /ensemble/);
  });

  it('n’exige rien quand l’instance n’envoie pas d’email', () => {
    assert.equal(loadEnv(env()).mail, null);
  });
});

describe('MAIL_REPLY_TO', () => {
  it('reste facultative, et vide vaut absente', () => {
    // La distinction porte : `null` ne pose aucun en-tête, tandis qu'un en-tête
    // vide ferait retomber le client de messagerie sur l'adresse d'expédition —
    // celle qui, précisément, ne reçoit rien.
    assert.equal(loadEnv(avecSmtp('smtp://localhost:1025')).mailReplyTo, null);
    assert.equal(
      loadEnv(env({ ...avecSmtp('smtp://localhost:1025'), MAIL_REPLY_TO: '   ' })).mailReplyTo,
      null,
    );
  });

  it('n’a pas besoin d’être déclarée avec MAIL_FROM', () => {
    // Contrairement à SMTP_URL et MAIL_FROM : forcer le couple obligerait
    // toutes les instances en service à déclarer une adresse qu'elles n'ont pas.
    const config = loadEnv(
      env({ ...avecSmtp('smtp://localhost:1025'), MAIL_REPLY_TO: 'moi@exemple.fr' }),
    );
    assert.equal(config.mail?.from, 'Galerie <galerie@exemple.fr>');
    assert.equal(config.mailReplyTo, 'moi@exemple.fr');
  });

  it('survit à un relais éteint, sans quoi on ne pourrait pas le signaler', () => {
    // Elle vit hors de `mail` exprès : c'est ce qui permet au Mailer d'avertir
    // qu'une adresse de réponse est configurée alors que rien ne peut partir.
    const config = loadEnv(env({ MAIL_REPLY_TO: 'moi@exemple.fr' }));
    assert.equal(config.mail, null);
    assert.equal(config.mailReplyTo, 'moi@exemple.fr');
  });
});

describe('forme des adresses', () => {
  it('refuse ce qui trahit une faute de frappe', () => {
    // Toutes ces valeurs partent telles quelles dans l'en-tête : le relais les
    // rejette ou les réécrit, semaines après la mise en service, et rien ne
    // rattache l'échec à une ligne du .env.
    for (const valeur of [
      'Galerie <galerie@exemple.fr', // chevron non refermé
      'galerie(at)exemple.fr', // pas d'arobase
      'galerie@', // pas de domaine
      '@exemple.fr', // pas de partie locale
      'a@b c@d', // deux adresses
      'Galerie',
    ]) {
      assert.throws(
        () => loadEnv(env({ SMTP_URL: 'smtp://localhost:1025', MAIL_FROM: valeur })),
        /MAIL_FROM ne porte pas d'adresse email exploitable/,
        `« ${valeur} » doit être refusé`,
      );
      assert.throws(
        () => loadEnv(env({ ...avecSmtp('smtp://localhost:1025'), MAIL_REPLY_TO: valeur })),
        /MAIL_REPLY_TO ne porte pas d'adresse email exploitable/,
        `« ${valeur} » doit être refusé`,
      );
    }
  });

  it('laisse passer les formes légitimes', () => {
    // Un contrôle qui crie à tort finit contourné : le nom d'affichage, le
    // « + » du sous-adressage et le relais local sont tous corrects.
    for (const valeur of [
      'galerie@exemple.fr',
      'Galerie <galerie@exemple.fr>',
      '"Galerie Photos" <galerie@exemple.fr>',
      'prenom.nom+galerie@gmail.com',
      'galerie@localhost',
    ]) {
      assert.ok(
        loadEnv(env({ SMTP_URL: 'smtp://localhost:1025', MAIL_FROM: valeur })).mail,
        `« ${valeur} » doit être accepté`,
      );
    }
  });
});
