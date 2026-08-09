import { createHash } from 'node:crypto';
import { Features, transform } from 'lightningcss';
import type { Plugin } from 'vite';

/**
 * Moteur le plus ancien que la feuille de styles doit servir, au format de
 * Lightning CSS (`majeur << 16 | mineur << 8 | correctif`).
 *
 * Chromium 79, parce que c'est ce que relève `/diagnostic` sur le navigateur
 * d'un téléviseur LG de 2021 — pas une estimation, une mesure. Tailwind v4
 * n'annonce lui-même que Chromium 111 et au-delà : tout ce qui suit sert à
 * combler ces trente-deux versions d'écart (D260809f).
 */
const OLDEST_ENGINE = { chrome: 79 << 16 };

/**
 * Raccourcis logiques symétriques, et le couple de propriétés physiques qui
 * dit exactement la même chose tant que le sens d'écriture est gauche-droite.
 *
 * Seuls les **raccourcis** sont ici. Les formes `-start` / `-end` dépendent
 * réellement du sens et n'ont pas d'équivalent physique inconditionnel ;
 * Tailwind ne les émet que pour `ps-*` / `pe-*`, que ce dépôt n'utilise pas.
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

/** Une valeur à deux composantes — `5px 9px` — dépend du sens d'écriture. */
function hasTwoComponents(value: string): boolean {
  // Un espace qui n'est pas à l'intérieur de parenthèses sépare deux
  // composantes ; ceux de `calc(var(--spacing) * 5)` n'en séparent aucune.
  return /\s(?![^(]*\))/.test(value.trim());
}

/**
 * Fait précéder chaque raccourci logique symétrique de son équivalent physique.
 *
 * **L'ordre est tout le mécanisme** : le raccourci logique reste en place et
 * vient en dernier, donc un moteur qui le connaît l'applique et le sens
 * d'écriture continue d'être respecté. Un moteur qui l'ignore laisse tomber
 * cette déclaration-là et garde les deux physiques.
 *
 * Lightning CSS sait faire cet abaissement lui-même, mais **refuse dès que la
 * valeur contient `var()`** : il ne peut pas savoir en combien de composantes
 * elle se développera. Or c'est exactement la forme que Tailwind v4 émet pour
 * tout son barème d'espacement, `calc(var(--spacing) * 5)` — c'est-à-dire tous
 * les `px-*` et `py-*` de l'application. D'où ce complément.
 */
export function addPhysicalFallbacks(css: string): string {
  return css.replace(DECLARATION, (whole, before: string, property: string, value: string) => {
    if (hasTwoComponents(value)) return whole;
    const [first, second] = PHYSICAL_EQUIVALENTS[property]!;
    return `${before}${first}:${value};${second}:${value};${property}:${value}`;
  });
}

/**
 * Les trois propriétés de transformation indépendantes, dans l'ordre où elles
 * se composent, et le morceau de `transform` qui les remplace.
 */
const TRANSFORM_SLOTS = ['translate', 'rotate', 'scale'] as const;
const TRANSFORM_DECLARATION = new RegExp(
  `(^|[{;])\\s*(${TRANSFORM_SLOTS.join('|')})\\s*:\\s*([^;}]+)`,
  'g',
);

/**
 * Règle qui remet les trois emplacements à vide sur chaque élément.
 *
 * Sans elle, un parent transformé léguerait sa rotation à ses enfants : les
 * propriétés personnalisées héritent, `transform` non. C'est la même précaution
 * que prend Tailwind pour ses propres variables.
 *
 * **Elle vit dans une couche, et c'est indispensable** : une règle hors couche
 * l'emporte sur tout ce qui est en couche, donc le reset écrasait l'utilitaire
 * qu'il devait seulement précéder, et plus rien ne se transformait. `properties`
 * est la première couche déclarée par Tailwind, donc la moins prioritaire ; là
 * où les couches sont ignorées, la spécificité de la classe tranche pareil.
 */
const TRANSFORM_RESET =
  '@layer properties{*,::before,::after,::backdrop{--gdv-translate: ;--gdv-rotate: ;--gdv-scale: }}';

const COMPOSED_TRANSFORM = 'transform:var(--gdv-translate) var(--gdv-rotate) var(--gdv-scale)';

/** Découpe une valeur sur ses espaces de premier niveau — `var(--a) var(--b)`. */
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
 * Donne à un `var()` nu la valeur neutre de sa position en repli.
 *
 * Tailwind initialise ses `--tw-translate-*` par `@property`, et n'en assure le
 * repli que sous un `@supports` qui vise Safari et Firefox. Compter dessus, ce
 * serait faire dépendre le recentrage d'une détection écrite pour d'autres
 * moteurs : une variable non initialisée rendrait tout le `transform` invalide,
 * et l'élément ne bougerait plus du tout.
 */
function withNeutralFallback(part: string, neutral: string): string {
  return /^var\(\s*--[\w-]+\s*\)$/.test(part) ? `${part.slice(0, -1)},${neutral})` : part;
}

/** La fonction `transform` équivalente à une propriété indépendante. */
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
 * Remplace `translate`, `rotate` et `scale` par un `transform` composé.
 *
 * Ces trois propriétés indépendantes n'existent qu'à partir de Chromium 104, et
 * Tailwind v4 les émet pour tous ses utilitaires de transformation. Sur un
 * moteur plus ancien, `-translate-y-1/2` ne recentre plus rien — c'est ce qui
 * décalait la loupe du champ de recherche sous son texte.
 *
 * **Le remplacement est en place, et pas un repli sous `@supports`.** Un moteur
 * récent appliquerait sinon les deux, `translate` puis `transform`, et
 * déplacerait deux fois. Passer par `transform` partout donne le même rendu
 * partout, au prix d'une propriété moins moderne.
 *
 * **Les trois emplacements passent par des variables** plutôt que d'écrire
 * directement la fonction, sans quoi deux utilitaires posés sur le même élément
 * — `rotate-90 -translate-y-1/2` — se disputeraient `transform`, et le dernier
 * effacerait le premier. Avec les emplacements, ils se composent, et dans le
 * bon ordre. Un emplacement vide ne produit rien à la substitution.
 */
export function replaceIndependentTransforms(css: string): string {
  let touched = false;
  const out = css.replace(
    TRANSFORM_DECLARATION,
    (_whole, before: string, property: string, value: string) => {
      touched = true;
      const slot = `--gdv-${property}`;
      return `${before}${slot}:${transformFunction(property, value)};${COMPOSED_TRANSFORM}`;
    },
  );
  return touched ? `${TRANSFORM_RESET}${out}` : out;
}

/**
 * Vérifie que l'abaissement n'a rien laissé passer, et dit quoi le cas échéant.
 *
 * Sans ce contrôle, une évolution de Tailwind qui changerait la forme de sa
 * sortie ne se verrait nulle part : la construction réussirait, les tests
 * passeraient, et le défaut n'apparaîtrait que sur un téléviseur, chez
 * quelqu'un d'autre, sans que personne fasse le lien avec la montée de version.
 */
export function findUnloweredDeclarations(css: string): string[] {
  const problems: string[] = [];

  const oklch = css.match(/oklch\([^)]*\)/g);
  if (oklch) problems.push(`${oklch.length} appel(s) à oklch() : ${oklch[0]}`);

  const independent = css.match(TRANSFORM_DECLARATION);
  if (independent) {
    problems.push(
      `${independent.length} propriété(s) de transformation indépendante(s) : ${independent[0]!.trim()}`,
    );
  }

  // Un raccourci logique est admis tant qu'un équivalent physique le précède
  // dans la même déclaration groupée — c'est ce que pose `addPhysicalFallbacks`.
  for (const found of css.matchAll(new RegExp(`(^|[{;])\\s*(${SHORTHAND_NAMES})\\s*:`, 'g'))) {
    const property = found[2]!;
    const [first] = PHYSICAL_EQUIVALENTS[property]!;
    const before = css.slice(Math.max(0, found.index - 200), found.index);
    if (!before.includes(`${first}:`)) {
      problems.push(
        `${property} sans repli physique : …${css.slice(found.index, found.index + 60)}`,
      );
    }
  }

  return problems;
}

/**
 * Abaisse une feuille de styles au niveau du moteur le plus ancien à servir :
 * `oklch()` en `rgb()`, propriétés logiques en physiques, préfixes manquants.
 */
export function lowerForLegacyEngines(css: string, filename = 'style.css'): string {
  const lowered = transform({
    filename,
    code: Buffer.from(css),
    minify: true,
    targets: OLDEST_ENGINE,
    // Sans ce drapeau, Lightning CSS ne convertit les propriétés logiques que
    // lorsqu'il l'estime indispensable, et laisse passer `margin-inline: auto`.
    include: Features.LogicalProperties,
  }).code.toString();

  return replaceIndependentTransforms(addPhysicalFallbacks(lowered));
}

/** Empreinte courte du contenu, dans la même forme que celle de Vite. */
function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('base64url').slice(0, 8);
}

/**
 * Greffon Vite qui applique `lowerForLegacyEngines` à la CSS produite.
 *
 * Il agit sur la **sortie**, jamais sur les sources : rien à retenir pour qui
 * écrit un composant, et aucune classe Tailwind interdite. En contrepartie il
 * ne tourne qu'à la construction — sous `pnpm dev`, un vieux navigateur voit
 * encore la feuille non abaissée. C'est sans conséquence en production, où le
 * serveur ne sert que `dist`, mais c'est à savoir avant de conclure qu'un
 * correctif n'a pas pris.
 *
 * `generateBundle` est le seul crochet qui voie la feuille de Tailwind : celle
 * de `@tailwindcss/vite` n'existe pas encore au moment du `transform`, où l'on
 * n'attraperait que la source à trois lignes.
 *
 * **D'où le renommage.** Rollup a déjà haché le nom de l'asset quand ce crochet
 * s'exécute, si bien que deux contenus différents se retrouveraient sous le même
 * nom. Les assets étant servis en `immutable, max-age=31536000`, un visiteur
 * déjà venu garderait un an la feuille non abaissée — c'est-à-dire que le
 * correctif n'atteindrait jamais l'appareil qu'il vise. On rehache donc d'après
 * le contenu final et on réécrit les renvois. Le service worker s'y retrouve
 * seul : il relit les noms vivants dans la coquille servie.
 */
export function legacyCss(): Plugin {
  return {
    name: 'gdv-legacy-css',
    apply: 'build',
    // En dernier : `index.html` doit déjà être dans le lot pour que le renvoi
    // vers la feuille y soit réécrit avec le nouveau nom.
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const [name, asset] of Object.entries(bundle)) {
        if (asset.type !== 'asset' || !name.endsWith('.css')) continue;

        const css = typeof asset.source === 'string' ? asset.source : asset.source.toString();
        const lowered = lowerForLegacyEngines(css, name);

        const problems = findUnloweredDeclarations(lowered);
        if (problems.length > 0) {
          this.error(
            `${name} : ${problems.length} déclaration(s) hors de portée du moteur visé.\n` +
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
