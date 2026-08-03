import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { CommentRepo } from '../src/comments.js';
import { ConfigRepo } from '../src/config-repo.js';
import { signUnsubscribeToken, verifyUnsubscribeToken } from '../src/crypto.js';
import { migrate } from '../src/db.js';
import { loadEnv } from '../src/env.js';
import { Mailer, buildCommentMail, type MailMessage } from '../src/mail.js';

/**
 * Destinataires des notifications, et robustesse de l'envoi.
 *
 * La règle tient en une phrase : les administrateurs sont prévenus de tout
 * nouveau commentaire, l'auteur d'un fil est prévenu des réponses qu'il reçoit,
 * et personne n'est prévenu de ce qu'il vient d'écrire lui-même.
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
let config: ConfigRepo;

before(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);

  config = new ConfigRepo(db);
  comments = new CommentRepo(db);

  config.createAlbum({ id: 'vacances', title: 'Vacances', folderId: 'f', recursive: true });

  config.createUser({
    username: 'chef',
    passwordHash: 'x',
    admin: true,
    albums: ['*'],
    email: 'chef@exemple.fr',
  });
  config.createUser({
    username: 'mamie',
    passwordHash: 'x',
    admin: false,
    albums: ['vacances'],
    email: 'mamie@exemple.fr',
    displayName: 'Mamie',
  });
  config.createUser({
    username: 'muet',
    passwordHash: 'x',
    admin: true,
    albums: ['*'],
    // Administrateur sans adresse : il ne doit jamais apparaître comme destinataire.
  });
});

after(() => {
  db?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('choix des destinataires', () => {
  it('prévient les administrateurs d’un nouveau fil, sans son auteur', () => {
    const racine = comments.create({
      albumId: 'vacances',
      mediaId: 'photo-1',
      username: 'mamie',
      body: 'Quelle belle journée',
      parentId: null,
    });

    const destinataires = comments.recipientsFor({
      id: racine.id,
      parentId: racine.parentId,
      username: 'mamie',
    });

    assert.deepEqual(
      destinataires.map((entry) => entry.username).sort(),
      ['chef'],
      'seuls les administrateurs pourvus d’une adresse sont prévenus',
    );
    assert.equal(destinataires[0]!.reason, 'admin');
  });

  it('prévient l’auteur du fil quand on lui répond', () => {
    const racine = comments.create({
      albumId: 'vacances',
      mediaId: 'photo-2',
      username: 'mamie',
      body: 'Qui est sur la photo ?',
      parentId: null,
    });
    const reponse = comments.create({
      albumId: 'vacances',
      mediaId: 'photo-2',
      username: 'chef',
      body: 'Ton petit-fils',
      parentId: racine.id,
    });

    const destinataires = comments.recipientsFor({
      id: reponse.id,
      parentId: reponse.parentId,
      username: 'chef',
    });

    // L'auteur de la réponse est administrateur : il serait destinataire à ce
    // titre, mais c'est lui qui écrit — il est donc écarté.
    assert.deepEqual(
      destinataires.map((entry) => entry.username),
      ['mamie'],
    );
    assert.equal(destinataires[0]!.reason, 'reply');
  });

  it('n’écrit jamais à un compte désabonné', () => {
    config.updateUser('chef', { notify: false });

    const commentaire = comments.create({
      albumId: 'vacances',
      mediaId: 'photo-3',
      username: 'mamie',
      body: 'Encore une',
      parentId: null,
    });

    assert.deepEqual(
      comments.recipientsFor({
        id: commentaire.id,
        parentId: null,
        username: 'mamie',
      }),
      [],
    );

    config.updateUser('chef', { notify: true });
  });
});

describe('jeton de désabonnement', () => {
  it('accepte le jeton du compte et rejette celui d’un autre', () => {
    const jeton = signUnsubscribeToken('mamie', env.sessionSecret);

    assert.ok(verifyUnsubscribeToken('mamie', jeton, env.sessionSecret));
    assert.ok(!verifyUnsubscribeToken('chef', jeton, env.sessionSecret));
    // Insensible à la casse, comme l'est l'identifiant lui-même.
    assert.ok(verifyUnsubscribeToken('MAMIE', jeton, env.sessionSecret));
  });

  it('rejette un jeton tronqué sans lever', () => {
    const jeton = signUnsubscribeToken('mamie', env.sessionSecret);
    assert.doesNotThrow(() =>
      verifyUnsubscribeToken('mamie', jeton.slice(0, 10), env.sessionSecret),
    );
    assert.ok(!verifyUnsubscribeToken('mamie', jeton.slice(0, 10), env.sessionSecret));
  });
});

describe('composition du message', () => {
  it('pointe la photo commentée et échappe le corps dans la partie HTML', () => {
    const message = buildCommentMail(
      {
        albumId: 'vacances',
        albumTitle: 'Vacances',
        mediaId: 'photo-4',
        mediaName: 'IMG_0042.jpg',
        authorDisplayName: 'Mamie',
        body: '<script>alert(1)</script>',
      },
      { username: 'chef', email: 'chef@exemple.fr', displayName: 'chef', reason: 'admin' },
      env,
    );

    assert.match(message.html, /photos\.exemple\.fr\/album\/vacances\?photo=photo-4/);
    // Le corps est saisi par un visiteur : il ne doit jamais devenir du balisage
    // dans le client de messagerie du destinataire.
    assert.ok(!message.html.includes('<script>'));
    assert.match(message.html, /&lt;script&gt;/);
    // Le texte brut, lui, n'a pas à être échappé.
    assert.match(message.text, /<script>/);
    assert.match(message.text, /unsubscribe\?u=chef/);
  });

  it('change de sujet selon qu’il s’agit d’une réponse ou d’un nouveau fil', () => {
    const notification = {
      albumId: 'vacances',
      albumTitle: 'Vacances',
      mediaId: 'photo-5',
      mediaName: null,
      authorDisplayName: 'Mamie',
      body: 'Coucou',
    };

    const versAdmin = buildCommentMail(
      notification,
      { username: 'chef', email: 'c@e.fr', displayName: 'chef', reason: 'admin' },
      env,
    );
    const versAuteur = buildCommentMail(
      notification,
      { username: 'papi', email: 'p@e.fr', displayName: 'papi', reason: 'reply' },
      env,
    );

    assert.match(versAdmin.subject, /a commenté une photo/);
    assert.match(versAuteur.subject, /a répondu à ton commentaire/);
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
