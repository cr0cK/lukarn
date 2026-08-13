import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ICON_VARIANTS, isIconName } from '@lukarn/shared';

/**
 * The manifest and its icons.
 *
 * The important invariant is that a wrong icon path breaks nothing visible —
 * the grid renders and the console stays silent — but makes the application
 * impossible to install. Nobody notices until a relative gives up adding the
 * icon to their home screen.
 *
 * The icons are no longer files in `public/`: they are generated from whichever
 * logo the instance uses. So the check that used to look for them on disk now
 * checks that every declared URL is one the branding route will actually answer —
 * the same failure, moved to where the truth now lives.
 */

const WEB = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = join(WEB, 'public');

/** The `<name>` in `/api/branding/icon-<name>`, or `null` for any other URL. */
function iconName(url: string): string | null {
  return /^\/api\/branding\/icon-(.+)$/.exec(url)?.[1] ?? null;
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
  it('all name a size the branding route generates', () => {
    for (const icone of manifeste.icons as { src: string }[]) {
      const name = iconName(icone.src);
      assert.ok(name, `${icone.src} is not a branding-route icon`);
      assert.ok(isIconName(name), `${icone.src} names no generated size`);
    }
  });

  it('declare the size the route actually renders', () => {
    // A manifest promising 512 px and receiving 192 leaves an installed icon
    // blurry on a dense screen, with nothing in the console about it.
    for (const icone of manifeste.icons as { src: string; sizes: string }[]) {
      const variant = ICON_VARIANTS[iconName(icone.src) as keyof typeof ICON_VARIANTS];
      assert.equal(icone.sizes, `${variant.size}x${variant.size}`, icone.src);
    }
  });

  it('cover the iOS home screen, which the manifest alone cannot serve', () => {
    // Safari ignores `icons` for the home-screen icon: without this link, iOS
    // uses a screenshot of the page instead of the design. It must be a PNG —
    // Safari renders no SVG here — so it cannot reuse `/api/branding/logo`.
    const lien = /<link[^>]+rel="apple-touch-icon"[^>]+href="([^"]+)"/.exec(html);
    assert.ok(lien, 'index.html does not declare an apple-touch-icon');
    const name = iconName(lien[1]!);
    assert.ok(name && isIconName(name), `${lien[1]} names no generated size`);
  });

  it('are announced to the browser from index.html', () => {
    assert.match(html, /<link[^>]+rel="manifest"[^>]+href="\/manifest\.webmanifest"/);
    // The tab icon is the logo itself rather than a generated size: it is the
    // one place a vector is welcome, and it follows an uploaded logo too.
    assert.match(html, /<link[^>]+rel="icon"[^>]+href="\/api\/branding\/logo"/);
  });
});
