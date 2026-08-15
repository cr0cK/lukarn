import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { DEFAULT_PRIMARY_COLOR, derivePalette, ICON_VARIANTS } from '@lukarn/shared';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import { renderMark } from '../src/branding/mark.js';
import type { AppContext } from '../src/context.js';
import { loadEnv } from '../src/env.js';

/**
 * The instance's visual identity: the palette derived from one colour, the mark
 * drawn as source, and the routes that serve both.
 *
 * What matters here is not that an image comes back — it is that the derivation
 * is the *same* everywhere it happens, and that the fallbacks hold. A logo is
 * decoration; a gallery that stops serving because its logo is unreadable is a
 * failure, so several of these tests are about refusing to fail.
 */

const MARK = fileURLToPath(new URL('../../../assets/lukarn-mark.svg', import.meta.url));

describe('palette', () => {
  it('derives four colours a 2019 browser can parse', () => {
    // Chromium 79 drops a declaration whose value it cannot parse — the button
    // loses its background rather than its exact shade. Nothing here may emit
    // `color-mix()` or `oklch()`, whatever colour it is given (D260813).
    for (const primary of ['#eb2020', '#7aa2ff', '#000000', '#ffffff', '#3fae2a']) {
      for (const [name, value] of Object.entries(derivePalette(primary))) {
        // Eight digits for `accentSoft` alone, which is translucent so that one
        // value lands correctly on a dark panel and on a light one (D260815d).
        // Chromium has read that form since 62.
        assert.match(value, /^#[0-9a-f]{6}([0-9a-f]{2})?$/, `${name} for ${primary}`);
      }
    }
  });

  it('reads a foreground white on the brand red and dark on a pale accent', () => {
    // The whole reason `accent-ink` exists: `bg-accent text-ink-950` was fine on
    // the previous blue and unreadable on red.
    assert.equal(derivePalette('#eb2020').accentInk, '#ffffff');
    assert.equal(derivePalette('#7aa2ff').accentInk, '#08080a');
  });

  it('keeps the soft tint close to the panel it sits on', () => {
    // A sixteenth of the accent, left to the browser to composite: a hovered row
    // is tinted, not repainted. A value that drifted towards the accent would
    // turn every menu row into a button.
    assert.equal(derivePalette(DEFAULT_PRIMARY_COLOR).accentSoft, '#eb202029');
    assert.equal(derivePalette(DEFAULT_PRIMARY_COLOR).accentDim, '#a91717');
  });

  it('lands the soft tint where the opaque mix used to, on the dark panel', () => {
    // The value this replaced was `#351417` — 16 % of the red mixed into
    // `--color-ink-850` by hand. Compositing must not change what a hovered row
    // looks like on the theme that already existed, only make it right on the
    // one that did not (D260815d).
    const INK_850 = [0x12, 0x12, 0x15];
    const soft = derivePalette(DEFAULT_PRIMARY_COLOR).accentSoft;
    const [r, g, b, a] = [1, 3, 5, 7].map((i) => Number.parseInt(soft.slice(i, i + 2), 16));
    const over = [r!, g!, b!].map((v, i) => Math.round((v * a! + INK_850[i]! * (255 - a!)) / 255));

    assert.deepEqual(over, [0x35, 0x14, 0x17]);
  });

  it('falls back to the default rather than throwing on a malformed colour', () => {
    // This runs while rendering a page: a bad setting must cost the brand colour,
    // not the ability to serve.
    for (const bad of ['', 'red', '#fff', 'rgb(1,2,3)', '#gggggg']) {
      assert.equal(derivePalette(bad).accent, DEFAULT_PRIMARY_COLOR);
    }
  });
});

describe('the mark', () => {
  it('is the file committed for the documentation', () => {
    // `assets/lukarn-mark.svg` illustrates README.md while `renderMark` draws
    // what the application serves. Two copies of one shape drift, and the one
    // that drifts is the one nobody looks at.
    assert.equal(readFileSync(MARK, 'utf8'), renderMark(DEFAULT_PRIMARY_COLOR));
  });

  it('carries the requested colour on the dot and nowhere else', () => {
    const green = renderMark('#3fae2a');
    assert.match(green, /<circle[^>]*fill="#3fae2a"/);
    assert.doesNotMatch(green, new RegExp(DEFAULT_PRIMARY_COLOR));
    // The square and the L are fixed: only the dot is the instance's.
    assert.match(green, /<rect width="256" height="256"[^>]*fill="#08080a"/);
  });

  it('never interpolates a value that is not a colour', () => {
    // This string is served as `image/svg+xml` from our own origin: an attribute
    // injection here would be script execution on the session's origin.
    const forged = renderMark('#000" onload="alert(1)');
    assert.doesNotMatch(forged, /onload/);
    assert.match(forged, new RegExp(`fill="${DEFAULT_PRIMARY_COLOR}"`));
  });
});

describe('branding routes', () => {
  let dir: string;
  let server: FastifyInstance;
  let context: AppContext;
  let cookie: string;

  const env = (base: string) =>
    loadEnv(
      {
        NODE_ENV: 'test',
        DATA_DIR: join(base, 'data'),
        CACHE_DIR: join(base, 'cache'),
        CONFIG_PATH: join(base, 'absent.yaml'),
        WEB_DIR: join(base, 'no-front-end'),
        SESSION_SECRET: 'z'.repeat(40),
        TOKEN_KEY: 'y'.repeat(40),
        GEOCODING_URL: '',
      },
      base,
    );

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lukarn-branding-'));
    ({ server, context } = await buildApp(env(dir)));

    context.config.createUser({
      username: 'alexis',
      passwordHash: await argon2.hash('motdepasse'),
      admin: true,
      albums: ['*'],
    });
    const login = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alexis', password: 'motdepasse' },
    });
    cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  });

  after(async () => {
    await server.close();
    context.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** A tiny valid PNG, produced rather than pasted as a base64 blob. */
  const png = (colour: string) =>
    sharp({ create: { width: 64, height: 64, channels: 4, background: colour } })
      .png()
      .toBuffer();

  it('serves the built-in mark without a session', async () => {
    // The sign-in screen carries it, and the tab icon is fetched before any
    // session exists: an authenticated logo would be no logo at all.
    const response = await server.inject({ method: 'GET', url: '/api/branding/logo' });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] as string, /image\/svg\+xml/);
    assert.equal(response.body, renderMark(context.settings.primaryColor));
  });

  it('answers 304 when the client already holds it', async () => {
    const first = await server.inject({ method: 'GET', url: '/api/branding/logo' });
    const etag = first.headers.etag as string;
    assert.ok(etag);

    const again = await server.inject({
      method: 'GET',
      url: '/api/branding/logo',
      headers: { 'if-none-match': etag },
    });
    assert.equal(again.statusCode, 304);
    assert.equal(again.body, '');
    // `no-cache`, never `immutable`: the URL is stable while the image is not.
    assert.match(again.headers['cache-control'] as string, /no-cache/);
  });

  it('changes its ETag when the colour changes', async () => {
    const before = (await server.inject({ method: 'GET', url: '/api/branding/logo' })).headers.etag;
    context.updateSettings({ primaryColor: '#3fae2a' });
    const after = await server.inject({ method: 'GET', url: '/api/branding/logo' });

    assert.notEqual(after.headers.etag, before);
    assert.match(after.body, /fill="#3fae2a"/);
    context.updateSettings({ primaryColor: DEFAULT_PRIMARY_COLOR });
  });

  it('generates every icon the manifest and index.html name', async () => {
    for (const [nom, variant] of Object.entries(ICON_VARIANTS)) {
      const response = await server.inject({ method: 'GET', url: `/api/branding/icon-${nom}` });
      assert.equal(response.statusCode, 200, nom);
      assert.equal(response.headers['content-type'], 'image/png');

      const meta = await sharp(response.rawPayload).metadata();
      assert.equal(meta.width, variant.size, nom);
      assert.equal(meta.height, variant.size, nom);
    }
  });

  it('refuses a size it does not generate', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/branding/icon-1024.png' });
    assert.equal(response.statusCode, 404);
  });

  it('replaces the mark with an upload, then puts it back', async () => {
    const upload = await server.inject({
      method: 'PUT',
      url: '/api/admin/branding/logo',
      headers: { cookie, 'content-type': 'image/png' },
      payload: await png('#123456'),
    });
    assert.equal(upload.statusCode, 200);

    const logo = await server.inject({ method: 'GET', url: '/api/branding/logo' });
    assert.equal(logo.headers['content-type'], 'image/png');
    assert.equal((await sharp(logo.rawPayload).metadata()).format, 'png');

    // The dashboard is what tells the form there is something to reset.
    const status = await server.inject({
      method: 'GET',
      url: '/api/admin/status',
      headers: { cookie },
    });
    assert.equal(status.json().logoCustom, true);

    const removed = await server.inject({
      method: 'DELETE',
      url: '/api/admin/branding/logo',
      headers: { cookie },
    });
    assert.equal(removed.statusCode, 200);
    const back = await server.inject({ method: 'GET', url: '/api/branding/logo' });
    assert.match(back.headers['content-type'] as string, /svg/);
  });

  it('rasterises an SVG instead of relaying it', async () => {
    // The whole security answer: an operator's SVG is accepted as input and never
    // survives as one, so `<script>` in it never reaches a same-origin document.
    const hostile =
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
      '<script>alert(1)</script><rect width="64" height="64" fill="#123456"/></svg>';

    const upload = await server.inject({
      method: 'PUT',
      url: '/api/admin/branding/logo',
      headers: { cookie, 'content-type': 'image/svg+xml' },
      payload: Buffer.from(hostile),
    });
    assert.equal(upload.statusCode, 200);

    const logo = await server.inject({ method: 'GET', url: '/api/branding/logo' });
    assert.equal(logo.headers['content-type'], 'image/png');
    assert.ok(!logo.body.includes('alert'));

    await server.inject({
      method: 'DELETE',
      url: '/api/admin/branding/logo',
      headers: { cookie },
    });
  });

  it('reports an unreadable upload as the caller error it is', async () => {
    const response = await server.inject({
      method: 'PUT',
      url: '/api/admin/branding/logo',
      headers: { cookie, 'content-type': 'image/png' },
      payload: Buffer.from('this is not an image'),
    });
    // 400, not 500: the instance is fine, the file is not.
    assert.equal(response.statusCode, 400);
  });

  it('refuses a body above the half-megabyte limit', async () => {
    const response = await server.inject({
      method: 'PUT',
      url: '/api/admin/branding/logo',
      headers: { cookie, 'content-type': 'image/png' },
      payload: Buffer.alloc(600 * 1024, 7),
    });
    assert.equal(response.statusCode, 413);
  });

  it('lets nobody but an administrator change it', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: '/api/admin/branding/logo',
    });
    assert.equal(response.statusCode, 401);
  });
});
