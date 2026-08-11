import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addPhysicalFallbacks,
  findUnloweredDeclarations,
  flattenLayers,
  legacyCss,
  lowerForLegacyEngines,
  replaceIndependentTransforms,
} from '../tools/legacy-css';

/** Le strict nécessaire d'un lot Rollup pour éprouver le greffon. */
type Entree =
  | { type: 'asset'; fileName: string; source: string }
  | { type: 'chunk'; fileName: string; code: string };

function passerLeGreffon(bundle: Record<string, Entree>): void {
  const hook = legacyCss().generateBundle;
  assert.equal(typeof hook, 'function', 'le greffon doit exposer generateBundle');
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

describe('abaissement de la feuille de styles', () => {
  it('double un raccourci logique par ses deux propriétés physiques', () => {
    const out = addPhysicalFallbacks('.a{padding-inline:20px}');
    assert.equal(out, '.a{padding-left:20px;padding-right:20px;padding-inline:20px}');
  });

  it('laisse le raccourci logique en dernier, pour que le sens d’écriture prime', () => {
    // C'est tout le mécanisme : un moteur qui connaît `padding-inline` applique
    // la dernière déclaration, donc le RTL continue de fonctionner. Inverser
    // l'ordre ferait gagner la version physique partout.
    const out = addPhysicalFallbacks('.a{padding-inline:20px}');
    assert.ok(out.indexOf('padding-left') < out.indexOf('padding-inline'));
  });

  it('double aussi une valeur qui passe par une variable', () => {
    // La forme que Tailwind v4 émet pour tout son barème d'espacement, et la
    // seule que Lightning CSS refuse d'abaisser lui-même.
    const out = addPhysicalFallbacks('.px-5{padding-inline:calc(var(--spacing) * 5)}');
    assert.ok(out.includes('padding-left:calc(var(--spacing) * 5)'));
    assert.ok(out.includes('padding-right:calc(var(--spacing) * 5)'));
  });

  it('laisse intacte une valeur à deux composantes, qui dépend du sens', () => {
    // `padding-inline: 5px 9px` ne se traduit pas en physique sans savoir si on
    // écrit de gauche à droite. Le doubler poserait un rembourrage inversé en
    // arabe ou en hébreu.
    const source = '.a{padding-inline:5px 9px}';
    assert.equal(addPhysicalFallbacks(source), source);
  });

  it('traite les autres raccourcis de la même famille', () => {
    assert.ok(addPhysicalFallbacks('.a{inset-inline:0}').includes('left:0;right:0'));
    assert.ok(addPhysicalFallbacks('.a{margin-block:4px}').includes('margin-top:4px'));
  });

  it('convertit oklch() et les propriétés logiques d’une vraie feuille', () => {
    const out = lowerForLegacyEngines(
      ':root{--c:oklch(63.7% .237 25.331)}.a{color:oklch(63.7% .237 25.331)}.b{inset-inline:0}',
    );
    assert.ok(!out.includes('oklch('));
    assert.ok(out.includes('left:0'));
  });

  it('signale un raccourci logique laissé sans repli', () => {
    const problems = findUnloweredDeclarations('.a{padding-inline:20px}');
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /padding-inline sans repli/);
  });

  it('ne signale rien sur une feuille correctement abaissée', () => {
    const abaissee = addPhysicalFallbacks('.a{padding-inline:20px}.b{margin-inline:auto}');
    assert.deepEqual(findUnloweredDeclarations(abaissee), []);
  });

  it('signale un oklch() restant', () => {
    const problems = findUnloweredDeclarations('.a{color:oklch(63.7% .237 25.331)}');
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /oklch/);
  });
});

describe('propriétés de transformation indépendantes', () => {
  it('remplace translate par un transform composé', () => {
    const out = replaceIndependentTransforms('.a{translate:0 -50%}');
    assert.ok(out.includes('--nonni-translate:translate(0,-50%)'));
    assert.ok(
      out.includes('transform:var(--nonni-translate) var(--nonni-rotate) var(--nonni-scale)'),
    );
    assert.ok(!/[{;]\s*translate\s*:/.test(out), 'la propriété indépendante ne doit plus rester');
  });

  it('passe par des emplacements, pour que deux utilitaires se composent', () => {
    // `rotate-90 -translate-y-1/2` sur le même élément : en écrivant `transform`
    // en dur, la seconde classe effacerait la première.
    const out = replaceIndependentTransforms('.a{translate:0 -50%}.b{rotate:90deg}');
    assert.ok(out.includes('--nonni-rotate:rotate(90deg)'));
    assert.equal(out.match(/transform:var\(--nonni-translate\)/g)?.length, 2);
  });

  it('remet les emplacements à vide dans une couche, jamais hors couche', () => {
    // Hors couche, le reset l'emporterait sur l'utilitaire qu'il doit seulement
    // précéder, et plus rien ne se transformerait.
    const out = replaceIndependentTransforms('.a{translate:0 -50%}');
    assert.ok(out.startsWith('@layer properties{*,::before,::after,::backdrop{'));
  });

  it('donne une valeur neutre de repli à chaque variable', () => {
    // Sans repli, une variable non initialisée invalide tout le `transform`, et
    // l'élément ne bouge plus du tout.
    const out = replaceIndependentTransforms('.a{translate:var(--tw-x) var(--tw-y)}');
    assert.ok(out.includes('translate(var(--tw-x,0),var(--tw-y,0))'));
  });

  it('ne touche pas une feuille sans transformation', () => {
    const source = '.a{color:red}';
    assert.equal(replaceIndependentTransforms(source), source);
  });

  it('signale une propriété indépendante laissée en place', () => {
    const problems = findUnloweredDeclarations('.a{scale:1.1}');
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /transformation/);
  });
});

describe('dépliage des couches en cascade', () => {
  it('retire la couche et garde son contenu', () => {
    assert.equal(flattenLayers('@layer utilities{.a{color:red}}'), '.a{color:red}');
  });

  it('efface une déclaration d’ordre, qui n’a plus rien à ordonner', () => {
    assert.equal(flattenLayers('@layer theme,base,utilities;.a{color:red}'), '.a{color:red}');
  });

  it('conserve l’ordre du texte, qui devient seul juge de la cascade', () => {
    // C'est ce qui rend le dépliage sans effet sur un moteur récent : Tailwind
    // déclare ses couches dans l'ordre où il les émet.
    const out = flattenLayers('@layer base{.a{color:red}}@layer utilities{.a{color:blue}}');
    assert.equal(out, '.a{color:red}.a{color:blue}');
  });

  it('déplie une couche imbriquée dans une autre', () => {
    assert.equal(flattenLayers('@layer a{@layer b{.x{color:red}}}'), '.x{color:red}');
  });

  it('laisse intacte une at-rule que le moteur connaît', () => {
    const out = flattenLayers('@media (min-width:40px){@layer utilities{.a{color:red}}}');
    assert.equal(out, '@media (min-width:40px){.a{color:red}}');
  });

  it('ne referme pas un bloc sur une accolade tenue par une chaîne', () => {
    // `content: "}"` existe dans la sortie de Tailwind ; compter cette
    // accolade-là découperait la feuille en plein milieu, sans rien signaler.
    const out = flattenLayers('@layer utilities{.a:before{content:"}"}}.b{color:red}');
    assert.equal(out, '.a:before{content:"}"}.b{color:red}');
  });

  it('ne laisse aucune couche dans une feuille abaissée', () => {
    // La sortie de Tailwind v4 est à 91 % dans des couches, et une at-rule
    // inconnue se jette avec son bloc : sans dépliage, un moteur d'avant
    // Chromium 99 conforme à la spécification n'affiche plus rien du tout.
    const out = lowerForLegacyEngines('@layer utilities{.a{translate:0 -50%;padding-inline:4px}}');
    assert.ok(!out.includes('@layer'));
    assert.ok(out.includes('padding-left:4px'));
    assert.ok(out.includes('--nonni-translate:translate(0,-50%)'));
  });

  it('signale une couche laissée en place', () => {
    const problems = findUnloweredDeclarations('@layer utilities{.a{color:red}}');
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /@layer/);
  });
});

describe('renommage de la feuille abaissée', () => {
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

  it('rehache le nom d’après le contenu abaissé', () => {
    // Rollup a haché le nom avant que le greffon ne réécrive la feuille. Sans
    // ce rehachage, deux contenus vivent sous le même nom — et les assets étant
    // servis en `immutable` pour un an, l'abaissement n'atteint jamais un
    // navigateur déjà venu. C'est le cas de celui qu'il vise.
    const bundle = lot();
    passerLeGreffon(bundle);

    assert.equal(bundle['assets/index-AAAAAAAA.css'], undefined);
    const nouveau = Object.keys(bundle).find((n) => n.endsWith('.css'))!;
    assert.notEqual(nouveau, 'assets/index-AAAAAAAA.css');
  });

  it('réécrit le renvoi de la coquille vers le nouveau nom', () => {
    const bundle = lot();
    passerLeGreffon(bundle);

    const nouveau = Object.keys(bundle).find((n) => n.endsWith('.css'))!;
    const html = bundle['index.html']!;
    assert.equal(html.type, 'asset');
    assert.ok(
      html.type === 'asset' && html.source.includes(nouveau),
      'la coquille doit pointer le fichier réellement écrit',
    );
  });

  it('abaisse bien le contenu au passage', () => {
    const bundle = lot();
    passerLeGreffon(bundle);

    const nouveau = Object.keys(bundle).find((n) => n.endsWith('.css'))!;
    const css = bundle[nouveau]!;
    assert.ok(css.type === 'asset' && css.source.includes('padding-left:20px'));
  });
});
