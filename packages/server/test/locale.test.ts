import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ALL_ALBUMS, type Comment } from '@lukarn/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import { defaultLocale, localeFromHeader } from '../src/i18n/index.js';
import { Mailer, type MailMessage } from '../src/mail.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * The language of what the server writes: where it comes from, where it is kept,
 * and which one an email ends up in (D260812d).
 *
 * The last one is the invariant worth the setup here: an email is composed for
 * whoever **reads** it, not for whoever caused it to be sent.
 */

const PASSWORD = 'mot-de-passe-de-test';
const silencieux = { info: () => {}, warn: () => {}, debug: () => {} };
const root = mkdtempSync(join(tmpdir(), 'lukarn-locale-'));

let server: FastifyInstance;
let context: AppContext;
const envoyes: MailMessage[] = [];

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
  };
}

async function login(username: string, language: string): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'accept-language': language },
    payload: { username, password: PASSWORD },
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = response.cookies.find((entry) => entry.name === 'lukarn_session');
  assert.ok(cookie, 'session cookie missing');
  return `lukarn_session=${cookie.value}`;
}

/** Declares an identity and validates the code taken from the captured email. */
async function identify(
  cookie: string,
  email: string,
  displayName: string,
  language: string,
): Promise<void> {
  envoyes.length = 0;
  const asked = await server.inject({
    method: 'POST',
    url: '/api/identity/request-code',
    headers: { cookie, 'accept-language': language },
    payload: { email, displayName },
  });
  assert.equal(asked.statusCode, 202, asked.body);
  await context.mailer.drain();

  const message = envoyes.at(-1);
  assert.ok(message, 'no code sent');
  const code = /\b(\d{6})\b/.exec(message.text)?.[1];
  assert.ok(code, 'code not found in the message body');

  const verified = await server.inject({
    method: 'POST',
    url: '/api/identity/verify',
    headers: { cookie, 'accept-language': language },
    payload: { email, code },
  });
  assert.equal(verified.statusCode, 200, verified.body);
}

let anglais: string;
let francais: string;

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
  context.mailer = new Mailer(async (message) => {
    envoyes.push(message);
  }, silencieux);

  context.config.createAlbum({
    id: 'vacances',
    title: 'Vacances',
    folderId: 'folder-vacances',
    recursive: true,
  });
  context.config.createUser({
    username: 'alexis',
    passwordHash: hash,
    admin: true,
    albums: [ALL_ALBUMS],
  });
  context.config.createUser({
    username: 'famille',
    passwordHash: hash,
    admin: false,
    albums: ['vacances'],
  });
  context.media.upsertMany([media('vacances', 'photo')], '2025-01-01T00:00:00.000Z');

  anglais = await login('alexis', 'en');
  francais = await login('famille', 'fr');

  await identify(anglais, 'chef@exemple.fr', 'Alexis', 'en');
  await identify(francais, 'mamie@exemple.fr', 'Mamie', 'fr');
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('reading Accept-Language', () => {
  it('honours quality factors and ignores the region', () => {
    assert.equal(localeFromHeader('fr-CH,fr;q=0.9,en;q=0.8', 'en'), 'fr');
    assert.equal(localeFromHeader('en-US;q=0.8,fr-FR;q=0.9', 'en'), 'fr');
  });

  it('skips languages it does not speak instead of falling back at the first one', () => {
    // A system in Spanish listing French second must not land in English.
    assert.equal(localeFromHeader('es-ES,es;q=0.9,fr;q=0.5', 'en'), 'fr');
  });

  it('treats q=0 as a refusal of that language, not as a weak preference', () => {
    assert.equal(localeFromHeader('fr;q=0,en;q=0.5', 'fr'), 'en');
  });

  it('falls back rather than failing on an absent or unusable header', () => {
    assert.equal(localeFromHeader(undefined, 'fr'), 'fr');
    assert.equal(localeFromHeader('', 'fr'), 'fr');
    assert.equal(localeFromHeader('de-DE,de;q=0.9', 'en'), 'en');
    // A malformed header must not turn a working page into a 400.
    assert.equal(localeFromHeader(';;;q=', 'en'), 'en');
  });

  it('falls back to English on an unsupported DEFAULT_LOCALE', () => {
    assert.equal(defaultLocale('fr'), 'fr');
    assert.equal(defaultLocale('kl'), 'en');
    assert.equal(defaultLocale(undefined), 'en');
  });
});

describe('the language of a refusal', () => {
  it('follows the request, not the instance', async () => {
    const fr = await server.inject({
      method: 'GET',
      url: '/api/albums/inexistant',
      headers: { cookie: francais, 'accept-language': 'fr' },
    });
    assert.equal(fr.statusCode, 404);
    assert.equal(fr.json<{ error: string; message: string }>().message, 'Album introuvable');

    const en = await server.inject({
      method: 'GET',
      url: '/api/albums/inexistant',
      headers: { cookie: anglais, 'accept-language': 'en' },
    });
    assert.equal(en.statusCode, 404);
    assert.equal(en.json<{ error: string; message: string }>().message, 'Album not found');
  });

  it('keeps the error code untranslated: that is what the front end reads', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/albums/inexistant',
      headers: { cookie: francais, 'accept-language': 'fr' },
    });
    assert.equal(response.json<{ error: string }>().error, 'not_found');
  });

  it('answers an anonymous request in its own language', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/albums',
      headers: { 'accept-language': 'fr-FR,fr;q=0.9' },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json<{ message: string }>().message, 'Authentification requise');
  });
});

describe('the language recorded against an identity', () => {
  it('is written once, then only when it changes', async () => {
    const commenter = context.commenters.byEmail('mamie@exemple.fr');
    assert.ok(commenter);
    assert.equal(commenter.locale, 'fr');

    // Every request goes through this hook, including every thumbnail: an
    // unconditional UPDATE would put a write on the critical path of a cold grid.
    const original = context.commenters.setLocale.bind(context.commenters);
    let ecritures = 0;
    context.commenters.setLocale = (id, locale) => {
      ecritures++;
      original(id, locale);
    };

    try {
      for (let i = 0; i < 3; i++) {
        await server.inject({
          method: 'GET',
          url: '/api/albums',
          headers: { cookie: francais, 'accept-language': 'fr' },
        });
      }
      assert.equal(ecritures, 0, 'an unchanged language must not be rewritten');

      await server.inject({
        method: 'GET',
        url: '/api/albums',
        headers: { cookie: francais, 'accept-language': 'en' },
      });
      assert.equal(ecritures, 1);
      assert.equal(context.commenters.byEmail('mamie@exemple.fr')?.locale, 'en');
    } finally {
      context.commenters.setLocale = original;
      // Put the identity back in French for the email test below.
      await server.inject({
        method: 'GET',
        url: '/api/albums',
        headers: { cookie: francais, 'accept-language': 'fr' },
      });
    }
  });
});

describe('the language of an email', () => {
  it('is the recipient’s, not that of the request that triggered it', async () => {
    // A French-reading grandmother opens the conversation…
    const racine = await server.inject({
      method: 'POST',
      url: '/api/comments/vacances/photo',
      headers: { cookie: francais, 'accept-language': 'fr' },
      payload: { body: 'La plage était déserte', parentId: null },
    });
    assert.equal(racine.statusCode, 201, racine.body);
    const parentId = racine.json<Comment>().id;

    envoyes.length = 0;

    // …and someone reading the gallery in English replies to it.
    const reponse = await server.inject({
      method: 'POST',
      url: '/api/comments/vacances/photo',
      headers: { cookie: anglais, 'accept-language': 'en' },
      payload: { body: 'It really was', parentId },
    });
    assert.equal(reponse.statusCode, 201, reponse.body);
    await context.mailer.drain();

    const message = envoyes.find((mail) => mail.to === 'mamie@exemple.fr');
    assert.ok(message, 'the thread author was not notified');
    assert.match(message.subject, /a répondu à votre commentaire$/);
    assert.match(message.text, /Ne plus recevoir aucun email de cette galerie/);
    // The comment itself is quoted as written: only the wrapper is translated.
    assert.match(message.text, /It really was/);
  });

  it('is the instance default for the moderation address, which is nobody', async () => {
    context.config.updateSettings({ moderationEmail: 'moderation@exemple.fr' });
    envoyes.length = 0;

    const publie = await server.inject({
      method: 'POST',
      url: '/api/comments/vacances/photo',
      headers: { cookie: francais, 'accept-language': 'fr' },
      payload: { body: 'Encore une', parentId: null },
    });
    assert.equal(publie.statusCode, 201, publie.body);
    await context.mailer.drain();

    const message = envoyes.find((mail) => mail.to === 'moderation@exemple.fr');
    assert.ok(message, 'moderation was not notified');
    // DEFAULT_LOCALE is `en` here, even though the comment was written in French.
    assert.match(message.subject, /commented on a photo$/);
    context.config.updateSettings({ moderationEmail: null });
  });
});
