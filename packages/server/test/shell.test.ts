import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { DEFAULT_PRIMARY_COLOR, derivePalette } from '@lukarn/shared';
import { renderManifest, renderShell } from '../src/shell.js';

/**
 * Instance identity substitution.
 *
 * This protects the contract between the repository template and the patterns
 * in `shell.ts`. Adding an attribute to the `<title>` tag, swapping `name` and
 * `content` in a `<meta>`, or dropping the `style` attribute from `<html>`
 * breaks nothing obvious — the server starts and the page renders, but carries
 * the wrong name or the built-in colour. The test reads the **real**
 * `index.html` so this mismatch appears here rather than on a home screen.
 */

const INDEX = fileURLToPath(new URL('../../web/index.html', import.meta.url));
const MANIFESTE = fileURLToPath(new URL('../../web/public/manifest.webmanifest', import.meta.url));

const MARTIN = { instanceName: 'Chez les Martin', primaryColor: DEFAULT_PRIMARY_COLOR };

describe('HTML shell', () => {
  it('replaces all three locations in the real template', () => {
    const rendu = renderShell(readFileSync(INDEX, 'utf8'), MARTIN);

    assert.match(rendu, /<title>Chez les Martin<\/title>/);
    assert.match(rendu, /name="apple-mobile-web-app-title" content="Chez les Martin"/);
    assert.match(rendu, /name="application-name" content="Chez les Martin"/);
    assert.doesNotMatch(rendu, /Photos/, 'no default name should remain');
  });

  it('escapes content that would break the surrounding HTML', () => {
    // The name is set by an administrator, not a visitor — but one quote is
    // enough to escape the attribute and break the header.
    const rendu = renderShell(readFileSync(INDEX, 'utf8'), {
      ...MARTIN,
      instanceName: 'Photos "de" <famille> & co',
    });

    assert.match(rendu, /<title>Photos &quot;de&quot; &lt;famille&gt; &amp; co<\/title>/);
    assert.doesNotMatch(rendu, /content="Photos "de"/);
  });

  it('writes the whole palette into the html style attribute', () => {
    const palette = derivePalette('#3b82f6');
    const rendu = renderShell(readFileSync(INDEX, 'utf8'), {
      ...MARTIN,
      primaryColor: '#3b82f6',
    });

    const style = /<html\b[^>]*\sstyle="([^"]*)"/.exec(rendu);
    assert.ok(style, 'the shell no longer carries a style attribute on <html>');
    // All four, not just the accent: the three derived values are what the
    // stylesheet actually paints hovers, borders and button labels with.
    assert.equal(
      style[1],
      `--color-accent: ${palette.accent}; --color-accent-dim: ${palette.accentDim}; ` +
        `--color-accent-soft: ${palette.accentSoft}; --color-accent-ink: ${palette.accentInk}`,
    );
    // The default that the template carries for `pnpm dev` must be gone: leaving
    // it would mean the configured colour never reaches the page.
    assert.doesNotMatch(rendu, new RegExp(DEFAULT_PRIMARY_COLOR));
  });

  it('leaves the built-in palette in the template alone when nothing changes it', () => {
    // The values written into `index.html` are what `pnpm dev` serves, where
    // Vite bypasses the server entirely. They must be the ones this code would
    // have produced, or development and production would not look alike.
    const source = readFileSync(INDEX, 'utf8');
    const palette = derivePalette(DEFAULT_PRIMARY_COLOR);

    for (const value of Object.values(palette)) {
      assert.ok(source.includes(value), `index.html does not carry ${value}`);
    }
  });

  it('leaves the rest of the page intact', () => {
    const source = readFileSync(INDEX, 'utf8');
    const rendu = renderShell(source, { ...MARTIN, instanceName: 'Autre' });

    // The manifest link and entry script make this page an application: an
    // over-greedy substitution would remove them.
    assert.match(rendu, /rel="manifest"/);
    assert.match(rendu, /<div id="root">/);
    // Count lines with the opening tag collapsed: Prettier spreads the palette
    // slot over several lines in the template and this returns it to one, which
    // is a difference of layout, not of content. Everything after it must still
    // be there line for line.
    const lignes = (page: string): number =>
      page.replace(/<html\b[^>]*>/, '<html>').split('\n').length;
    assert.equal(lignes(rendu), lignes(source));
  });
});

describe('manifest', () => {
  it('overrides only the two name fields', () => {
    const source = readFileSync(MANIFESTE, 'utf8');
    const rendu = JSON.parse(renderManifest(source, MARTIN));
    const origine = JSON.parse(source);

    assert.equal(rendu.name, 'Chez les Martin');
    assert.equal(rendu.short_name, 'Chez les Martin');
    // Icons remain declared in the single place that lists them: redeclaring
    // them on the server would make the two lists diverge as soon as a size is added.
    assert.deepEqual(rendu.icons, origine.icons);
    assert.equal(rendu.display, origine.display);
    assert.equal(rendu.theme_color, origine.theme_color);
  });

  it('clearly rejects an unreadable manifest', () => {
    // This is a repository file: if it does not parse, the build is broken.
    // Serving an empty manifest would silently make the application impossible to install.
    assert.throws(() => renderManifest('{ pas du json', MARTIN));
  });
});
