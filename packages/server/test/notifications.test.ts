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
 * Identité de commentateur, vérification par code, et destinataires des
 * notifications.
 *
 * La règle des destinataires tient en une phrase : l'adresse de modération est
 * prévenue de tout nouveau commentaire, l'auteur d'un fil est prévenu des
 * réponses qu'il reçoit, et personne n'est prévenu de ce qu'il vient d'écrire.
 */

const root = mkdtempSync(join(tmpdir(), 'gdv-notif-'));

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

/** Identité vérifiée d'emblée : le chemin du code est éprouvé à part. */
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
  // Une seule clé d'accès, partagée par tout le foyer : c'est bien l'identité
  // qui distingue les personnes, pas le compte.
  config.createUser({ username: 'famille', passwordHash: 'x', admin: false, albums: ['vacances'] });
});

after(() => {
  db?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('vérification de l’adresse', () => {
  it('refuse un code faux et accepte le bon', () => {
    const asked = commenters.requestCode('papi@exemple.fr', 'Papi');
    assert.ok('code' in asked);
    assert.equal(asked.commenter.verifiedAt, null, 'vérifiée avant même la saisie du code');

    assert.deepEqual(commenters.verify('papi@exemple.fr', '000000'), { failure: 'mismatch' });

    const ok = commenters.verify('papi@exemple.fr', asked.code);
    assert.ok('commenter' in ok);
    assert.ok(ok.commenter.verifiedAt);
  });

  it('épuise le code après cinq tentatives', () => {
    const asked = commenters.requestCode('brute@exemple.fr', 'Brute');
    assert.ok('code' in asked);

    for (let essai = 0; essai < 5; essai++) {
      assert.deepEqual(commenters.verify('brute@exemple.fr', '000000'), { failure: 'mismatch' });
    }

    // Même le bon code ne passe plus : six chiffres se parcourent en un million
    // d'essais, sans plafond la vérification ne vérifierait rien.
    assert.deepEqual(commenters.verify('brute@exemple.fr', asked.code), {
      failure: 'too_many_attempts',
    });
  });

  it('refuse de renvoyer un code dans la minute', () => {
    commenters.requestCode('spam@exemple.fr', 'Spam');
    const second = commenters.requestCode('spam@exemple.fr', 'Spam');
    // Sans ce délai, le formulaire expédierait des emails en rafale vers une
    // adresse qu'on ne possède pas.
    assert.ok('failure' in second);
    assert.equal(second.failure, 'too_soon');
  });

  it('reconnaît la même personne quelle que soit la casse de son adresse', () => {
    const premier = identiteVerifiee('Nadine@Exemple.FR', 'Nadine');
    assert.equal(commenters.byEmail('nadine@exemple.fr')?.id, premier);
  });

  it('ne conserve jamais le code en clair', () => {
    const asked = commenters.requestCode('secret@exemple.fr', 'Secret');
    assert.ok('code' in asked);
    const row = db
      .prepare('SELECT code_hash FROM commenters WHERE email = ?')
      .get('secret@exemple.fr') as { code_hash: string };
    // Un dump de la base ne doit pas livrer de quoi valider une adresse.
    assert.ok(!row.code_hash.includes(asked.code));
  });
});

describe('choix des destinataires', () => {
  let mamie: number;
  let papi: number;

  // Les identités sont créées une fois : le délai anti-renvoi refuserait un
  // second code dans la minute, ce qui est précisément ce qu'on lui demande.
  before(() => {
    mamie = identiteVerifiee('mamie@exemple.fr', 'Mamie');
    papi = identiteVerifiee('papi2@exemple.fr', 'Papi');
  });

  beforeEach(() => {
    db.prepare('DELETE FROM comments').run();
  });

  it('ne prévient personne d’un nouveau fil hors adresse de modération', () => {
    const racine = comments.create({
      albumId: 'vacances',
      mediaId: 'photo-1',
      commenterId: mamie,
      account: 'famille',
      body: 'Quelle belle journée',
      parentId: null,
    });

    // Un fil qui s'ouvre ne répond à personne ; seule la modération est
    // concernée, et son adresse vient des réglages, pas de cette table.
    assert.equal(commenters.recipientForReply(racine.id, mamie), null);
  });

  it('prévient l’auteur du fil quand on lui répond', () => {
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

  it('ne prévient jamais quelqu’un de sa propre réponse', () => {
    const racine = comments.create({
      albumId: 'vacances',
      mediaId: 'photo-3',
      commenterId: mamie,
      account: 'famille',
      body: 'Je me réponds',
      parentId: null,
    });

    // Recevoir un email pour ce qu'on vient d'écrire est le premier réflexe qui
    // fait couper les notifications.
    assert.equal(commenters.recipientForReply(racine.id, mamie), null);
  });

  it('n’écrit pas à une identité désabonnée', () => {
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

describe('jeton de désabonnement', () => {
  it('accepte le jeton de l’adresse et rejette celui d’une autre', () => {
    const jeton = signUnsubscribeToken('mamie@exemple.fr', env.sessionSecret);

    assert.ok(verifyUnsubscribeToken('mamie@exemple.fr', jeton, env.sessionSecret));
    assert.ok(!verifyUnsubscribeToken('papi2@exemple.fr', jeton, env.sessionSecret));
    // Insensible à la casse, comme l'adresse elle-même.
    assert.ok(verifyUnsubscribeToken('Mamie@Exemple.fr', jeton, env.sessionSecret));
  });

  it('rejette un jeton tronqué sans lever', () => {
    const jeton = signUnsubscribeToken('mamie@exemple.fr', env.sessionSecret);
    assert.doesNotThrow(() =>
      verifyUnsubscribeToken('mamie@exemple.fr', jeton.slice(0, 10), env.sessionSecret),
    );
    assert.ok(!verifyUnsubscribeToken('mamie@exemple.fr', jeton.slice(0, 10), env.sessionSecret));
  });
});

describe('composition des messages', () => {
  const notification = {
    albumId: 'vacances',
    albumTitle: 'Vacances',
    mediaId: 'photo-5',
    mediaName: 'IMG_0042.jpg',
    authorDisplayName: 'Mamie',
    body: 'Coucou',
  };

  it('pointe la photo commentée et échappe le corps dans la partie HTML', () => {
    const message = buildCommentMail(
      { ...notification, body: '<script>alert(1)</script>' },
      { email: 'papi2@exemple.fr', reason: 'reply' },
      env,
    );

    assert.match(message.html, /photos\.exemple\.fr\/album\/vacances\?photo=photo-5/);
    // Le corps est saisi par un visiteur : il ne doit jamais devenir du balisage
    // dans le client de messagerie du destinataire.
    assert.ok(!message.html.includes('<script>'));
    assert.match(message.html, /&lt;script&gt;/);
    // Le texte brut, lui, n'a pas à être échappé.
    assert.match(message.text, /<script>/);
  });

  it('ne met un lien de désabonnement que pour une personne', () => {
    const versAuteur = buildCommentMail(
      notification,
      { email: 'papi2@exemple.fr', reason: 'reply' },
      env,
    );
    const versModeration = buildCommentMail(
      notification,
      { email: 'moderation@exemple.fr', reason: 'moderation' },
      env,
    );

    assert.match(versAuteur.subject, /a répondu à ton commentaire/);
    assert.match(versAuteur.text, /unsubscribe\?u=papi2%40exemple\.fr/);

    assert.match(versModeration.subject, /a commenté une photo/);
    // L'adresse de modération n'est pas une identité : elle se retire depuis
    // /admin, pas par un lien qui couperait les alertes de l'instance.
    assert.ok(!versModeration.text.includes('unsubscribe'));
  });

  it('garde le code de vérification hors du sujet, qui nomme l’instance', () => {
    const message = buildVerificationMail('mamie@exemple.fr', 'Mamie', '123456', env);
    // Un code dans le sujet se lit par-dessus une épaule et reste en clair dans
    // l'historique des notifications ; l'hôte, lui, dit pourquoi ce mail arrive.
    assert.ok(!message.subject.includes('123456'));
    assert.match(message.subject, /photos\.exemple\.fr/);
    assert.match(message.text, /123456/);
    assert.match(message.html, /123456/);
  });

  it('nomme l’instance dans les deux versions du corps', () => {
    const message = buildVerificationMail('mamie@exemple.fr', 'Mamie', '123456', env);
    // La version HTML avait décroché de la version texte, qui seule nommait
    // l'instance — et c'est le HTML que la destinataire voit.
    assert.match(message.text, /photos\.exemple\.fr/);
    assert.match(message.html, /photos\.exemple\.fr/);
  });

  it('n’écrit pas le code groupé, qui ne se recolle pas dans le champ', () => {
    const message = buildVerificationMail('mamie@exemple.fr', 'Mamie', '123456', env);
    // `verify` exige six caractères après trim() : « 123 456 » collé serait rejeté.
    assert.ok(!message.text.includes('123 456'));
    assert.ok(!message.html.includes('123 456'));
  });

  it('n’offre aucun lien cliquable dans le mail de code', () => {
    const message = buildVerificationMail('mamie@exemple.fr', 'Mamie', '123456', env);
    // Un lien ouvrirait une seconde session dans un autre navigateur, alors que
    // le code est attendu dans l'onglet resté ouvert.
    assert.ok(!message.html.includes('<a '));
  });
});

describe('envoi', () => {
  it('n’envoie rien quand SMTP n’est pas configuré', async () => {
    const mailer = new Mailer(null, silencieux);
    assert.equal(mailer.enabled, false);
    // Ne lève pas : les appelants n'ont pas à tester la configuration.
    mailer.queue({ to: 'a@b.fr', subject: 's', text: 't', html: '<p>t</p>' });
    await mailer.drain();
  });

  it('absorbe l’échec d’un envoi et poursuit la file', async () => {
    const envoyes: MailMessage[] = [];
    const mailer = new Mailer(async (message) => {
      if (message.to === 'casse@exemple.fr') throw new Error('relais injoignable');
      envoyes.push(message);
    }, silencieux);

    mailer.queue({ to: 'casse@exemple.fr', subject: 's', text: 't', html: '<p>t</p>' });
    mailer.queue({ to: 'ok@exemple.fr', subject: 's', text: 't', html: '<p>t</p>' });

    // Un rejet non géré en tâche de fond terminerait le process : le second
    // message doit partir malgré l'échec du premier.
    await mailer.drain();
    assert.deepEqual(
      envoyes.map((message) => message.to),
      ['ok@exemple.fr'],
    );
  });
});
