import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ALL_ALBUMS, type AdminInviteResponse, type Album, type SessionUser } from '@lukarn/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { hasNoPassword } from '../src/crypto.js';
import { loadEnv } from '../src/env.js';
import { Mailer, type MailMessage } from '../src/mail.js';

const root = mkdtempSync(join(tmpdir(), 'lukarn-invitations-'));

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

const PASSWORD = 'mot-de-passe-admin';
let server: FastifyInstance;
let context: AppContext;
let adminCookie: string;
const sent: MailMessage[] = [];

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

before(async () => {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const built = await buildApp(env);
  server = built.server;
  context = built.context;

  // Intercept outgoing emails
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  context.mailer = new Mailer(async (msg) => {
    sent.push(msg);
  }, logger);

  context.config.createAlbum({
    id: 'famille',
    title: 'Famille',
    folderId: 'folder-famille',
    recursive: true,
  });
  context.config.createAlbum({
    id: 'vacances',
    title: 'Vacances 2026',
    folderId: 'folder-vacances',
    recursive: true,
  });

  context.config.createUser({
    username: 'admin',
    passwordHash,
    admin: true,
    albums: [ALL_ALBUMS],
  });

  adminCookie = await login('admin');
});

beforeEach(() => {
  sent.length = 0;
  context.throttle.purge(Date.now() + 2 * 60 * 60 * 1000);
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('POST /api/admin/users/invite', () => {
  it('creates member with sentinel hash, derives username, auto-subscribes albums, and queues email', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/admin/users/invite',
      headers: { cookie: adminCookie },
      payload: {
        email: 'mamie@exemple.fr',
        displayName: 'Mamie Gateau',
        albums: ['famille'],
        locale: 'fr',
      },
    });

    assert.equal(response.statusCode, 201, response.body);
    const body = response.json<AdminInviteResponse>();
    assert.equal(body.user.username, 'mamie');
    assert.equal(body.user.state, 'invited');
    assert.deepEqual(body.user.albums, ['famille']);
    assert.equal(body.inviteUrl, null, 'inviteUrl should be null when mailer is enabled');

    // Invariant: password_hash is the sentinel hash
    const stored = context.config.user('mamie');
    assert.ok(stored);
    assert.ok(hasNoPassword(stored.passwordHash));

    // Display name was declared on commenter
    const commenter = context.commenters.byEmail('mamie@exemple.fr');
    assert.ok(commenter);
    assert.equal(commenter.displayName, 'Mamie Gateau');

    // Auto-subscription registered in album_subscriptions
    const sub = context.db
      .prepare('SELECT * FROM album_subscriptions WHERE commenter_id = ? AND album_id = ?')
      .get(commenter.id, 'famille') as { state: string } | undefined;
    assert.ok(sub);
    assert.equal(sub.state, 'auto');

    // Invitation mail queued
    await context.mailer.drain();
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.to, 'mamie@exemple.fr');
    assert.match(sent[0]!.text, /https:\/\/photos\.exemple\.fr\/invite\//);
  });

  it('handles duplicate usernames by appending an incrementing suffix', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/admin/users/invite',
      headers: { cookie: adminCookie },
      payload: {
        email: 'mamie@autre-famille.fr',
        displayName: 'Autre Mamie',
        albums: ['vacances'],
      },
    });

    assert.equal(response.statusCode, 201, response.body);
    const body = response.json<AdminInviteResponse>();
    assert.equal(body.user.username, 'mamie-2');
  });

  it('generates offline inviteUrl when mailer is inactive (no 503)', async () => {
    // Temporarily disable mailer
    const originalMailer = context.mailer;
    const dummyLog = { info: () => {}, warn: () => {}, debug: () => {} };
    (context as unknown as { mailer: Mailer }).mailer = new Mailer(null, dummyLog);

    try {
      const response = await server.inject({
        method: 'POST',
        url: '/api/admin/users/invite',
        headers: { cookie: adminCookie },
        payload: {
          email: 'papy@exemple.fr',
          displayName: 'Papy',
          albums: ['famille'],
        },
      });

      assert.equal(response.statusCode, 201, response.body);
      const body = response.json<AdminInviteResponse>();
      assert.equal(body.user.username, 'papy');
      assert.ok(body.inviteUrl);
      assert.match(body.inviteUrl, /^https:\/\/photos\.exemple\.fr\/invite\/[A-Za-z0-9_-]+$/);
    } finally {
      (context as unknown as { mailer: Mailer }).mailer = originalMailer;
    }
  });

  it('refuses to invite an email already bound to another account (409 identity_taken)', async () => {
    // Let's bind mamie directly
    const commenter = context.commenters.byEmail('mamie@exemple.fr')!;
    context.commenters.markVerified('mamie@exemple.fr');
    context.db
      .prepare('UPDATE users SET commenter_id = ? WHERE username = ?')
      .run(commenter.id, 'mamie');
    context.config.invalidate();

    const response = await server.inject({
      method: 'POST',
      url: '/api/admin/users/invite',
      headers: { cookie: adminCookie },
      payload: {
        email: 'mamie@exemple.fr',
        albums: ['famille'],
      },
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json<{ error: string }>().error, 'identity_taken');
  });

  it('refuses invalid album with 400 unknown_album', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/admin/users/invite',
      headers: { cookie: adminCookie },
      payload: {
        email: 'cousin@exemple.fr',
        albums: ['album-inexistant'],
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json<{ error: string }>().error, 'unknown_album');
  });
});

describe('POST /api/admin/users/:username/invite', () => {
  it('returns inviteUrl when mailer is inactive instead of 503', async () => {
    // Create an unbound user
    context.config.createUser({
      username: 'tonton',
      passwordHash: await argon2.hash('some-pass', { type: argon2.argon2id }),
      admin: false,
      albums: ['famille'],
    });

    const originalMailer = context.mailer;
    const dummyLog = { info: () => {}, warn: () => {}, debug: () => {} };
    (context as unknown as { mailer: Mailer }).mailer = new Mailer(null, dummyLog);

    try {
      const response = await server.inject({
        method: 'POST',
        url: '/api/admin/users/tonton/invite',
        headers: { cookie: adminCookie },
        payload: { email: 'tonton@exemple.fr' },
      });

      assert.equal(response.statusCode, 200, response.body);
      const body = response.json<{ inviteUrl: string }>();
      assert.ok(body.inviteUrl);
      assert.match(body.inviteUrl, /^https:\/\/photos\.exemple\.fr\/invite\/[A-Za-z0-9_-]+$/);
    } finally {
      (context as unknown as { mailer: Mailer }).mailer = originalMailer;
    }
  });
});

describe('POST /api/auth/invite/:token (Magic Onboarding)', () => {
  it('authenticates, binds account, establishes 1-year session, and returns user and albums', async () => {
    // Create user in db first (foreign key verification_codes.username -> users.username)
    context.config.createUser({
      username: 'onboarder',
      passwordHash: 'dummy',
      admin: false,
      albums: ['famille'],
    });

    // Mint invite token for a new member
    const mintRes = context.codes.mintInviteToken('onboard@exemple.fr', 'onboarder', {
      locale: 'fr',
      bypassRateLimit: true,
    });
    assert.ok('token' in mintRes);
    const token = mintRes.token;

    const response = await server.inject({
      method: 'POST',
      url: `/api/auth/invite/${token}`,
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json<{ user: SessionUser; albums: Album[] }>();

    assert.equal(body.user.username, 'onboarder');
    assert.equal(body.user.identityBound, true);
    assert.equal(body.user.identity?.email, 'onboard@exemple.fr');
    assert.equal(body.albums.length, 1);
    assert.equal(body.albums[0]!.id, 'famille');

    // Sets lukarn_session cookie with ~1 year expiry
    const cookie = response.cookies.find((entry) => entry.name === 'lukarn_session');
    assert.ok(cookie, 'cookie lukarn_session must be set');
    assert.ok(cookie.maxAge && cookie.maxAge > 360 * 24 * 3600);

    // Commenter is verified in DB
    const commenter = context.commenters.byEmail('onboard@exemple.fr');
    assert.ok(commenter);
    assert.notEqual(commenter.verifiedAt, null);

    // User is bound in DB
    const user = context.config.user('onboarder');
    assert.ok(user);
    assert.equal(user.commenterId, commenter.id);
  });

  it('enforces single-use consumption (second use fails with 404)', async () => {
    context.config.createUser({
      username: 'singleuser',
      passwordHash: 'pass',
      admin: false,
      albums: ['famille'],
    });

    const mintRes = context.codes.mintInviteToken('singleuse@exemple.fr', 'singleuser', {
      bypassRateLimit: true,
    });
    assert.ok('token' in mintRes);
    const token = mintRes.token;

    const first = await server.inject({
      method: 'POST',
      url: `/api/auth/invite/${token}`,
    });
    assert.equal(first.statusCode, 200);

    const second = await server.inject({
      method: 'POST',
      url: `/api/auth/invite/${token}`,
    });
    assert.equal(second.statusCode, 404);
  });

  it('refuses expired tokens with 400 token_expired', async () => {
    context.config.createUser({
      username: 'expireduser',
      passwordHash: 'pass',
      admin: false,
      albums: ['famille'],
    });

    const mintRes = context.codes.mintInviteToken('expired@exemple.fr', 'expireduser', {
      bypassRateLimit: true,
    });
    assert.ok('token' in mintRes);
    const token = mintRes.token;

    // Backdate expiry in DB
    context.db
      .prepare(
        "UPDATE verification_codes SET expires_at = '2020-01-01T00:00:00.000Z' WHERE target = ?",
      )
      .run('expired@exemple.fr');

    const response = await server.inject({
      method: 'POST',
      url: `/api/auth/invite/${token}`,
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json<{ error: string }>().error, 'token_expired');
  });

  it('enforces album permissions on subscription digests for invited members', async () => {
    // 1. Admin invites member for 'famille' only
    const inviteRes = await server.inject({
      method: 'POST',
      url: '/api/admin/users/invite',
      headers: { cookie: adminCookie },
      payload: {
        email: 'scoped@exemple.fr',
        displayName: 'Scoped User',
        albums: ['famille'],
      },
    });
    assert.equal(inviteRes.statusCode, 201);
    const body = inviteRes.json<AdminInviteResponse>();
    assert.equal(body.inviteUrl, null);
    assert.equal(sent.length, 1);
    const match = sent[0]!.text.match(/\/invite\/([a-zA-Z0-9_-]+)/);
    assert.ok(match, 'invite link in email');
    const token = match[1]!;

    // Before onboarding: not verified, so not in subscribers
    assert.equal(
      context.subscriptions.subscribers('famille').some((s) => s.email === 'scoped@exemple.fr'),
      false,
    );

    // 2. Member consumes token
    const onboardRes = await server.inject({
      method: 'POST',
      url: `/api/auth/invite/${token}`,
    });
    assert.equal(onboardRes.statusCode, 200);

    // Now verified and bound to user: present in subscribers for 'famille'
    assert.equal(
      context.subscriptions.subscribers('famille').some((s) => s.email === 'scoped@exemple.fr'),
      true,
    );

    // Manually add subscription to 'vacances' (album they do NOT have permission for)
    const commenter = context.commenters.byEmail('scoped@exemple.fr')!;
    context.subscriptions.subscribe(commenter.id, 'vacances');

    // Should NOT be returned in subscribers for 'vacances' because user has no permission
    assert.equal(
      context.subscriptions.subscribers('vacances').some((s) => s.email === 'scoped@exemple.fr'),
      false,
    );
  });
});

describe('PATCH /api/auth/profile', () => {
  it('updates display name for authenticated member', async () => {
    // 1. Invite and onboard a user without display name
    const inviteRes = await server.inject({
      method: 'POST',
      url: '/api/admin/users/invite',
      headers: { cookie: adminCookie },
      payload: {
        email: 'profiletest@exemple.fr',
        albums: ['famille'],
      },
    });
    assert.equal(inviteRes.statusCode, 201);
    const token = sent[0]!.text.match(/\/invite\/([a-zA-Z0-9_-]+)/)![1]!;

    const onboardRes = await server.inject({
      method: 'POST',
      url: `/api/auth/invite/${token}`,
    });
    assert.equal(onboardRes.statusCode, 200);
    const sessionCookie = onboardRes.cookies.find((c) => c.name === 'lukarn_session')!;

    // 2. Call PATCH /api/auth/profile
    const patchRes = await server.inject({
      method: 'PATCH',
      url: '/api/auth/profile',
      headers: { cookie: `lukarn_session=${sessionCookie.value}` },
      payload: { displayName: 'Mamie Suzy' },
    });
    assert.equal(patchRes.statusCode, 200);
    const updated = patchRes.json<SessionUser>();
    assert.equal(updated.identity?.displayName, 'Mamie Suzy');

    // 3. Verify in database
    const commenter = context.commenters.byEmail('profiletest@exemple.fr')!;
    assert.equal(commenter.displayName, 'Mamie Suzy');
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/auth/profile',
      payload: { displayName: 'Hacker' },
    });
    assert.equal(res.statusCode, 401);
  });
});
