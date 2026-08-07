import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * Le manifeste et ses icônes.
 *
 * L'invariant qui compte : un chemin d'icône fautif ne casse rien de visible —
 * la grille s'affiche, la console reste muette — il rend seulement l'application
 * non installable, et personne ne s'en aperçoit avant qu'un proche renonce à
 * poser l'icône sur son écran d'accueil.
 */

const WEB = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = join(WEB, 'public');

/** Vite recopie `public/` tel quel à la racine de `dist/` : `/x` y devient `public/x`. */
function surDisque(url: string): string {
  return join(PUBLIC, url.replace(/^\//, ''));
}

const manifeste = JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
const html = readFileSync(join(WEB, 'index.html'), 'utf8');

describe('manifeste', () => {
  it('déclare ce qu’exige une installation', () => {
    assert.equal(manifeste.start_url, '/');
    assert.equal(manifeste.scope, '/');
    assert.equal(manifeste.display, 'standalone');
    assert.ok(manifeste.name && manifeste.short_name);
  });

  it('accorde ses couleurs à celles de l’interface', () => {
    // `--color-ink-900` de `styles.css` : l'écran de démarrage doit prolonger
    // le fond de l'application, pas clignoter en blanc avant elle.
    assert.equal(manifeste.background_color, '#0b0b0d');
    assert.equal(manifeste.theme_color, '#0b0b0d');
  });

  it('porte une icône masquable, pour qu’Android ne rogne pas le motif', () => {
    const masquables = manifeste.icons.filter((icone: { purpose?: string }) =>
      icone.purpose?.split(' ').includes('maskable'),
    );
    assert.ok(masquables.length > 0);
  });
});

describe('icônes', () => {
  it('existent toutes sur disque', () => {
    for (const icone of manifeste.icons as { src: string }[]) {
      assert.ok(existsSync(surDisque(icone.src)), `${icone.src} n'existe pas`);
    }
  });

  it('couvrent l’écran d’accueil iOS, que le manifeste ne suffit pas à servir', () => {
    // Safari ignore `icons` pour l'icône d'accueil : sans ce lien, iOS pose une
    // capture de la page à la place du motif.
    const lien = /<link[^>]+rel="apple-touch-icon"[^>]+href="([^"]+)"/.exec(html);
    assert.ok(lien, 'index.html ne déclare pas d’apple-touch-icon');
    assert.ok(existsSync(surDisque(lien[1]!)), `${lien[1]} n'existe pas`);
  });

  it('sont annoncées au navigateur depuis index.html', () => {
    assert.match(html, /<link[^>]+rel="manifest"[^>]+href="\/manifest\.webmanifest"/);
    assert.match(html, /<link[^>]+rel="icon"[^>]+href="([^"]+)"/);
    const favicon = /<link[^>]+rel="icon"[^>]+href="([^"]+)"/.exec(html);
    assert.ok(existsSync(surDisque(favicon![1]!)), `${favicon![1]} n'existe pas`);
  });
});
