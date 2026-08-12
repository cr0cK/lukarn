import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { renderManifest, renderShell } from '../src/shell.js';

/**
 * Instance name substitution.
 *
 * This protects the contract between the repository template and the patterns
 * in `shell.ts`. Adding an attribute to the `<title>` tag, or swapping `name`
 * and `content` in a `<meta>`, breaks nothing obvious — the server starts and
 * the page renders, but carries the wrong name. The test reads the **real**
 * `index.html` so this mismatch appears here rather than on a home screen.
 */

const INDEX = fileURLToPath(new URL('../../web/index.html', import.meta.url));
const MANIFESTE = fileURLToPath(new URL('../../web/public/manifest.webmanifest', import.meta.url));

describe('HTML shell', () => {
  it('replaces all three locations in the real template', () => {
    const rendu = renderShell(readFileSync(INDEX, 'utf8'), 'Chez les Martin');

    assert.match(rendu, /<title>Chez les Martin<\/title>/);
    assert.match(rendu, /name="apple-mobile-web-app-title" content="Chez les Martin"/);
    assert.match(rendu, /name="application-name" content="Chez les Martin"/);
    assert.doesNotMatch(rendu, /Photos/, 'no default name should remain');
  });

  it('escapes content that would break the surrounding HTML', () => {
    // The name comes from the operator's `.env`, not from a visitor — but one
    // quote is enough to escape the attribute and break the header.
    const rendu = renderShell(readFileSync(INDEX, 'utf8'), 'Photos "de" <famille> & co');

    assert.match(rendu, /<title>Photos &quot;de&quot; &lt;famille&gt; &amp; co<\/title>/);
    assert.doesNotMatch(rendu, /content="Photos "de"/);
  });

  it('leaves the rest of the page intact', () => {
    const source = readFileSync(INDEX, 'utf8');
    const rendu = renderShell(source, 'Autre');

    // The manifest link and entry script make this page an application: an
    // over-greedy substitution would remove them.
    assert.match(rendu, /rel="manifest"/);
    assert.match(rendu, /<div id="root">/);
    assert.equal(rendu.split('\n').length, source.split('\n').length);
  });
});

describe('manifest', () => {
  it('overrides only the two name fields', () => {
    const source = readFileSync(MANIFESTE, 'utf8');
    const rendu = JSON.parse(renderManifest(source, 'Chez les Martin'));
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
    assert.throws(() => renderManifest('{ pas du json', 'Photos'));
  });
});
