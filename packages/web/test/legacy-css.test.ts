import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addPhysicalFallbacks,
  findUnloweredDeclarations,
  flattenLayers,
  legacyCss,
  lowerForLegacyEngines,
  replaceIndependentTransforms,
  unguardVariableInitialisation,
} from '../tools/legacy-css';

/** The minimum Rollup bundle needed to exercise the plugin. */
type Entree =
  | { type: 'asset'; fileName: string; source: string }
  | { type: 'chunk'; fileName: string; code: string };

function passerLeGreffon(bundle: Record<string, Entree>): void {
  const hook = legacyCss().generateBundle;
  assert.equal(typeof hook, 'function', 'the plugin must expose generateBundle');
  const appeler = hook as unknown as (
    this: { error(message: string): never },
    options: unknown,
    bundle: Record<string, Entree>,
  ) => void;
  appeler.call(
    {
      error(message: string): never {
        throw new Error(message);
      },
    },
    {},
    bundle,
  );
}

describe('stylesheet lowering', () => {
  it('duplicates a logical shorthand with its two physical properties', () => {
    const out = addPhysicalFallbacks('.a{padding-inline:20px}');
    assert.equal(out, '.a{padding-left:20px;padding-right:20px;padding-inline:20px}');
  });

  it('leaves the logical shorthand last so writing direction takes precedence', () => {
    // This is the whole mechanism: an engine that knows `padding-inline`
    // applies the last declaration, so RTL continues to work. Reversing the
    // order would make the physical version win everywhere.
    const out = addPhysicalFallbacks('.a{padding-inline:20px}');
    assert.ok(out.indexOf('padding-left') < out.indexOf('padding-inline'));
  });

  it('also duplicates a value provided through a variable', () => {
    // This is the form Tailwind v4 emits for its entire spacing scale, and the
    // only one Lightning CSS refuses to lower itself.
    const out = addPhysicalFallbacks('.px-5{padding-inline:calc(var(--spacing) * 5)}');
    assert.ok(out.includes('padding-left:calc(var(--spacing) * 5)'));
    assert.ok(out.includes('padding-right:calc(var(--spacing) * 5)'));
  });

  it('leaves a direction-dependent two-value declaration intact', () => {
    // `padding-inline: 5px 9px` cannot become physical without knowing the
    // writing direction. Duplicating it would reverse padding in Arabic or Hebrew.
    const source = '.a{padding-inline:5px 9px}';
    assert.equal(addPhysicalFallbacks(source), source);
  });

  it('handles the other shorthands in the same family', () => {
    assert.ok(addPhysicalFallbacks('.a{inset-inline:0}').includes('left:0;right:0'));
    assert.ok(addPhysicalFallbacks('.a{margin-block:4px}').includes('margin-top:4px'));
  });

  it('converts oklch() and logical properties from a real stylesheet', () => {
    const out = lowerForLegacyEngines(
      ':root{--c:oklch(63.7% .237 25.331)}.a{color:oklch(63.7% .237 25.331)}.b{inset-inline:0}',
    );
    assert.ok(!out.includes('oklch('));
    assert.ok(out.includes('left:0'));
  });

  it('reports a logical shorthand left without a fallback', () => {
    const problems = findUnloweredDeclarations('.a{padding-inline:20px}');
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /padding-inline without a physical fallback/);
  });

  it('reports nothing for a correctly lowered stylesheet', () => {
    const abaissee = addPhysicalFallbacks('.a{padding-inline:20px}.b{margin-inline:auto}');
    assert.deepEqual(findUnloweredDeclarations(abaissee), []);
  });

  it('reports a remaining oklch()', () => {
    const problems = findUnloweredDeclarations('.a{color:oklch(63.7% .237 25.331)}');
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /oklch/);
  });
});

describe('independent transform properties', () => {
  it('replaces translate with a composed transform', () => {
    const out = replaceIndependentTransforms('.a{translate:0 -50%}');
    assert.ok(out.includes('--lukarn-translate:translate(0,-50%)'));
    assert.ok(
      out.includes('transform:var(--lukarn-translate) var(--lukarn-rotate) var(--lukarn-scale)'),
    );
    assert.ok(!/[{;]\s*translate\s*:/.test(out), 'the independent property must no longer remain');
  });

  it('uses slots so two utilities can compose', () => {
    // With `rotate-90 -translate-y-1/2` on the same element, writing `transform`
    // directly would make the second class erase the first.
    const out = replaceIndependentTransforms('.a{translate:0 -50%}.b{rotate:90deg}');
    assert.ok(out.includes('--lukarn-rotate:rotate(90deg)'));
    assert.equal(out.match(/transform:var\(--lukarn-translate\)/g)?.length, 2);
  });

  it('resets slots inside a layer and never outside one', () => {
    // Outside a layer, the reset would override the utility it should only
    // precede, and no transform would work.
    const out = replaceIndependentTransforms('.a{translate:0 -50%}');
    assert.ok(out.startsWith('@layer properties{*,::before,::after,::backdrop{'));
  });

  it('gives every variable a neutral fallback', () => {
    // Without a fallback, one uninitialised variable invalidates the entire
    // `transform`, and the element no longer moves at all.
    const out = replaceIndependentTransforms('.a{translate:var(--tw-x) var(--tw-y)}');
    assert.ok(out.includes('translate(var(--tw-x,0),var(--tw-y,0))'));
  });

  it('does not alter a stylesheet without transforms', () => {
    const source = '.a{color:red}';
    assert.equal(replaceIndependentTransforms(source), source);
  });

  it('reports an independent property left in place', () => {
    const problems = findUnloweredDeclarations('.a{scale:1.1}');
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /transform/);
  });
});

/**
 * Tailwind's `--tw-*` variables, and the browser sniff that used to hide them.
 *
 * The defect this guards against is the worst kind: the build passes, every test
 * passes, the application is perfect on the machine that built it, and on the
 * television every border, divider and outline is simply absent — because
 * `border-style: var(--tw-border-style)` with the variable unset is invalid, and
 * `border-style` reverts to `none`.
 */
describe('Tailwind variable initialisation', () => {
  /** The shape Tailwind emits: its own values behind a Safari/Firefox sniff. */
  const GUARDED =
    '@supports (((-webkit-hyphens:none)) and (not (margin-trim:inline))) or ' +
    '((-moz-orient:inline) and (not (color:rgb(from red r g b))))' +
    '{*,:before,:after,::backdrop{--tw-border-style:solid;--tw-outline-style:solid}}';

  it('applies the values to every engine instead of two', () => {
    const out = unguardVariableInitialisation(GUARDED);
    assert.equal(
      out,
      '*,:before,:after,::backdrop{--tw-border-style:solid;--tw-outline-style:solid}',
    );
    assert.ok(!out.includes('@supports'), 'the sniff must be gone, not merely satisfied');
  });

  it('leaves a conditional block that carries real declarations alone', () => {
    // Only a group of custom properties is Tailwind's initialisation. An
    // `@supports` guarding an actual style rule is a deliberate fallback — the
    // `color-mix()` blocks, whose plain-hex version sits just before them — and
    // hoisting it would apply a value the engine was meant not to take.
    const real =
      '@supports (color:color-mix(in lab,red,red)){.a{color:color-mix(in oklab,red 5%,#0000)}}';
    assert.equal(unguardVariableInitialisation(real), real);
  });

  it('reports an initialisation still trapped behind a sniff', () => {
    const problems = findUnloweredDeclarations(GUARDED);
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /still inside @supports/);
  });

  it('reports a variable read by a utility and set by nothing', () => {
    // What remains if Tailwind ever stops emitting the block at all: nothing to
    // hoist, and nothing to notice, until somebody looks at an old screen.
    const problems = findUnloweredDeclarations('.border{border-style:var(--tw-border-style)}');
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /every border would vanish/);
  });

  it('accepts the variable once something sets it unconditionally', () => {
    const ok = '*{--tw-border-style:solid}.border{border-style:var(--tw-border-style)}';
    assert.deepEqual(findUnloweredDeclarations(ok), []);
  });
});

describe('cascade layer flattening', () => {
  it('removes the layer and keeps its contents', () => {
    assert.equal(flattenLayers('@layer utilities{.a{color:red}}'), '.a{color:red}');
  });

  it('removes an order declaration that no longer has anything to order', () => {
    assert.equal(flattenLayers('@layer theme,base,utilities;.a{color:red}'), '.a{color:red}');
  });

  it('preserves source order, which becomes the sole judge of the cascade', () => {
    // This makes flattening harmless in a modern engine: Tailwind declares its
    // layers in the order in which it emits them.
    const out = flattenLayers('@layer base{.a{color:red}}@layer utilities{.a{color:blue}}');
    assert.equal(out, '.a{color:red}.a{color:blue}');
  });

  it('flattens a layer nested inside another', () => {
    assert.equal(flattenLayers('@layer a{@layer b{.x{color:red}}}'), '.x{color:red}');
  });

  it('leaves an at-rule known to the engine intact', () => {
    const out = flattenLayers('@media (min-width:40px){@layer utilities{.a{color:red}}}');
    assert.equal(out, '@media (min-width:40px){.a{color:red}}');
  });

  it('does not close a block on a brace held inside a string', () => {
    // `content: "}"` occurs in Tailwind output; counting that brace would split
    // the stylesheet in the middle without reporting anything.
    const out = flattenLayers('@layer utilities{.a:before{content:"}"}}.b{color:red}');
    assert.equal(out, '.a:before{content:"}"}.b{color:red}');
  });

  it('leaves no layers in a lowered stylesheet', () => {
    // Tailwind v4 output is 91% inside layers, and an unknown at-rule is dropped
    // with its block: without flattening, a specification-compliant engine from
    // before Chromium 99 displays nothing at all.
    const out = lowerForLegacyEngines('@layer utilities{.a{translate:0 -50%;padding-inline:4px}}');
    assert.ok(!out.includes('@layer'));
    assert.ok(out.includes('padding-left:4px'));
    assert.ok(out.includes('--lukarn-translate:translate(0,-50%)'));
  });

  it('reports a layer left in place', () => {
    const problems = findUnloweredDeclarations('@layer utilities{.a{color:red}}');
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /@layer/);
  });
});

describe('lowered stylesheet renaming', () => {
  const lot = (): Record<string, Entree> => ({
    'assets/index-AAAAAAAA.css': {
      type: 'asset',
      fileName: 'assets/index-AAAAAAAA.css',
      source: '.a{padding-inline:20px}',
    },
    'index.html': {
      type: 'asset',
      fileName: 'index.html',
      source: '<link rel="stylesheet" href="/assets/index-AAAAAAAA.css">',
    },
  });

  it('rehashes the name from the lowered contents', () => {
    // Rollup hashed the name before the plugin rewrote the stylesheet. Without
    // rehashing, two contents live under the same name — and because assets are
    // served as `immutable` for a year, lowering never reaches a returning
    // browser, precisely the browser it targets.
    const bundle = lot();
    passerLeGreffon(bundle);

    assert.equal(bundle['assets/index-AAAAAAAA.css'], undefined);
    const nouveau = Object.keys(bundle).find((n) => n.endsWith('.css'))!;
    assert.notEqual(nouveau, 'assets/index-AAAAAAAA.css');
  });

  it('rewrites the shell reference to the new name', () => {
    const bundle = lot();
    passerLeGreffon(bundle);

    const nouveau = Object.keys(bundle).find((n) => n.endsWith('.css'))!;
    const html = bundle['index.html']!;
    assert.equal(html.type, 'asset');
    assert.ok(
      html.type === 'asset' && html.source.includes(nouveau),
      'the shell must point to the file actually written',
    );
  });

  it('also lowers the contents in the process', () => {
    const bundle = lot();
    passerLeGreffon(bundle);

    const nouveau = Object.keys(bundle).find((n) => n.endsWith('.css'))!;
    const css = bundle[nouveau]!;
    assert.ok(css.type === 'asset' && css.source.includes('padding-left:20px'));
  });
});
