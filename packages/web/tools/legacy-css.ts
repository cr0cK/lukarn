import { createHash } from 'node:crypto';
import { Features, transform } from 'lightningcss';
import type { Plugin } from 'vite';

/**
 * Oldest engine the stylesheet must support, in Lightning CSS format
 * (`major << 16 | minor << 8 | patch`).
 *
 * Chromium 79 because `/diagnostic` reports it on a 2021 LG television browser
 * — a measurement, not an estimate. Tailwind v4 supports only Chromium 111 and
 * above: everything below bridges that thirty-two-version gap (D260809f).
 */
const OLDEST_ENGINE = { chrome: 79 << 16 };

/**
 * Symmetrical logical shorthands and the pair of physical properties saying the
 * same thing while writing direction is left-to-right.
 *
 * Only **shorthands** belong here. The `-start` / `-end` forms genuinely depend
 * on direction and have no unconditional physical equivalent; Tailwind emits
 * them only for `ps-*` / `pe-*`, which this repository does not use.
 */
const PHYSICAL_EQUIVALENTS: Record<string, readonly [string, string]> = {
  'padding-inline': ['padding-left', 'padding-right'],
  'padding-block': ['padding-top', 'padding-bottom'],
  'margin-inline': ['margin-left', 'margin-right'],
  'margin-block': ['margin-top', 'margin-bottom'],
  'inset-inline': ['left', 'right'],
  'inset-block': ['top', 'bottom'],
  'scroll-padding-inline': ['scroll-padding-left', 'scroll-padding-right'],
  'scroll-padding-block': ['scroll-padding-top', 'scroll-padding-bottom'],
  'scroll-margin-inline': ['scroll-margin-left', 'scroll-margin-right'],
  'scroll-margin-block': ['scroll-margin-top', 'scroll-margin-bottom'],
};

const SHORTHAND_NAMES = Object.keys(PHYSICAL_EQUIVALENTS).join('|');
const DECLARATION = new RegExp(`(^|[{;])\\s*(${SHORTHAND_NAMES})\\s*:\\s*([^;}]+)`, 'g');

/** A two-component value — `5px 9px` — depends on writing direction. */
function hasTwoComponents(value: string): boolean {
  // Whitespace outside parentheses separates two components; whitespace in
  // `calc(var(--spacing) * 5)` separates none.
  return /\s(?![^(]*\))/.test(value.trim());
}

/**
 * Precedes every symmetrical logical shorthand with its physical equivalent.
 *
 * **Order is the whole mechanism**: the logical shorthand remains last, so an
 * engine that knows it applies it and still respects writing direction. An
 * engine that ignores it drops that declaration and keeps both physical ones.
 *
 * Lightning CSS can lower this itself but **refuses when the value contains
 * `var()`**: it cannot know how many components it will expand into. That is
 * exactly the form Tailwind v4 emits for its spacing scale,
 * `calc(var(--spacing) * 5)` — every application `px-*` and `py-*`. Hence this
 * supplement.
 */
export function addPhysicalFallbacks(css: string): string {
  return css.replace(DECLARATION, (whole, before: string, property: string, value: string) => {
    if (hasTwoComponents(value)) return whole;
    const [first, second] = PHYSICAL_EQUIVALENTS[property]!;
    return `${before}${first}:${value};${second}:${value};${property}:${value}`;
  });
}

/**
 * The three independent transform properties in composition order, and the
 * `transform` fragment replacing them.
 */
const TRANSFORM_SLOTS = ['translate', 'rotate', 'scale'] as const;
const TRANSFORM_DECLARATION = new RegExp(
  `(^|[{;])\\s*(${TRANSFORM_SLOTS.join('|')})\\s*:\\s*([^;}]+)`,
  'g',
);

/**
 * Rule resetting all three slots to empty on every element.
 *
 * Without it, a transformed parent would pass rotation to its children: custom
 * properties inherit, while `transform` does not. Tailwind takes the same
 * precaution for its own variables.
 *
 * **It remains in a layer while any layer exists**: an unlayered rule outranks
 * every layered one, so the reset overrode the utility it should only precede
 * and no transform worked. `properties` is Tailwind's first declared and least
 * important layer. `flattenLayers` later removes layers from all rules together,
 * after which specificity gives the same result: `*` does not beat `.rotate-90`.
 */
const TRANSFORM_RESET =
  '@layer properties{*,::before,::after,::backdrop{--nonni-translate: ;--nonni-rotate: ;--nonni-scale: }}';

const COMPOSED_TRANSFORM =
  'transform:var(--nonni-translate) var(--nonni-rotate) var(--nonni-scale)';

/** Splits a value on top-level whitespace — `var(--a) var(--b)`. */
function topLevelParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const c of value.trim()) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (depth === 0 && /\s/.test(c)) {
      if (current) parts.push(current);
      current = '';
    } else current += c;
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Gives a bare `var()` the neutral fallback for its position.
 *
 * Tailwind initialises `--tw-translate-*` through `@property` and supplies a
 * fallback only under an `@supports` targeting Safari and Firefox. Relying on it
 * would make centring depend on detection written for other engines: an
 * uninitialised variable would invalidate the whole `transform`, leaving the
 * element completely still.
 */
function withNeutralFallback(part: string, neutral: string): string {
  return /^var\(\s*--[\w-]+\s*\)$/.test(part) ? `${part.slice(0, -1)},${neutral})` : part;
}

/** `transform` function equivalent to an independent property. */
function transformFunction(property: string, value: string): string {
  const parts = topLevelParts(value);
  if (property === 'translate') {
    const [x, y, z] = parts.map((p) => withNeutralFallback(p, '0'));
    if (z) return `translate3d(${x},${y},${z})`;
    return `translate(${x!},${y ?? '0'})`;
  }
  if (property === 'scale') {
    const [x, y] = parts.map((p) => withNeutralFallback(p, '1'));
    return `scale(${x!},${y ?? x!})`;
  }
  return `rotate(${parts.map((p) => withNeutralFallback(p, '0deg')).join(' ')})`;
}

/**
 * Replaces `translate`, `rotate` and `scale` with a composed `transform`.
 *
 * These independent properties exist only from Chromium 104, while Tailwind v4
 * emits them for all transform utilities. On an older engine,
 * `-translate-y-1/2` centres nothing — this shifted the search-field magnifier
 * beneath its text.
 *
 * **Replace in place, not as an `@supports` fallback.** A recent engine would
 * otherwise apply both `translate` and `transform`, moving twice. Using
 * `transform` everywhere yields the same result at the cost of an older property.
 *
 * **All three slots use variables** instead of writing the function directly, or
 * two utilities on one element — `rotate-90 -translate-y-1/2` — would compete
 * for `transform` and the last would erase the first. Slots compose in the right
 * order, while an empty slot produces nothing during substitution.
 */
export function replaceIndependentTransforms(css: string): string {
  let touched = false;
  const out = css.replace(
    TRANSFORM_DECLARATION,
    (_whole, before: string, property: string, value: string) => {
      touched = true;
      const slot = `--nonni-${property}`;
      return `${before}${slot}:${transformFunction(property, value)};${COMPOSED_TRANSFORM}`;
    },
  );
  return touched ? `${TRANSFORM_RESET}${out}` : out;
}

/** Index of the closing quote for a CSS string opened at `debut`. */
function finDeChaine(css: string, debut: number): number {
  const quote = css[debut];
  for (let i = debut + 1; i < css.length; i++) {
    if (css[i] === '\\') i++;
    else if (css[i] === quote) return i;
  }
  return css.length;
}

/**
 * Index of the closing brace matching the one opened at `ouverture`.
 *
 * Skip strings: `content: "}"` exists in Tailwind output, and counting that brace
 * would close the block too early — cutting the stylesheet in half without a signal.
 */
function accoladeFermante(css: string, ouverture: number): number {
  let profondeur = 0;
  for (let i = ouverture; i < css.length; i++) {
    const c = css[i];
    if (c === '"' || c === "'") i = finDeChaine(css, i);
    else if (c === '{') profondeur++;
    else if (c === '}' && --profondeur === 0) return i;
  }
  return css.length;
}

/**
 * Removes cascade layers while leaving their contents in place.
 *
 * `@layer` does not exist before Chromium 99, and an unknown at-rule is discarded
 * **with its block**: on a conforming engine, the 91% of the stylesheet Tailwind
 * v4 encloses in layers disappears and the application renders entirely unstyled.
 * The television behind D260809f escaped through a lenient parser retaining the
 * content; a nearby but newer one follows the rule and displayed nothing (D260809i).
 *
 * **Flattening does not change the cascade** because Tailwind declares layers in
 * emission order — `properties`, `theme`, `base`, `components`, `utilities` —
 * and nothing outside a layer is a style rule: only `@property` and `@keyframes`,
 * which the cascade does not arbitrate. Text order and specificity therefore
 * produce the same result as layers on every engine.
 */
export function flattenLayers(css: string): string {
  if (!css.includes('@layer')) return css;

  let sortie = '';
  let i = 0;
  while (i < css.length) {
    const debut = css.indexOf('@layer', i);
    if (debut < 0) {
      sortie += css.slice(i);
      break;
    }
    sortie += css.slice(i, debut);

    const accolade = css.indexOf('{', debut);
    const pointVirgule = css.indexOf(';', debut);
    // `@layer a, b;` only orders layers: without them, nothing remains to say.
    if (pointVirgule >= 0 && (accolade < 0 || pointVirgule < accolade)) {
      i = pointVirgule + 1;
      continue;
    }
    if (accolade < 0) {
      sortie += css.slice(debut);
      break;
    }

    const fin = accoladeFermante(css, accolade);
    // Recurse because a layer may contain another, as Tailwind does.
    sortie += flattenLayers(css.slice(accolade + 1, fin));
    i = fin + 1;
  }
  return sortie;
}

/**
 * Checks that lowering missed nothing and reports what it finds.
 *
 * Without this check, a Tailwind change altering its output shape would be
 * invisible: the build and tests would pass, while the defect appeared only on
 * somebody else's television with no link to the version upgrade.
 */
export function findUnloweredDeclarations(css: string): string[] {
  const problems: string[] = [];

  const oklch = css.match(/oklch\([^)]*\)/g);
  if (oklch) problems.push(`${oklch.length} oklch() call(s): ${oklch[0]}`);

  const couches = css.match(/@layer[^{;]*[{;]/g);
  if (couches) problems.push(`${couches.length} unflattened @layer block(s): ${couches[0]}`);

  const independent = css.match(TRANSFORM_DECLARATION);
  if (independent) {
    problems.push(
      `${independent.length} independent transform propert(y/ies): ${independent[0]!.trim()}`,
    );
  }

  // Allow a logical shorthand when a physical equivalent precedes it in the same
  // declaration group — exactly what `addPhysicalFallbacks` adds.
  for (const found of css.matchAll(new RegExp(`(^|[{;])\\s*(${SHORTHAND_NAMES})\\s*:`, 'g'))) {
    const property = found[2]!;
    const [first] = PHYSICAL_EQUIVALENTS[property]!;
    const before = css.slice(Math.max(0, found.index - 200), found.index);
    if (!before.includes(`${first}:`)) {
      problems.push(
        `${property} without a physical fallback: …${css.slice(found.index, found.index + 60)}`,
      );
    }
  }

  return problems;
}

/**
 * Lowers a stylesheet to the oldest supported engine: `oklch()` to `rgb()`,
 * logical properties to physical, missing prefixes and flattened cascade layers.
 *
 * **Flattening comes last** because `replaceIndependentTransforms` adds a layer
 * itself: reversing them would leave the one at-rule these engines discard with
 * its contents.
 */
export function lowerForLegacyEngines(css: string, filename = 'style.css'): string {
  const lowered = transform({
    filename,
    code: Buffer.from(css),
    minify: true,
    targets: OLDEST_ENGINE,
    // Without this flag, Lightning CSS converts logical properties only when it
    // considers it essential and lets `margin-inline: auto` through.
    include: Features.LogicalProperties,
  }).code.toString();

  return flattenLayers(replaceIndependentTransforms(addPhysicalFallbacks(lowered)));
}

/** Short content fingerprint in the same form as Vite's. */
function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('base64url').slice(0, 8);
}

/**
 * Vite plugin applying `lowerForLegacyEngines` to generated CSS.
 *
 * It acts on **output**, never sources: component authors need remember nothing
 * and no Tailwind class is forbidden. In return it runs only during builds —
 * under `pnpm dev`, an old browser still sees the unlowered stylesheet. This has
 * no production impact where the server serves only `dist`, but matters before
 * concluding that a fix did not work.
 *
 * `generateBundle` is the only hook seeing the Tailwind stylesheet: the one from
 * `@tailwindcss/vite` does not yet exist during `transform`, which would catch
 * only the three-line source.
 *
 * **Hence renaming.** Rollup has already hashed the asset name when this hook
 * runs, so two different contents would share one name. Assets are served as
 * `immutable, max-age=31536000`, so a returning visitor would keep the unlowered
 * stylesheet for a year — the fix would never reach its target device. Rehash
 * from final content and rewrite references. The service worker adapts by reading
 * live names from the served shell.
 */
export function legacyCss(): Plugin {
  return {
    name: 'nonni-legacy-css',
    apply: 'build',
    // Run last: `index.html` must already be in the bundle so its stylesheet
    // reference can be rewritten with the new name.
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const [name, asset] of Object.entries(bundle)) {
        if (asset.type !== 'asset' || !name.endsWith('.css')) continue;

        const css = typeof asset.source === 'string' ? asset.source : asset.source.toString();
        const lowered = lowerForLegacyEngines(css, name);

        const problems = findUnloweredDeclarations(lowered);
        if (problems.length > 0) {
          this.error(
            `${name}: ${problems.length} declaration(s) outside the targeted engine's reach.\n` +
              problems.map((p) => `  - ${p}`).join('\n'),
          );
        }

        asset.source = lowered;

        const renamed = name.replace(/-[\w-]{8}\.css$/, `-${contentHash(lowered)}.css`);
        if (renamed === name) continue;

        delete bundle[name];
        asset.fileName = renamed;
        bundle[renamed] = asset;

        for (const other of Object.values(bundle)) {
          if (other === asset) continue;
          if (other.type === 'chunk') other.code = other.code.split(name).join(renamed);
          else if (typeof other.source === 'string')
            other.source = other.source.split(name).join(renamed);
        }
      }
    },
  };
}
