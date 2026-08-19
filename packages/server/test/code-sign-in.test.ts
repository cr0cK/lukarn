import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ALL_ALBUMS, type AdminUser, type SessionUser } from '@lukarn/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import { Mailer, type MailMessage } from '../src/mail.js';

/**
 * The HTTP surface of an account that is a person: inviting one, and entering it
 * with the six digits that invitation carried.
 *
 * What is checked here is what only a request can show — that the two public routes
 * say the same thing whatever they found, that a valid code arriving without a name
 * costs nothing, and that the account a code binds is the one the **code** names
 * rather than the one the caller does.
 */

const PASSWORD = 'mot-de-passe-de-test';
const quiet = { info: () => {}, warn: () => {}, debug: () => {} };
const root = mkdtempSync(join(tmpdir(), 'lukarn-code-signin-'));

let server: FastifyInstance;
let context: AppContext;
/** Captured messages: the test instance opens no SMTP connection. */
const sent: MailMessage[] = [];

/**
 * Lets an address ask for another code without waiting a minute. The delay is
 * desirable in production and would make these tests depend on a real wait.
 */
function rearmTheCode(email: string): void {
  context.db
    .prepare("UPDATE verification_codes SET sent_at = '2020-01-01T00:00:00.000Z' WHERE target = ?")
    .run(email);
}

/**
 * Forgets every counter between tests. They share one caller address, and the `ip`
 * axis is deliberately the one thing a public request always moves.
 */
function forgetThrottling(): void {
  context.throttle.purge(Date.now() + 2 * 60 * 60 * 1000);
}

/** The six digits from the message just queued. They are in the body, never the subject (D65). */
async function lastCode(): Promise<string> {
  await context.mailer.drain();
  const message = sent.at(-1);
  assert.ok(message, 'no message sent');
  assert.doesNotMatch(message.subject, /\d{6}/, 'the code must not be readable in the subject');
  const code = /\b(\d{6})\b/.exec(message.text)?.[1];
  assert.ok(code, `code not found in the body of "${message.subject}"`);
  return code;
}

async function login(username: string): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: PASSWORD },
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = response.cookies.find((entry) => entry.name === 'lukarn_session');
  assert.ok(cookie, 'session cookie missing');
  return `lukarn_session=${cookie.value}`;
}

/** Creates an account by address from /admin, as an administrator would. */
async function createByEmail(username: string, email: string, admin = false): Promise<AdminUser> {
  sent.length = 0;
  const response = await server.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { cookie: adminCookie },
    payload: { username, email, admin, albums: [ALL_ALBUMS] },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<AdminUser>();
}

let adminCookie: string;

before(async () => {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

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

  // Without a transport nothing is sent and no account can be invited: the intended
  // behaviour, and one that would make this file inert.
  context.mailer = new Mailer(async (message) => {
    sent.push(message);
  }, quiet);

  context.config.createAlbum({
    id: 'vacances',
    title: 'Vacances',
    folderId: 'folder-vacances',
    recursive: true,
  });
  context.config.createUser({
    username: 'alexis',
    passwordHash,
    admin: true,
    albums: [ALL_ALBUMS],
  });
  adminCookie = await login('alexis');
});

beforeEach(() => {
  forgetThrottling();
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('creating an account by address', () => {
  it('creates it with no way in and sends an invitation saying what the code grants', async () => {
    const created = await createByEmail('mamie', 'mamie@example.com');

    assert.equal(created.state, 'invited');
    assert.equal(created.identity, null, 'creation must write no binding');
    assert.equal(created.invitation?.email, 'mamie@example.com');
    // Seven days, which is what has to survive somebody's weekend.
    const days = (Date.parse(created.invitation!.expiresAt) - Date.now()) / 86_400_000;
    assert.ok(days > 6.9 && days < 7.1, `invitation lasts ${days} days`);

    await lastCode();
    const message = sent.at(-1)!;
    assert.equal(message.to, 'mamie@example.com');
    // The link pre-fills the address and carries nothing else: no secret, and it
    // authenticates nobody.
    assert.match(message.text, /\/login\?email=mamie%40example\.com/);
    assert.doesNotMatch(message.text, /\d{6}\S*token|token=/i);
  });

  it('refuses both a password and an address, and refuses neither', async () => {
    for (const payload of [
      { username: 'deux', password: PASSWORD, email: 'deux@example.com' },
      { username: 'aucun' },
    ]) {
      const response = await server.inject({
        method: 'POST',
        url: '/api/admin/users',
        headers: { cookie: adminCookie },
        payload,
      });
      assert.equal(response.statusCode, 400, response.body);
    }
  });

  it('refuses an address another account is already bound to, and names it', async () => {
    await createByEmail('papi', 'papi@example.com');
    await takeUpInvitation('papi@example.com', 'Papi');

    const response = await server.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { cookie: adminCookie },
      payload: { username: 'papi-bis', email: 'papi@example.com' },
    });

    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json<{ error: string }>().error, 'identity_taken');
    assert.match(response.json<{ message: string }>().message, /papi/);
  });
});

describe('the two public routes say one thing only', () => {
  it('answers 202 for an unknown address, a known one and one asked again', async () => {
    await createByEmail('tantine', 'tantine@example.com');

    const answers = [];
    for (const email of ['nobody@example.com', 'tantine@example.com', 'tantine@example.com']) {
      const response = await server.inject({
        method: 'POST',
        url: '/api/auth/code/request',
        payload: { email },
      });
      answers.push({ status: response.statusCode, body: response.body });
    }

    assert.deepEqual(
      answers.map((answer) => answer.status),
      [202, 202, 202],
    );
    // Byte for byte: a body that differed would be the oracle the status code closed.
    assert.equal(new Set(answers.map((answer) => answer.body)).size, 1);
  });

  it('remints a live invitation rather than sending nothing', async () => {
    await createByEmail('cousin', 'cousin@example.com');
    const first = await lastCode();
    rearmTheCode('cousin@example.com');
    sent.length = 0;

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/code/request',
      payload: { email: 'cousin@example.com' },
    });
    assert.equal(response.statusCode, 202);

    const second = await lastCode();
    assert.notEqual(second, first, 'the invitation was not reminted');
  });

  it('refuses an unknown, a wrong, an expired and an exhausted code with one body', async () => {
    await createByEmail('voisine', 'voisine@example.com');

    const answers = new Set<string>();
    // Unknown address.
    answers.add(await refusal('personne@example.com', '000000'));
    // Wrong code, four times over, which also exhausts the five attempts.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      answers.add(await refusal('voisine@example.com', '000000'));
    }
    // The fifth failure spends the last attempt; the sixth is refused for being spent.
    answers.add(await refusal('voisine@example.com', '000000'));
    answers.add(await refusal('voisine@example.com', '000000'));

    // The fourth case, and the one no wrong code can stand in for: digits that were
    // right until their deadline passed.
    await createByEmail('perimee', 'perimee@example.com');
    const expired = await lastCode();
    expireCodes('perimee@example.com');
    answers.add(await refusal('perimee@example.com', expired));

    assert.equal(answers.size, 1, `four cases answered ${answers.size} different ways`);
  });

  /**
   * The counter is a function of how much the caller asked, never of what the answers
   * were. The `ip` axis is shared with `/auth/login`, so an attacker walks it to one
   * below its threshold with failed sign-ins and then makes a single call for a
   * candidate address: a counter that moved only for a known one would answer the
   * question the uniform `202` refuses to answer.
   */
  it('counts a call for an unknown address exactly as one for a known address', async () => {
    await createByEmail('comptee', 'comptee@example.com');
    await takeUpInvitation('comptee@example.com', 'Comptée');
    await createByEmail('attendue', 'attendue@example.com');

    // An address that opens an account, one holding an invitation nobody has taken
    // up, and one nothing here knows: the route does three different things, and the
    // counter moves the same amount for each. The boundary is asserted from both
    // sides, because a counter that never moved would satisfy the first half alone.
    for (const email of ['personne@example.com', 'comptee@example.com', 'attendue@example.com']) {
      assert.equal(await delayAfter(email, IP_FREE_CALLS), 0, `${email} owed a delay too early`);
      assert.ok(await delayAfter(email, IP_FREE_CALLS + 1), `${email} never moved the counter`);
    }
  });
});

/**
 * The rule the whole design rests on: an administrator invites, and only the person
 * reading the address binds. Anything else is an administrator pointing an account at
 * an inbox they read and signing as whoever answers it.
 */
describe('no administrator can assert a binding', () => {
  it('invites an already verified address without binding the account to it', async () => {
    const identity = verifiedIdentity('aieule@example.com', 'Aïeule');

    const created = await createByEmail('aieule', 'aieule@example.com');

    // `commenters.verified_at` proves that somebody controls an address, not that
    // they accepted this account. The code is what proves the second.
    assert.equal(created.identity, null, 'the account was bound at creation');
    assert.equal(created.state, 'invited');
    assert.equal(context.config.user('aieule')!.commenterId, null);
    assert.equal(context.config.userForEmail('aieule@example.com'), undefined);
    // The existing identity is left exactly as its owner wrote it.
    assert.equal(context.commenters.byId(identity)?.displayName, 'Aïeule');
  });

  it('leaves every session of an invited account signing as nobody', async () => {
    verifiedIdentity('tante@example.com', 'Tante');
    await createByPassword('maison');
    const phone = await login('maison');
    const laptop = await login('maison');

    const invited = await server.inject({
      method: 'POST',
      url: '/api/admin/users/maison/invite',
      headers: { cookie: adminCookie },
      payload: { email: 'tante@example.com' },
    });
    assert.equal(invited.statusCode, 200, invited.body);

    // Binding here would hand every device already signed in with the shared key
    // that person's name, without a code ever being entered.
    for (const cookie of [phone, laptop]) {
      const me = await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
      assert.equal(me.json<SessionUser>().identity, null, 'a session started signing as somebody');
      assert.equal(me.json<SessionUser>().identityBound, false);
    }
    assert.equal(context.config.user('maison')!.commenterId, null);
  });

  it('writes no binding through any account route', async () => {
    const before = boundAccounts();
    verifiedIdentity('cousine@example.com', 'Cousine');
    verifiedIdentity('neveu@example.com', 'Neveu');

    await createByPassword('cle');
    await createByEmail('invitee', 'cousine@example.com');
    const invited = await server.inject({
      method: 'POST',
      url: '/api/admin/users/cle/invite',
      headers: { cookie: adminCookie },
      payload: { email: 'neveu@example.com' },
    });
    assert.equal(invited.statusCode, 200, invited.body);
    const patched = await server.inject({
      method: 'PATCH',
      url: '/api/admin/users/cle',
      headers: { cookie: adminCookie },
      payload: { admin: true, albums: [ALL_ALBUMS], password: PASSWORD },
    });
    assert.equal(patched.statusCode, 200, patched.body);
    const deleted = await server.inject({
      method: 'DELETE',
      url: '/api/admin/users/invitee',
      headers: { cookie: adminCookie },
    });
    assert.equal(deleted.statusCode, 200, deleted.body);

    // The column is written when a code is consumed and nowhere else, so no sequence
    // of administration adds a name to this list.
    assert.deepEqual(boundAccounts(), before);
  });
});

describe('taking up an invitation', () => {
  it('asks for a name without consuming the code or counting an attempt', async () => {
    await createByEmail('nouvelle', 'nouvelle@example.com');
    const code = await lastCode();

    const before = attemptsOn('nouvelle@example.com');
    const asked = await server.inject({
      method: 'POST',
      url: '/api/auth/code/verify',
      payload: { email: 'nouvelle@example.com', code },
    });

    assert.equal(asked.statusCode, 400, asked.body);
    assert.equal(asked.json<{ error: string }>().error, 'display_name_required');
    // The whole point: `check()` counts before it compares, so an incomplete but valid
    // submission has to leave the counter where it found it — otherwise a correct code
    // arriving fifth is exhausted by the time the name comes back.
    assert.equal(attemptsOn('nouvelle@example.com'), before, 'the attempt was counted');
    assert.ok(
      context.codes.find('nouvelle@example.com', 'invite'),
      'the code was consumed while asking for a name',
    );

    // The same code, resubmitted with the name, still works.
    const opened = await server.inject({
      method: 'POST',
      url: '/api/auth/code/verify',
      payload: { email: 'nouvelle@example.com', code, displayName: 'Nouvelle' },
    });
    assert.equal(opened.statusCode, 200, opened.body);
    const user = opened.json<SessionUser>();
    assert.equal(user.username, 'nouvelle');
    assert.equal(user.identityBound, true);
    assert.equal(user.identity?.displayName, 'Nouvelle');
  });

  it('asks as many times as it needs to without exhausting the code', async () => {
    await createByEmail('patiente', 'patiente@example.com');
    const code = await lastCode();

    // Five attempts is the ceiling that makes six digits sufficient, so an answer
    // costing one would exhaust a correct code before the name ever came back.
    for (let ask = 0; ask < 4; ask += 1) {
      const asked = await server.inject({
        method: 'POST',
        url: '/api/auth/code/verify',
        payload: { email: 'patiente@example.com', code },
      });
      assert.equal(asked.statusCode, 400, asked.body);
      assert.equal(asked.json<{ error: string }>().error, 'display_name_required');
    }
    assert.equal(attemptsOn('patiente@example.com'), 0, 'asking for a name spent an attempt');

    const opened = await server.inject({
      method: 'POST',
      url: '/api/auth/code/verify',
      payload: { email: 'patiente@example.com', code, displayName: 'Patiente' },
    });
    assert.equal(opened.statusCode, 200, opened.body);
    assert.equal(opened.json<SessionUser>().identity?.displayName, 'Patiente');
  });

  it('binds the account the code names, never one the caller names', async () => {
    await createByEmail('filleule', 'filleule@example.com');
    const code = await lastCode();

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/code/verify',
      // The caller names the administrator. The route reads the account from the
      // checked row, so this field is not a field at all.
      payload: {
        email: 'filleule@example.com',
        code,
        displayName: 'Filleule',
        username: 'alexis',
      },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json<SessionUser>().username, 'filleule');
    assert.equal(context.config.user('alexis')!.commenterId, null, 'the administrator was bound');
  });

  it('refuses the code a second time', async () => {
    await createByEmail('unique', 'unique@example.com');
    const code = await lastCode();

    const first = await server.inject({
      method: 'POST',
      url: '/api/auth/code/verify',
      payload: { email: 'unique@example.com', code, displayName: 'Unique' },
    });
    assert.equal(first.statusCode, 200, first.body);

    const replayed = await server.inject({
      method: 'POST',
      url: '/api/auth/code/verify',
      payload: { email: 'unique@example.com', code, displayName: 'Unique' },
    });
    assert.equal(replayed.statusCode, 400, replayed.body);
  });
});

describe('an account that is a person', () => {
  it('signs in again with a code, and its identity needs no verification step', async () => {
    await createByEmail('marraine', 'marraine@example.com');
    const cookie = await takeUpInvitation('marraine@example.com', 'Marraine');

    // A fresh device: no session state, and the identity still arrives with `/me`.
    rearmTheCode('marraine@example.com');
    sent.length = 0;
    const asked = await server.inject({
      method: 'POST',
      url: '/api/auth/code/request',
      payload: { email: 'marraine@example.com' },
    });
    assert.equal(asked.statusCode, 202);
    const code = await lastCode();

    const opened = await server.inject({
      method: 'POST',
      url: '/api/auth/code/verify',
      payload: { email: 'marraine@example.com', code },
    });
    assert.equal(opened.statusCode, 200, opened.body);
    const other = opened.cookies.find((entry) => entry.name === 'lukarn_session');
    assert.ok(other, 'no session cookie');

    const me = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `lukarn_session=${other.value}` },
    });
    assert.equal(me.json<SessionUser>().identity?.displayName, 'Marraine');
    assert.equal(me.json<SessionUser>().identityBound, true);
    // The first session is still that person too: the identity is on the account.
    const first = await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(first.json<SessionUser>().identity?.displayName, 'Marraine');
  });

  it('refuses to declare, verify or forget an identity from the session', async () => {
    await createByEmail('lieuse', 'lieuse@example.com');
    const cookie = await takeUpInvitation('lieuse@example.com', 'Lieuse');

    for (const [url, payload] of [
      ['/api/identity/request-code', { email: 'autre@example.com', displayName: 'Autre' }],
      ['/api/identity/verify', { email: 'autre@example.com', code: '000000' }],
      ['/api/identity/forget', {}],
    ] as const) {
      const response = await server.inject({ method: 'POST', url, headers: { cookie }, payload });
      assert.equal(response.statusCode, 409, `${url} answered ${response.statusCode}`);
      assert.equal(response.json<{ error: string }>().error, 'identity_bound');
    }
  });

  it('refuses a password, and accepts the unbind that comes with one', async () => {
    await createByEmail('rendue', 'rendue@example.com');
    const cookie = await takeUpInvitation('rendue@example.com', 'Rendue');

    const refused = await server.inject({
      method: 'PATCH',
      url: '/api/admin/users/rendue',
      headers: { cookie: adminCookie },
      payload: { password: PASSWORD },
    });
    assert.equal(refused.statusCode, 409, refused.body);
    assert.equal(refused.json<{ error: string }>().error, 'password_on_bound_account');

    const unbound = await server.inject({
      method: 'PATCH',
      url: '/api/admin/users/rendue',
      headers: { cookie: adminCookie },
      payload: { unbind: true, password: PASSWORD },
    });
    assert.equal(unbound.statusCode, 200, unbound.body);
    assert.equal(unbound.json<AdminUser>().state, 'shared_key');
    assert.equal(unbound.json<AdminUser>().identity, null);

    // The sessions of the person it was are closed, and the password now works.
    const stale = await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(stale.statusCode, 401);
    await login('rendue');
  });

  it('is not unbound without the password it is entered with afterwards', async () => {
    await createByEmail('gardee', 'gardee@example.com');
    const cookie = await takeUpInvitation('gardee@example.com', 'Gardée');

    const response = await server.inject({
      method: 'PATCH',
      url: '/api/admin/users/gardee',
      headers: { cookie: adminCookie },
      payload: { unbind: true },
    });

    // The account would otherwise hold no identity and a hash nobody can enter,
    // the administrator included.
    assert.equal(response.statusCode, 400, response.body);
    assert.notEqual(context.config.user('gardee')!.commenterId, null);
    const me = await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(me.json<SessionUser>().identityBound, true);
  });
});

describe('inviting an account that already exists', () => {
  it('sends the pending invitation again without being told the address', async () => {
    await createByEmail('relance', 'relance@example.com');
    const first = await lastCode();
    rearmTheCode('relance@example.com');
    sent.length = 0;

    const response = await server.inject({
      method: 'POST',
      url: '/api/admin/users/relance/invite',
      headers: { cookie: adminCookie },
      payload: {},
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json<AdminUser>().invitation?.email, 'relance@example.com');
    assert.notEqual(await lastCode(), first);
  });

  it('converts a shared key without touching its password until the code is spent', async () => {
    await server.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { cookie: adminCookie },
      payload: { username: 'famille', password: PASSWORD, albums: [ALL_ALBUMS] },
    });
    sent.length = 0;

    const invited = await server.inject({
      method: 'POST',
      url: '/api/admin/users/famille/invite',
      headers: { cookie: adminCookie },
      payload: { email: 'famille@example.com' },
    });
    assert.equal(invited.statusCode, 200, invited.body);
    // An invitation nobody has taken up leaves a working shared key exactly as it was.
    assert.equal(invited.json<AdminUser>().state, 'shared_key');
    const stillOpen = await login('famille');

    const code = await lastCode();
    const opened = await server.inject({
      method: 'POST',
      url: '/api/auth/code/verify',
      payload: { email: 'famille@example.com', code, displayName: 'Famille' },
    });
    assert.equal(opened.statusCode, 200, opened.body);

    // The sessions the shared key had open are closed, and the password stops working.
    const stale = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: stillOpen },
    });
    assert.equal(stale.statusCode, 401);
    const refused = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'famille', password: PASSWORD },
    });
    assert.equal(refused.statusCode, 401);
    // The session just opened is not among the ones closed.
    const fresh = opened.cookies.find((entry) => entry.name === 'lukarn_session')!;
    const me = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `lukarn_session=${fresh.value}` },
    });
    assert.equal(me.statusCode, 200, me.body);
  });

  it('refuses an account already bound, and one with nothing to send again', async () => {
    await createByEmail('deja', 'deja@example.com');
    await takeUpInvitation('deja@example.com', 'Deja');

    const bound = await server.inject({
      method: 'POST',
      url: '/api/admin/users/deja/invite',
      headers: { cookie: adminCookie },
      payload: {},
    });
    assert.equal(bound.statusCode, 409, bound.body);
    assert.equal(bound.json<{ error: string }>().error, 'already_bound');

    const nothing = await server.inject({
      method: 'POST',
      url: '/api/admin/users/alexis/invite',
      headers: { cookie: adminCookie },
      payload: {},
    });
    assert.equal(nothing.statusCode, 409, nothing.body);
    assert.equal(nothing.json<{ error: string }>().error, 'no_invitation');
  });
});

describe('deleting an invited account', () => {
  it('takes its invitation with it', async () => {
    await createByEmail('ephemere', 'ephemere@example.com');
    assert.ok(context.codes.pendingInvite('ephemere'));

    const response = await server.inject({
      method: 'DELETE',
      url: '/api/admin/users/ephemere',
      headers: { cookie: adminCookie },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(
      context.codes.find('ephemere@example.com', 'invite'),
      null,
      'the invitation outlived the account it named',
    );
  });

  it('closes the sessions of a bound one and frees its address', async () => {
    await createByEmail('partie', 'partie@example.com');
    const cookie = await takeUpInvitation('partie@example.com', 'Partie');

    const response = await server.inject({
      method: 'DELETE',
      url: '/api/admin/users/partie',
      headers: { cookie: adminCookie },
    });
    assert.equal(response.statusCode, 200, response.body);

    // Deleting the account is what closes the door on `comments.account`: nothing
    // else revokes a key that has circulated.
    const stale = await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(stale.statusCode, 401);
    assert.equal(context.config.userForEmail('partie@example.com'), undefined);
    // The person stays, and their comments keep the name they were signed with.
    assert.notEqual(context.commenters.byEmail('partie@example.com'), null);
  });
});

/**
 * The purpose is part of the primary key rather than a flag, so a code obtained for
 * one flow is not merely refused by the other: it is not found by it. The separation
 * is what stops the one attack no secret closes — somebody talked into reading out
 * digits they asked for themselves.
 */
describe('a code cannot be spent on the flow it was not sent for', () => {
  it('does not let the identity flow spend a sign-in code', async () => {
    await createByEmail('signataire', 'signataire@example.com');
    await takeUpInvitation('signataire@example.com', 'Signataire');
    rearmTheCode('signataire@example.com');
    sent.length = 0;
    const asked = await server.inject({
      method: 'POST',
      url: '/api/auth/code/request',
      payload: { email: 'signataire@example.com' },
    });
    assert.equal(asked.statusCode, 202, asked.body);
    const code = await lastCode();

    // Somebody behind a shared key submits it to the flow that attaches an identity
    // to a session. It would otherwise sign their comments with that person's name.
    const cookie = await login('alexis');
    const response = await server.inject({
      method: 'POST',
      url: '/api/identity/verify',
      headers: { cookie },
      payload: { email: 'signataire@example.com', code },
    });

    assert.equal(response.statusCode, 400, response.body);
    const me = await server.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(me.json<SessionUser>().identity, null, 'a sign-in code attached an identity');
    // Not found rather than refused: the sign-in code is still there to be used.
    assert.ok(
      context.codes.find('signataire@example.com', 'signin'),
      'the identity flow spent a sign-in code',
    );
  });

  it('does not let the sign-in route spend an identity code', async () => {
    const cookie = await login('alexis');
    sent.length = 0;
    const asked = await server.inject({
      method: 'POST',
      url: '/api/identity/request-code',
      headers: { cookie },
      payload: { email: 'declarante@example.com', displayName: 'Déclarante' },
    });
    assert.equal(asked.statusCode, 202, asked.body);
    const code = await lastCode();

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/code/verify',
      payload: { email: 'declarante@example.com', code, displayName: 'Déclarante' },
    });

    // A code proving control of an inbox must not open a session on an account.
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json<{ error: string }>().error, 'invalid_code');
    assert.equal(
      response.cookies.find((entry) => entry.name === 'lukarn_session'),
      undefined,
      'an identity code opened a session',
    );
    assert.ok(context.codes.find('declarante@example.com', 'identity'));
  });
});

/**
 * The other half of the release: an account nobody bound is the shared access key of
 * 1.2, and every sentence written about it then still holds.
 */
describe('an unbound account', () => {
  it('signs in with its password and declares an identity per device', async () => {
    await createByPassword('salon');
    const phone = await login('salon');

    const before = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: phone },
    });
    assert.equal(before.json<SessionUser>().identity, null);
    assert.equal(before.json<SessionUser>().identityBound, false);

    sent.length = 0;
    const asked = await server.inject({
      method: 'POST',
      url: '/api/identity/request-code',
      headers: { cookie: phone },
      payload: { email: 'salon@example.com', displayName: 'Salon' },
    });
    assert.equal(asked.statusCode, 202, asked.body);
    const verified = await server.inject({
      method: 'POST',
      url: '/api/identity/verify',
      headers: { cookie: phone },
      payload: { email: 'salon@example.com', code: await lastCode() },
    });
    assert.equal(verified.statusCode, 200, verified.body);
    assert.equal(verified.json<SessionUser>().identity?.displayName, 'Salon');
    // The identity belongs to the session, never to the key: that is the whole of
    // D38, and the column stays empty.
    assert.equal(verified.json<SessionUser>().identityBound, false);
    assert.equal(context.config.user('salon')!.commenterId, null);

    // Another device signing in with the same password is nobody until it says who
    // it is, and the first device may still forget.
    const television = await login('salon');
    const other = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: television },
    });
    assert.equal(other.json<SessionUser>().identity, null);

    const forgotten = await server.inject({
      method: 'POST',
      url: '/api/identity/forget',
      headers: { cookie: phone },
    });
    assert.equal(forgotten.statusCode, 200, forgotten.body);
    assert.equal(forgotten.json<SessionUser>().identity, null);
  });
});

/** Attempts recorded against this address's invitation, read straight from the table. */
function attemptsOn(email: string): number {
  const row = context.db
    .prepare("SELECT attempts FROM verification_codes WHERE target = ? AND purpose = 'invite'")
    .get(email) as { attempts: number } | undefined;
  assert.ok(row, `no invitation pending for ${email}`);
  return row.attempts;
}

/** Accepts the invitation just sent and returns the session cookie it opened. */
async function takeUpInvitation(email: string, displayName: string): Promise<string> {
  const code = await lastCode();
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/code/verify',
    payload: { email, code, displayName },
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = response.cookies.find((entry) => entry.name === 'lukarn_session');
  assert.ok(cookie, 'no session cookie');
  return `lukarn_session=${cookie.value}`;
}

/** One refusal from `/code/verify`, status and body, to compare with the others. */
async function refusal(email: string, code: string): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/code/verify',
    payload: { email, code },
  });
  assert.equal(response.statusCode, 400, response.body);
  return `${response.statusCode} ${response.body}`;
}

/** Puts every code for this address behind its deadline, without waiting for one. */
function expireCodes(email: string): void {
  context.db
    .prepare(
      "UPDATE verification_codes SET expires_at = '2020-01-01T00:00:00.000Z' WHERE target = ?",
    )
    .run(email);
}

/**
 * An address somebody has already proved they read, bound to no account: the
 * household member who has been commenting for a year.
 */
function verifiedIdentity(email: string, displayName: string): number {
  context.commenters.declare(email, displayName);
  const identity = context.commenters.markVerified(email);
  assert.ok(identity, `no identity for ${email}`);
  return identity.id;
}

/** Accounts carrying a binding, read past the repository that maintains them. */
function boundAccounts(): string[] {
  return context.db
    .prepare('SELECT username FROM users WHERE commenter_id IS NOT NULL ORDER BY username')
    .all()
    .map((row) => (row as { username: string }).username);
}

/** A shared key of the kind 1.2 created, from /admin, with its password. */
async function createByPassword(username: string): Promise<void> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { cookie: adminCookie },
    payload: { username, password: PASSWORD, albums: [ALL_ALBUMS] },
  });
  assert.equal(response.statusCode, 201, response.body);
}

/** Failures the `ip` axis allows before it owes a delay — `RULES.ip.free` in `throttle.ts`. */
const IP_FREE_CALLS = 20;

/** What `server.inject` reports as the caller's address, and therefore the counter's key. */
const INJECTED_IP = '127.0.0.1';

/**
 * The delay the caller's axis owes after exactly `calls` requests for this address,
 * from a cleared throttle.
 *
 * Measured against the instant the run started rather than against the clock. The
 * penalty doubles from two seconds, so an earlier version of this searched for the
 * blocking call by looping, and a slow machine let the penalty expire between two
 * iterations — the suite runs its files in parallel, and the test failed on load
 * rather than on behaviour. Reading the delay as of `start` cannot expire.
 */
async function delayAfter(email: string, calls: number): Promise<number> {
  forgetThrottling();
  const start = Date.now();
  for (let call = 0; call < calls; call += 1) {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/code/request',
      payload: { email },
    });
    assert.equal(response.statusCode, 202, response.body);
  }
  return context.throttle.blockedForIp(INJECTED_IP, start);
}
