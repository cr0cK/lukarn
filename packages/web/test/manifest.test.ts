import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * The manifest and its icons.
 *
 * The important invariant is that a wrong icon path breaks nothing visible —
 * the grid renders and the console stays silent — but makes the application
 * impossible to install. Nobody notices until a relative gives up adding the
 * icon to their home screen.
 */

const WEB = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = join(WEB, 'public');

/** Vite copies `public/` unchanged to the root of `dist/`: `/x` becomes `public/x`. */
function surDisque(url: string): string {
  return join(PUBLIC, url.replace(/^\//, ''));
}

const manifeste = JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
const html = readFileSync(join(WEB, 'index.html'), 'utf8');

describe('manifest', () => {
  it('declares what installation requires', () => {
    assert.equal(manifeste.start_url, '/');
    assert.equal(manifeste.scope, '/');
    assert.equal(manifeste.display, 'standalone');
    assert.ok(manifeste.name && manifeste.short_name);
  });

  it('matches its colours to the interface', () => {
    // `--color-ink-900` from `styles.css`: the splash screen must continue the
    // application background rather than flashing white before it.
    assert.equal(manifeste.background_color, '#0b0b0d');
    assert.equal(manifeste.theme_color, '#0b0b0d');
  });

  it('provides a maskable icon so Android does not crop the design', () => {
    const masquables = manifeste.icons.filter((icone: { purpose?: string }) =>
      icone.purpose?.split(' ').includes('maskable'),
    );
    assert.ok(masquables.length > 0);
  });
});

describe('icons', () => {
  it('all exist on disk', () => {
    for (const icone of manifeste.icons as { src: string }[]) {
      assert.ok(existsSync(surDisque(icone.src)), `${icone.src} does not exist`);
    }
  });

  it('cover the iOS home screen, which the manifest alone cannot serve', () => {
    // Safari ignores `icons` for the home-screen icon: without this link, iOS
    // uses a screenshot of the page instead of the design.
    const lien = /<link[^>]+rel="apple-touch-icon"[^>]+href="([^"]+)"/.exec(html);
    assert.ok(lien, 'index.html does not declare an apple-touch-icon');
    assert.ok(existsSync(surDisque(lien[1]!)), `${lien[1]} does not exist`);
  });

  it('are announced to the browser from index.html', () => {
    assert.match(html, /<link[^>]+rel="manifest"[^>]+href="\/manifest\.webmanifest"/);
    assert.match(html, /<link[^>]+rel="icon"[^>]+href="([^"]+)"/);
    const favicon = /<link[^>]+rel="icon"[^>]+href="([^"]+)"/.exec(html);
    assert.ok(existsSync(surDisque(favicon![1]!)), `${favicon![1]} does not exist`);
  });
});
