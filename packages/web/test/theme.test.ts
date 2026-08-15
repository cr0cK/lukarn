import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * The three files that must agree on what a theme is.
 *
 * `styles.css` binds the ramps, `public/theme.js` chooses one before the first
 * paint, and `src/lib/theme.ts` changes it afterwards. None of the three can
 * import from another — one is a stylesheet, one is served unbundled, one is
 * bundled — so the only thing keeping them in step is this file.
 *
 * The failure they guard against is silent in every other check: the page renders,
 * nothing is logged, and a returning reader simply gets a black flash, or a light
 * page framed by a black address bar.
 */

const WEB = fileURLToPath(new URL('..', import.meta.url));

const css = readFileSync(join(WEB, 'src/styles.css'), 'utf8');
const bootstrap = readFileSync(join(WEB, 'public/theme.js'), 'utf8');
const module = readFileSync(join(WEB, 'src/lib/theme.ts'), 'utf8');
const html = readFileSync(join(WEB, 'index.html'), 'utf8');

/**
 * The ramp declarations of a block, in order, keyed by property.
 *
 * The ramp only — `@theme` also carries the accent, which is written onto
 * `<html>` per instance and belongs to neither theme.
 */
function tokens(source: string, opening: string): Map<string, string> {
  const start = source.indexOf(opening);
  assert.notEqual(start, -1, `${opening} not found`);
  const end = source.indexOf('}', start);
  const found = new Map<string, string>();
  const ramp = /(--color-(?:ink-\d+|tint(?:-strong)?)):\s*([^;]+);/g;
  for (const [, name, value] of source.slice(start, end).matchAll(ramp)) {
    found.set(name!, value!.trim());
  }
  return found;
}

describe('the ramps in styles.css', () => {
  it('say the same thing in `@theme` and in `.theme-dark`', () => {
    // `@theme` exists because Tailwind emits no `bg-ink-850` for a token it has
    // never seen, and `.theme-dark` because a light page still contains one dark
    // island — the viewer's photo stage. Two copies of one ramp, and this is what
    // stops the second from drifting.
    assert.deepEqual([...tokens(css, '@theme {')], [...tokens(css, '.theme-dark {')]);
  });

  it('define the same tokens in both directions', () => {
    // A rung declared for one theme only is a surface that keeps the other
    // theme's colour — invisible until somebody switches.
    assert.deepEqual(
      [...tokens(css, '.theme-dark {').keys()],
      [...tokens(css, '.theme-light {').keys()],
    );
  });

  it('put the panel above the page in both, which is what the rungs mean', () => {
    // `ink-850` is the panel and `ink-900` the page it is raised above. Dark
    // stacks downwards and light upwards, so the literal comparison inverts while
    // the relationship does not — and every `bg-ink-850` in the application is
    // written on the strength of that relationship holding.
    const dark = tokens(css, '.theme-dark {');
    const light = tokens(css, '.theme-light {');
    assert.ok(dark.get('--color-ink-850')! > dark.get('--color-ink-900')!);
    assert.ok(light.get('--color-ink-850')! > light.get('--color-ink-900')!);
  });
});

describe('the pre-paint bootstrap', () => {
  it('is loaded blocking, from the head, after the meta it rewrites', () => {
    // `defer` or `type="module"` would let the stylesheet paint the dark page
    // first: anyone reading in light would watch it flash black on every load.
    const tag = /<script([^>]*)src="\/theme\.js"([^>]*)>/.exec(html);
    assert.ok(tag, 'index.html does not load /theme.js');
    assert.doesNotMatch(tag[1]! + tag[2]!, /defer|async|type=/);
    assert.ok(
      html.indexOf('name="theme-color"') < html.indexOf('src="/theme.js"'),
      'the script runs before the meta it edits has been parsed',
    );
  });

  it('starts the document on the ramp it can leave alone', () => {
    // The dark class ships in the file so the ramp is bound from the first byte;
    // the bootstrap then has nothing to do in the common case.
    assert.match(html, /<html\b[^>]*\sclass="theme-dark"/);
  });

  it('reads the key `lib/theme.ts` writes', () => {
    // Two spellings of the storage key is a choice that is saved and never read
    // back: the setting works, and the next visit forgets it.
    const key = /const STORAGE_KEY = '([^']+)'/.exec(module)?.[1];
    assert.ok(key);
    assert.ok(bootstrap.includes(`'${key}'`), `public/theme.js does not read ${key}`);
  });

  it('names the same classes the stylesheet binds', () => {
    for (const name of ['theme-dark', 'theme-light']) {
      assert.ok(css.includes(`.${name} {`), `styles.css binds no .${name}`);
      assert.ok(bootstrap.includes(`'${name}'`), `public/theme.js does not know ${name}`);
      assert.ok(module.includes(`'${name}'`), `lib/theme.ts does not know ${name}`);
    }
  });

  it('paints the browser chrome the colour of the page under it', () => {
    // `theme-color` frames the page on a phone. A light page under a black
    // address bar is the one part of the theme the application cannot repaint
    // itself, so both files that write it must name `--color-ink-900`.
    const light = tokens(css, '.theme-light {').get('--color-ink-900');
    const dark = tokens(css, '.theme-dark {').get('--color-ink-900');

    assert.ok(bootstrap.includes(`'${light}'`), `public/theme.js does not set ${light}`);
    assert.match(module, new RegExp(`dark: '${dark}', light: '${light}'`));
    assert.match(html, new RegExp(`<meta name="theme-color" content="${dark}"`));
  });
});
