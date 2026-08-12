import { useEffect, useState, type ReactElement } from 'react';
import { useT, type Translate } from '../lib/i18n';

/**
 * One report row: a label, a value and the judgement deciding its colour. `null`
 * means information, neither good nor bad.
 */
interface Ligne {
  cle: string;
  valeur: string;
  bon: boolean | null;
}

/**
 * Renders a property on a detached element and reports whether the browser
 * actually **applied** it, not merely accepted it while parsing.
 *
 * `CSS.supports` is insufficient: an engine may recognise property syntax but
 * produce no effect, precisely the discrepancy sought here. Measure the resulting
 * geometry instead.
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
 * Injects a rule and reports whether the browser produced the expected effect.
 *
 * This is the only way to test an **at-rule** — `@layer`, `@property` — which
 * `CSS.supports`, limited to declarations, cannot query.
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
 * One-argument `CSS.supports`, the only form accepting `selector(…)`. Passing a
 * condition to the two-argument form always returns false.
 */
function supporteCondition(condition: string): boolean {
  try {
    return CSS.supports(condition);
  } catch {
    return false;
  }
}

/** Effective inset values — on a television they reveal overscan. */
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

/**
 * The survey names CSS properties, which are not translated — `@layer` is called
 * `@layer` everywhere. Only what surrounds them is: the four measurements at the
 * top, and the yes/no of every test.
 */
function releve(t: Translate): Ligne[] {
  const info = (cle: string, valeur: string): Ligne => ({ cle, valeur, bon: null });
  const test = (cle: string, ok: boolean): Ligne => ({
    cle,
    valeur: t(ok ? 'diagnostic.yes' : 'diagnostic.no'),
    bon: ok,
  });

  // Geometry measurements alone distinguish "recognised" from "applied", and
  // logical properties are precisely what Tailwind v4 emits everywhere instead
  // of physical equivalents.
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
    info(t('diagnostic.viewport'), `${window.innerWidth} × ${window.innerHeight}`),
    info(t('diagnostic.screen'), `${window.screen.width} × ${window.screen.height}`),
    info('devicePixelRatio', String(window.devicePixelRatio)),
    info(t('diagnostic.insets'), encoches()),
    info(
      t('diagnostic.finePointer'),
      t(
        window.matchMedia('(pointer: fine)').matches
          ? 'diagnostic.answerYes'
          : 'diagnostic.answerNo',
      ),
    ),
    info(
      t('diagnostic.hover'),
      t(
        window.matchMedia('(hover: hover)').matches
          ? 'diagnostic.answerYes'
          : 'diagnostic.answerNo',
      ),
    ),

    test(
      // NO no longer condemns the application: the produced stylesheet is flattened
      // during the build (D260809h). It remains a useful generation marker.
      t('diagnostic.layer'),
      regleAppliquee(
        '@layer diagnostic { #sonde-diagnostic { color: rgb(1, 2, 3) } }',
        (sonde) => getComputedStyle(sonde).color === 'rgb(1, 2, 3)',
      ),
    ),
    test(
      '@property',
      regleAppliquee(
        '@property --sonde-teinte { syntax: "<color>"; inherits: false; initial-value: rgb(4, 5, 6) }',
        // A registered property carries its initial value without a declaration;
        // ignored, it computes nothing.
        (sonde) => getComputedStyle(sonde).getPropertyValue('--sonde-teinte').trim() !== '',
      ),
    ),
    test('color-mix()', supporte('color', 'color-mix(in oklab, red 50%, blue)')),
    test('oklch()', supporte('color', 'oklch(63.7% .237 25.331)')),

    test(t('diagnostic.measured', 'inset-inline'), insetInline),
    test(t('diagnostic.measured', 'padding-inline'), paddingInline),
    test(t('diagnostic.measured', 'flex: 1 1 0%'), flexUn),

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
 * Browser capability report page to open on the device rendering incorrectly.
 *
 * It uses **inline styles without a single Tailwind class** by design: it reports
 * browsers where the application stylesheet itself fails. Styled like the rest,
 * it would misrepresent the state it measures — or fail to appear.
 *
 * It is public like the sign-in screen: a browser too old to display the form
 * must still be able to describe itself.
 */
export default function DiagnosticPage(): ReactElement {
  const t = useT();
  const [lignes, setLignes] = useState<Ligne[]>([]);

  // After mounting only: the entire report measures the real DOM.
  useEffect(() => setLignes(releve(t)), [t]);

  const version = /Chr[o0]me\/(\d+)/.exec(navigator.userAgent)?.[1];

  return (
    <div
      style={{
        minHeight: '100%',
        background: '#0b0b0d',
        color: '#e8e8ee',
        // Deliberately large body: this page is read from a sofa three metres from
        // a television and photographed.
        font: '22px/1.3 system-ui, Arial, sans-serif',
        padding: '16px 28px',
      }}
    >
      <h1 style={{ font: '700 30px/1.2 system-ui, Arial, sans-serif', margin: '0 0 8px' }}>
        {t('diagnostic.title')}
      </h1>

      <p style={{ font: '700 34px/1.2 system-ui, Arial, sans-serif', color: '#7aa2ff', margin: 0 }}>
        Chromium {version ?? t('diagnostic.unknown')} · {window.innerWidth} × {window.innerHeight}
      </p>

      <p
        style={{ fontSize: '18px', color: '#9a9aa6', wordBreak: 'break-all', margin: '8px 0 18px' }}
      >
        {navigator.userAgent}
      </p>

      {/* Use two columns as soon as space allows: the report is shared by
          photographing the screen, and anything below the first screen will not
          be photographed. On a television, scrolling by remote for a second shot
          means that shot will never be taken. */}
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
