import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';
import type { MediaUpsert } from '../src/repo.js';

/**
 * Share links: an album, or one photograph, opened by somebody with no account
 * (D260825).
 *
 * Four invariants govern what follows, and each is a decision rather than a detail.
 * A link is a **credential of its own**, so `canSee` is never asked about one and a
 * link's session reaches nothing an album's routes serve. A link that **once worked**
 * answers 410 and says which of revoked or expired happened, while a token that never
 * existed answers 404 (D260825b). A shared **photograph names its album nowhere** its
 * recipient can reach (D260825e). And an opening is recorded **once per session and
 * hour**, carrying no photograph, no address and no IP (D260825c).
 */

const root = mkdtempSync(join(tmpdir(), 'lukarn-shares-'));

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

const PASSWORD = 'mot-de-passe-de-test';

/** Thirty-two base64url characters short of the real length: never minted. */
const NEVER_MINTED = 'z'.repeat(43);

let server: FastifyInstance;
let context: AppContext;

function photo(albumId: string, id: string): MediaUpsert {
  return {
    albumId,
    id,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    size: 1000,
    width: 400,
    height: 300,
    takenAt: '2026-07-01T10:00:00.000Z',
    takenAtFromExif: true,
    modifiedTime: '2026-07-01T10:00:00.000Z',
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
    md5: 'abcdef0123456789',
    hasThumbnail: true,
    videoCodec: null,
    sourcePath: null,
  };
}

/** Mints a link straight through the repository: the admin route is tested separately. */
function mint(input: { mediaId?: string | null; expiresAt?: string | null } = {}): string {
  return context.shares.create({
    albumId: 'corse',
    mediaId: input.mediaId ?? null,
    label: null,
    createdBy: 'patron',
    expiresAt: input.expiresAt ?? null,
  }).token;
}

/** Opens the link and returns its session cookie, asserting the link worked. */
async function open(token: string): Promise<string> {
  const response = await server.inject({ method: 'GET', url: `/api/share/${token}` });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = response.cookies.find((entry) => entry.name === 'lukarn_session');
  assert.ok(cookie, 'opening a link opens a session');
  return `lukarn_session=${cookie.value}`;
}

before(async () => {
  const built = await buildApp(env);
  server = built.server;
  context = built.context;

  context.config.createAlbum({ id: 'corse', title: 'Corse', folderId: 'f1', recursive: true });
  context.config.createAlbum({ id: 'noel', title: 'Noël', folderId: 'f2', recursive: true });
  context.config.createUser({
    username: 'patron',
    passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    admin: true,
    albums: ['corse', 'noel'],
  });
  context.media.upsertMany(
    [photo('corse', 'img-1'), photo('corse', 'img-2'), photo('noel', 'img-9')],
    '2026-07-01T00:00:00.000Z',
  );
});

after(async () => {
  await server?.close();
  context?.close();
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  context.db.prepare('DELETE FROM share_links').run();
  context.db.prepare('DELETE FROM sessions').run();
  context.db.prepare('DELETE FROM comments').run();
});

describe('what a link that no longer works answers', () => {
  it('answers 404 for a token nothing ever minted', async () => {
    const response = await server.inject({ method: 'GET', url: `/api/share/${NEVER_MINTED}` });

    // The same answer a mistyped address gets anywhere else (D12): nothing a
    // stranger can discover changes.
    assert.equal(response.statusCode, 404);
  });

  it('answers 404 for a token outside the minted shape, without a query', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/share/pas-un-jeton' });
    assert.equal(response.statusCode, 404);
  });

  it('answers 410 and names revocation for a link that was taken back', async () => {
    const token = mint();
    context.shares.revoke(token);

    const response = await server.inject({ method: 'GET', url: `/api/share/${token}` });

    // 410 rather than 404, and which of the two happened: the reader was sent this
    // address by somebody they know and cannot otherwise tell a mistyped address
    // from one that was taken back (D260825b).
    assert.equal(response.statusCode, 410);
    assert.equal(response.json().error, 'share_revoked');
  });

  it('answers 410 and names expiry for a link whose date has passed', async () => {
    const token = mint({ expiresAt: '2020-01-01T00:00:00.000Z' });

    const response = await server.inject({ method: 'GET', url: `/api/share/${token}` });

    assert.equal(response.statusCode, 410);
    assert.equal(response.json().error, 'share_expired');
  });

  it('keeps the row on revocation, which is what makes the two distinguishable', () => {
    const token = mint();
    context.shares.revoke(token);

    // Deleting the row is the obvious implementation and it makes D260825b
    // impossible: revoked and never-existed become the same state.
    assert.ok(context.shares.find(token));
    assert.ok(context.shares.find(token)!.revokedAt);
  });

  it('closes the sessions a revoked link had opened', async () => {
    const token = mint();
    await open(token);
    assert.deepEqual(context.db.prepare('SELECT COUNT(*) AS n FROM sessions').get(), { n: 1 });

    context.shares.revoke(token);

    // The whole point of revoking is that an already-open browser stops.
    assert.deepEqual(context.db.prepare('SELECT COUNT(*) AS n FROM sessions').get(), { n: 0 });
  });
});

describe('what a shared photograph never names', () => {
  it('serves the photograph without its album', async () => {
    const token = mint({ mediaId: 'img-1' });

    const response = await server.inject({ method: 'GET', url: `/api/share/${token}` });

    assert.equal(response.statusCode, 200);
    // The whole body, not one field: an album name says who was there, when, and
    // that there are more of them — the thing deliberately not sent (D260825e).
    assert.ok(!response.body.includes('albumId'));
    assert.ok(!response.body.includes('corse'));
    assert.equal(response.json().kind, 'media');
  });

  it('serves a shared album without its identifier either', async () => {
    const token = mint();

    const response = await server.inject({ method: 'GET', url: `/api/share/${token}` });

    // Only the photograph case requires it, and one shape for both is what stops a
    // later field arriving on the album path and being forgotten on the other.
    assert.equal(response.json().title, 'Corse');
    assert.ok(!response.body.includes('albumId'));
  });

  it('serves the grid without album identifiers', async () => {
    const token = mint();
    const cookie = await open(token);

    const response = await server.inject({
      method: 'GET',
      url: `/api/share/${token}/items`,
      headers: { cookie },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().items.length, 2);
    assert.ok(!response.body.includes('albumId'));
  });

  it('says the photograph is gone rather than that the address is wrong', async () => {
    const token = mint({ mediaId: 'img-1' });
    // What `deleteStale` does when a synchronisation misses a file: the link is
    // live and covers nothing. `share_links.media_id` carries no foreign key for
    // exactly this reason — an indexing incident must not destroy a link somebody
    // has already sent.
    context.db.prepare("DELETE FROM media WHERE album_id = 'corse' AND id = 'img-1'").run();

    const response = await server.inject({ method: 'GET', url: `/api/share/${token}` });

    assert.equal(response.statusCode, 410);
    assert.equal(response.json().error, 'share_gone');

    context.media.upsertMany([photo('corse', 'img-1')], '2026-07-01T00:00:00.000Z');
  });

  it('has no grid to serve for a photograph link', async () => {
    const token = mint({ mediaId: 'img-1' });

    const response = await server.inject({ method: 'GET', url: `/api/share/${token}/items` });

    assert.equal(response.statusCode, 404);
  });
});

describe('what a link covers, and what it does not', () => {
  it('serves a photograph the album indexes', async () => {
    const token = mint();

    const response = await server.inject({ method: 'GET', url: `/api/share/${token}/items/img-2` });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().id, 'img-2');
  });

  it('refuses a photograph from another album', async () => {
    const token = mint();

    const response = await server.inject({ method: 'GET', url: `/api/share/${token}/items/img-9` });

    assert.equal(response.statusCode, 404);
  });

  it('refuses every photograph but its own on a photograph link', async () => {
    const token = mint({ mediaId: 'img-1' });

    const mine = await server.inject({ method: 'GET', url: `/api/share/${token}/items/img-1` });
    const other = await server.inject({ method: 'GET', url: `/api/share/${token}/items/img-2` });

    assert.equal(mine.statusCode, 200);
    // Sharing one photograph shares one photograph, not the album around it.
    assert.equal(other.statusCode, 404);
  });

  it('serves media bytes through the same prefix an account uses', async () => {
    const token = mint({ mediaId: 'img-1' });
    const cookie = await open(token);

    const covered = await server.inject({
      method: 'GET',
      url: '/api/media/img-1/thumb?s=320',
      headers: { cookie },
    });
    const other = await server.inject({
      method: 'GET',
      url: '/api/media/img-2/thumb?s=320',
      headers: { cookie },
    });

    // The link is read at the `/media` prefix `preHandler`, beside the account
    // (D260825). A 503 here means the check passed and the storage is absent, which
    // is what this test is about; what matters is that the other photograph is 404.
    assert.notEqual(covered.statusCode, 404);
    assert.equal(other.statusCode, 404);
  });

  it('keeps Vary: Cookie on media, so a link cache is its own', async () => {
    const token = mint({ mediaId: 'img-1' });
    const cookie = await open(token);

    const response = await server.inject({
      method: 'GET',
      url: '/api/media/img-1/thumb?s=320',
      headers: { cookie, 'if-none-match': '"nothing"' },
    });

    // D43's property, unchanged by a fourth credential: the browser's private cache
    // is indexed by session, so two links used in one profile share no entry.
    if (response.statusCode === 200 || response.statusCode === 304) {
      assert.equal(response.headers.vary, 'Cookie');
    }
  });
});

describe('what a link session reaches elsewhere', () => {
  it('answers 404, never 403, on the album routes', async () => {
    const token = mint();
    const cookie = await open(token);

    for (const url of ['/api/albums', '/api/albums/corse', '/api/albums/corse/items']) {
      const response = await server.inject({ method: 'GET', url, headers: { cookie } });
      // The only 403s are `/api/admin/*` and the standing `identity_required`
      // (D12, D50). A link is refused here because `canSee` is never asked about
      // one, and a second predicate beside it is what D260825 refuses.
      assert.equal(response.statusCode, 404, url);
    }
  });

  it('answers 404 on search and on the album-keyed comment routes', async () => {
    const token = mint();
    const cookie = await open(token);

    for (const url of ['/api/search?q=corse', '/api/comments/corse', '/api/comments/corse/img-1']) {
      const response = await server.inject({ method: 'GET', url, headers: { cookie } });
      assert.equal(response.statusCode, 404, url);
    }
  });

  it('answers 403 on administration, which is the documented exception', async () => {
    const token = mint();
    const cookie = await open(token);

    const response = await server.inject({
      method: 'GET',
      url: '/api/admin/shares',
      headers: { cookie },
    });

    // `admin` is false on a link's session, and the existence of the admin area is
    // not a secret (D12).
    assert.equal(response.statusCode, 403);
  });

  it('answers /api/auth/me with the account shape and no username', async () => {
    const token = mint();
    const cookie = await open(token);

    const response = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });

    // The same shape an account gets, adjusted rather than extended: this is what
    // lets the identity form and the comment stack work through a link without
    // being told a link exists (D260825).
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().username, null);
    assert.equal(response.json().admin, false);
    assert.ok('commentsEnabled' in response.json());
  });
});

describe('an account that opens a link', () => {
  async function signIn(): Promise<string> {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'patron', password: PASSWORD },
    });
    const cookie = response.cookies.find((entry) => entry.name === 'lukarn_session');
    assert.ok(cookie);
    return `lukarn_session=${cookie.value}`;
  }

  it('keeps its account, and is not counted as an opening', async () => {
    const token = mint();
    const cookie = await signIn();

    const response = await server.inject({
      method: 'GET',
      url: `/api/share/${token}`,
      headers: { cookie },
    });

    assert.equal(response.statusCode, 200);
    // There is one session cookie per browser: minting here would sign the owner
    // out of their own instance for having checked the link they just issued.
    assert.equal(
      response.cookies.find((entry) => entry.name === 'lukarn_session'),
      undefined,
    );
    const session = context.db.prepare('SELECT username, share_token FROM sessions').get() as {
      username: string;
      share_token: string | null;
    };
    assert.equal(session.username, 'patron');
    assert.equal(session.share_token, null);

    // And their visit is not counted: what the openings answer is "did it reach the
    // person I sent it to", which the issuer testing their own link would make lie.
    const rows = context.db
      .prepare('SELECT COUNT(*) AS n FROM share_openings WHERE token = ?')
      .get(token) as { n: number };
    assert.equal(rows.n, 0);
  });

  it('gets a link session when the account cannot see the album itself', async () => {
    context.config.createUser({
      username: 'voisine',
      passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      admin: false,
      albums: ['noel'],
    });
    const login = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'voisine', password: PASSWORD },
    });
    const cookie = `lukarn_session=${login.cookies.find((entry) => entry.name === 'lukarn_session')!.value}`;

    const token = mint();
    const response = await server.inject({
      method: 'GET',
      url: `/api/share/${token}`,
      headers: { cookie },
    });

    assert.equal(response.statusCode, 200);
    // Somebody sent them a link to an album nobody gave them: they are a recipient
    // like any other. Keeping their account here would draw the page and then have
    // the `/media` prefix refuse every photograph on it.
    const issued = response.cookies.find((entry) => entry.name === 'lukarn_session');
    assert.ok(issued, 'a link session is issued');

    // Looked up by the link rather than by the cookie, whose value is signed.
    const session = context.db
      .prepare('SELECT id, username FROM sessions WHERE share_token = ?')
      .get(token) as { id: string; username: string | null } | undefined;
    assert.ok(session, 'the session points at the link');
    assert.equal(session.username, null);

    const thumb = await server.inject({
      method: 'GET',
      url: '/api/media/img-1/thumb?s=320',
      headers: { cookie: `lukarn_session=${issued.value}` },
    });
    // The check passed; a 503 here is the absent storage, which is not what this
    // asserts. A 404 would be the link being refused what it covers.
    assert.notEqual(thumb.statusCode, 404);

    context.config.deleteUser('voisine');
  });
});

describe('what an opening records', () => {
  it('counts one opening per session and hour', async () => {
    const token = mint();
    const cookie = await open(token);

    await server.inject({ method: 'GET', url: `/api/share/${token}`, headers: { cookie } });
    await server.inject({ method: 'GET', url: `/api/share/${token}`, headers: { cookie } });

    const rows = context.db
      .prepare('SELECT COUNT(*) AS n FROM share_openings WHERE token = ?')
      .get(token) as { n: number };

    // The primary key is the rule: a reader who refreshes the page does not turn
    // one visit into six (D260825c).
    assert.equal(rows.n, 1);
  });

  it('counts two visitors separately', async () => {
    const token = mint();
    await open(token);
    await open(token);

    const rows = context.db
      .prepare('SELECT COUNT(*) AS n FROM share_openings WHERE token = ?')
      .get(token) as { n: number };

    assert.equal(rows.n, 2);
  });

  it('records no photograph, no address and no IP', () => {
    const columns = (context.db.pragma('table_info(share_openings)') as { name: string }[]).map(
      (row) => row.name,
    );

    // The boundary D260809h drew does not move. What is recorded is that a link was
    // opened, never what was looked at through it.
    assert.deepEqual(columns, ['token', 'session_id', 'hour', 'opened_at']);
  });

  it('keeps the openings of a revoked link and drops those of a deleted one', async () => {
    const token = mint();
    await open(token);

    context.shares.revoke(token);
    const afterRevoke = context.db
      .prepare('SELECT COUNT(*) AS n FROM share_openings WHERE token = ?')
      .get(token) as { n: number };
    // The history is what the person deciding whether to cut a link off was
    // reading; cutting it off must not erase what justified the decision.
    assert.equal(afterRevoke.n, 1);

    context.shares.remove(token);
    const afterDelete = context.db
      .prepare('SELECT COUNT(*) AS n FROM share_openings WHERE token = ?')
      .get(token) as { n: number };
    assert.equal(afterDelete.n, 0);
  });
});

describe('commenting through a link', () => {
  it('costs a verified identity, and says so with the standing 403', async () => {
    const token = mint({ mediaId: 'img-1' });
    const cookie = await open(token);

    const response = await server.inject({
      method: 'POST',
      url: `/api/share/${token}/comments/img-1`,
      headers: { cookie },
      payload: { body: 'Elle est très belle' },
    });

    // Commenting through a link still costs a six-digit code sent to an address
    // (D39). This 403 concerns the state of the requester's own session, which is
    // why it is not a 404.
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, 'identity_required');
  });

  it('records the link in comments.account, not an access key', async () => {
    const token = mint({ mediaId: 'img-1' });
    const cookie = await open(token);

    const commenter = context.commenters.declare('tante@exemple.fr', 'Tante');
    context.commenters.markVerified('tante@exemple.fr');
    const sessionId = context.db
      .prepare('SELECT id FROM sessions WHERE share_token = ?')
      .get(token) as { id: string };
    context.sessions.attachCommenter(sessionId.id, commenter.id);

    const response = await server.inject({
      method: 'POST',
      url: `/api/share/${token}/comments/img-1`,
      headers: { cookie },
      payload: { body: 'Elle est très belle' },
    });

    assert.equal(response.statusCode, 201, response.body);
    const row = context.db.prepare('SELECT account, album_id FROM comments').get() as {
      account: string;
      album_id: string;
    };
    // A link is a credential and not a person: the author stays a `commenters`
    // identity, and the column records which invitation delivered the message (D38).
    assert.equal(row.account, token);
    // The thread still resolves through (album_id, media_id), so a comment written
    // through a link lands in the conversation an account sees (D34).
    assert.equal(row.album_id, 'corse');
  });

  it('subscribes a shared album visitor and a shared photograph nobody', async () => {
    const commenter = context.commenters.declare('oncle@exemple.fr', 'Oncle');
    context.commenters.markVerified('oncle@exemple.fr');

    const identify = async (token: string): Promise<string> => {
      const cookie = await open(token);
      const row = context.db
        .prepare('SELECT id FROM sessions WHERE share_token = ?')
        .get(token) as { id: string };
      context.sessions.attachCommenter(row.id, commenter.id);
      return cookie;
    };

    const single = mint({ mediaId: 'img-1' });
    const cookieSingle = await identify(single);
    await server.inject({
      method: 'GET',
      url: `/api/share/${single}`,
      headers: { cookie: cookieSingle },
    });
    // A shared photograph subscribes nobody, because no album was opened — D41's
    // own condition rather than an exception to it (D260825e).
    assert.equal(context.subscriptions.subscribers('corse').length, 0);

    const album = mint();
    const cookieAlbum = await identify(album);
    await server.inject({
      method: 'GET',
      url: `/api/share/${album}`,
      headers: { cookie: cookieAlbum },
    });
    // A shared album subscribes its verified visitor, exactly as opening it with an
    // account does (D41).
    //
    // The reopening above is not contrivance: it is what the page does after the
    // six digits are accepted (`useVerifyIdentity` invalidates the share query).
    // The server only ever subscribes an **already verified** identity, and on a
    // link the whole visit is one opening — verify after it and nothing would
    // subscribe at all.
    assert.equal(context.subscriptions.subscribers('corse').length, 1);
  });
});

describe('administration', () => {
  async function adminCookie(): Promise<string> {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'patron', password: PASSWORD },
    });
    const cookie = response.cookies.find((entry) => entry.name === 'lukarn_session');
    assert.ok(cookie);
    return `lukarn_session=${cookie.value}`;
  }

  it('issues a link and lists it with its record of use', async () => {
    const cookie = await adminCookie();

    const created = await server.inject({
      method: 'POST',
      url: '/api/admin/shares',
      headers: { cookie },
      payload: { albumId: 'corse', label: 'Pour mamie' },
    });
    assert.equal(created.statusCode, 201, created.body);

    const token = created.json().token as string;
    await open(token);

    const listed = await server.inject({
      method: 'GET',
      url: '/api/admin/shares',
      headers: { cookie },
    });
    const row = listed.json()[0] as { openingCount: number; label: string; state: string };
    assert.equal(row.label, 'Pour mamie');
    assert.equal(row.state, 'live');
    assert.equal(row.openingCount, 1);
  });

  it('refuses a photograph that is not in the album', async () => {
    const cookie = await adminCookie();

    const response = await server.inject({
      method: 'POST',
      url: '/api/admin/shares',
      headers: { cookie },
      payload: { albumId: 'corse', mediaId: 'img-9' },
    });

    // Otherwise the link would answer 410 the moment its recipient opened it, and
    // whoever issued it would learn that from them.
    assert.equal(response.statusCode, 404);
  });
});
