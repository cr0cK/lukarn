import { useEffect, useState, type ReactElement } from 'react';

/**
 * Une ligne du rapport : un intitulé, une valeur, et le jugement qui décide de
 * sa couleur. `null` vaut « information », ni bon ni mauvais.
 */
interface Ligne {
  cle: string;
  valeur: string;
  bon: boolean | null;
}

/**
 * Rend une propriété sur un élément détaché et rapporte si le navigateur l'a
 * réellement **appliquée**, pas seulement acceptée à l'analyse.
 *
 * `CSS.supports` ne suffit pas : un moteur peut reconnaître la syntaxe d'une
 * propriété et n'en tirer aucun effet, et c'est précisément ce genre d'écart
 * qu'on cherche ici. On mesure donc la géométrie obtenue.
 */
function mesurer(preparer: (parent: HTMLElement) => HTMLElement, attendu: number): boolean {
  const parent = document.createElement('div');
  parent.style.cssText = 'position:absolute;top:-9999px;left:0;width:200px;height:60px';
  const enfant = preparer(parent);
  document.body.appendChild(parent);
  const largeur = enfant.getBoundingClientRect().width;
  parent.remove();
  return Math.abs(largeur - attendu) < 1;
}

/**
 * Injecte une règle et rapporte si le navigateur en a tiré l'effet attendu.
 *
 * C'est la seule façon d'éprouver une **règle at** — `@layer`, `@property` —
 * que `CSS.supports`, qui ne juge que des déclarations, ne sait pas interroger.
 */
function regleAppliquee(css: string, verifier: (sonde: HTMLElement) => boolean): boolean {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  const sonde = document.createElement('span');
  sonde.id = 'sonde-diagnostic';
  document.body.appendChild(sonde);
  const applique = verifier(sonde);
  sonde.remove();
  style.remove();
  return applique;
}

function supporte(propriete: string, valeur: string): boolean {
  try {
    return CSS.supports(propriete, valeur);
  } catch {
    return false;
  }
}

/**
 * `CSS.supports` à un seul argument, la seule forme qui accepte `selector(…)`.
 * Passer une condition à la forme à deux arguments répond toujours faux.
 */
function supporteCondition(condition: string): boolean {
  try {
    return CSS.supports(condition);
  } catch {
    return false;
  }
}

/** Valeurs effectives des encoches — sur un téléviseur, elles disent l'overscan. */
function encoches(): string {
  const sonde = document.createElement('div');
  sonde.style.cssText =
    'position:fixed;top:0;left:0;visibility:hidden;' +
    'padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);' +
    'padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px)';
  document.body.appendChild(sonde);
  const s = getComputedStyle(sonde);
  const lu = `${s.paddingTop} / ${s.paddingRight} / ${s.paddingBottom} / ${s.paddingLeft}`;
  sonde.remove();
  return lu;
}

function releve(): Ligne[] {
  const info = (cle: string, valeur: string): Ligne => ({ cle, valeur, bon: null });
  const test = (cle: string, ok: boolean): Ligne => ({ cle, valeur: ok ? 'OUI' : 'NON', bon: ok });

  // Mesures de géométrie : ce sont les seules qui distinguent « reconnu » de
  // « appliqué », et les propriétés logiques sont justement celles que Tailwind
  // v4 émet partout à la place de leurs équivalents physiques.
  const insetInline = mesurer((parent) => {
    const enfant = document.createElement('div');
    enfant.style.cssText = 'position:absolute;inset-inline:0';
    enfant.textContent = '.';
    parent.appendChild(enfant);
    return enfant;
  }, 200);

  const paddingInline = mesurer((parent) => {
    const enfant = document.createElement('div');
    enfant.style.cssText = 'box-sizing:border-box;width:200px;padding-inline:25px';
    const interieur = document.createElement('div');
    enfant.appendChild(interieur);
    parent.appendChild(enfant);
    return interieur;
  }, 150);

  const flexUn = mesurer((parent) => {
    const rangee = document.createElement('div');
    rangee.style.cssText = 'display:flex;width:200px';
    const gauche = document.createElement('div');
    gauche.style.cssText = 'width:50px;flex-shrink:0';
    const milieu = document.createElement('div');
    milieu.style.cssText = 'flex:1 1 0%;min-width:0';
    rangee.appendChild(gauche);
    rangee.appendChild(milieu);
    parent.appendChild(rangee);
    return milieu;
  }, 150);

  return [
    info('Viewport CSS', `${window.innerWidth} × ${window.innerHeight}`),
    info('Screen', `${window.screen.width} × ${window.screen.height}`),
    info('devicePixelRatio', String(window.devicePixelRatio)),
    info('Encoches h/d/b/g', encoches()),
    info('Pointeur fin', window.matchMedia('(pointer: fine)').matches ? 'oui' : 'non'),
    info('Survol possible', window.matchMedia('(hover: hover)').matches ? 'oui' : 'non'),

    test(
      // Un NON ne condamne plus l'application : la feuille produite est dépliée
      // à la construction (D260809h). Reste un bon marqueur de génération.
      '@layer — no longer required, unwrapped at build time',
      regleAppliquee(
        '@layer diagnostic { #sonde-diagnostic { color: rgb(1, 2, 3) } }',
        (sonde) => getComputedStyle(sonde).color === 'rgb(1, 2, 3)',
      ),
    ),
    test(
      '@property',
      regleAppliquee(
        '@property --sonde-teinte { syntax: "<color>"; inherits: false; initial-value: rgb(4, 5, 6) }',
        // Une propriété enregistrée porte sa valeur initiale sans qu'on la
        // déclare ; ignorée, elle ne calcule rien.
        (sonde) => getComputedStyle(sonde).getPropertyValue('--sonde-teinte').trim() !== '',
      ),
    ),
    test('color-mix()', supporte('color', 'color-mix(in oklab, red 50%, blue)')),
    test('oklch()', supporte('color', 'oklch(63.7% .237 25.331)')),

    test('inset-inline applied (measured)', insetInline),
    test('padding-inline applied (measured)', paddingInline),
    test('flex: 1 1 0% applied (measured)', flexUn),

    test(':has()', supporteCondition('selector(:has(a))')),
    test('dvh units', supporte('height', '100dvh')),
    test('backdrop-filter', supporte('backdrop-filter', 'blur(4px)')),
    test('scrollbar-gutter', supporte('scrollbar-gutter', 'stable')),
    test('scrollbar-width', supporte('scrollbar-width', 'thin')),
    test('aspect-ratio', supporte('aspect-ratio', '16/9')),
    test('text-wrap: balance', supporte('text-wrap', 'balance')),
    test('@container', supporte('container-type', 'inline-size')),
  ];
}

/**
 * Page de relevé des capacités du navigateur, à ouvrir sur l'appareil qui
 * affiche mal.
 *
 * Elle est **écrite en styles en ligne, sans une seule classe Tailwind**, et
 * c'est sa raison d'être : elle rend compte de navigateurs où la feuille de
 * styles de l'application est justement en défaut. Habillée comme le reste, elle
 * mentirait sur l'état qu'elle est censée mesurer — ou ne s'afficherait pas.
 *
 * Elle est publique, comme l'écran de connexion : un navigateur trop ancien pour
 * afficher le formulaire doit quand même pouvoir se décrire.
 */
export default function DiagnosticPage(): ReactElement {
  const [lignes, setLignes] = useState<Ligne[]>([]);

  // Après le montage seulement : tout le relevé mesure le DOM réel.
  useEffect(() => setLignes(releve()), []);

  const version = /Chr[o0]me\/(\d+)/.exec(navigator.userAgent)?.[1];

  return (
    <div
      style={{
        minHeight: '100%',
        background: '#0b0b0d',
        color: '#e8e8ee',
        // Corps volontairement gros : cette page se lit depuis un canapé, à
        // trois mètres d'un téléviseur, et se photographie.
        font: '22px/1.3 system-ui, Arial, sans-serif',
        padding: '16px 28px',
      }}
    >
      <h1 style={{ font: '700 30px/1.2 system-ui, Arial, sans-serif', margin: '0 0 8px' }}>
        Diagnostic du navigateur
      </h1>

      <p style={{ font: '700 34px/1.2 system-ui, Arial, sans-serif', color: '#7aa2ff', margin: 0 }}>
        Chromium {version ?? 'inconnu'} · {window.innerWidth} × {window.innerHeight}
      </p>

      <p
        style={{ fontSize: '18px', color: '#9a9aa6', wordBreak: 'break-all', margin: '8px 0 18px' }}
      >
        {navigator.userAgent}
      </p>

      {/* Deux colonnes dès qu'il y a la place : le relevé se transmet en
          photographiant l'écran, et ce qui dépasse du premier écran ne sera pas
          photographié. Sur un téléviseur, faire défiler à la télécommande pour
          prendre un second cliché, c'est le cliché qu'on n'aura pas. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 40px' }}>
        {[lignes.slice(0, Math.ceil(lignes.length / 2)), lignes.slice(Math.ceil(lignes.length / 2))]
          .filter((moitie) => moitie.length > 0)
          .map((moitie) => (
            <table
              key={moitie[0]!.cle}
              style={{ borderCollapse: 'collapse', flex: '1 1 460px', minWidth: 0 }}
            >
              <tbody>
                {moitie.map((ligne) => (
                  <tr key={ligne.cle}>
                    <td style={{ color: '#9a9aa6', padding: '1px 12px 1px 0' }}>{ligne.cle}</td>
                    <td
                      style={{
                        padding: '1px 0',
                        textAlign: 'right',
                        whiteSpace: 'nowrap',
                        fontWeight: ligne.bon === null ? 400 : 700,
                        color: ligne.bon === null ? '#e8e8ee' : ligne.bon ? '#3ddc84' : '#ff5f5f',
                      }}
                    >
                      {ligne.valeur}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </div>
    </div>
  );
}
