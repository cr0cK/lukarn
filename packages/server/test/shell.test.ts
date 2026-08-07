import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { renderManifest, renderShell } from '../src/shell.js';

/**
 * La substitution du nom d'instance.
 *
 * Ce qui est protégé ici : l'accord entre le gabarit du dépôt et les motifs de
 * `shell.ts`. Ajouter un attribut à la balise `<title>`, ou intervertir `name`
 * et `content` dans une `<meta>`, ne casse rien de visible — le serveur
 * démarre, la page s'affiche, elle porte simplement le mauvais nom. Le test lit
 * le **vrai** `index.html` pour que ce désaccord se voie ici plutôt que sur un
 * écran d'accueil.
 */

const INDEX = fileURLToPath(new URL('../../web/index.html', import.meta.url));
const MANIFESTE = fileURLToPath(new URL('../../web/public/manifest.webmanifest', import.meta.url));

describe('coquille HTML', () => {
  it('remplace les trois emplacements du gabarit réel', () => {
    const rendu = renderShell(readFileSync(INDEX, 'utf8'), 'Chez les Martin');

    assert.match(rendu, /<title>Chez les Martin<\/title>/);
    assert.match(rendu, /name="apple-mobile-web-app-title" content="Chez les Martin"/);
    assert.match(rendu, /name="application-name" content="Chez les Martin"/);
    assert.doesNotMatch(rendu, /Photos/, 'aucun nom par défaut ne doit subsister');
  });

  it('échappe ce qui casserait le HTML autour', () => {
    // Le nom vient du `.env` de l'exploitant, pas d'un visiteur — mais un
    // guillemet suffit à sortir de l'attribut et à disloquer l'en-tête.
    const rendu = renderShell(readFileSync(INDEX, 'utf8'), 'Photos "de" <famille> & co');

    assert.match(rendu, /<title>Photos &quot;de&quot; &lt;famille&gt; &amp; co<\/title>/);
    assert.doesNotMatch(rendu, /content="Photos "de"/);
  });

  it('laisse intact le reste de la page', () => {
    const source = readFileSync(INDEX, 'utf8');
    const rendu = renderShell(source, 'Autre');

    // Le lien vers le manifeste et le script d'entrée sont ce qui fait de cette
    // page une application : une substitution trop gourmande les emporterait.
    assert.match(rendu, /rel="manifest"/);
    assert.match(rendu, /<div id="root">/);
    assert.equal(rendu.split('\n').length, source.split('\n').length);
  });
});

describe('manifeste', () => {
  it('ne surcharge que les deux champs de nom', () => {
    const source = readFileSync(MANIFESTE, 'utf8');
    const rendu = JSON.parse(renderManifest(source, 'Chez les Martin'));
    const origine = JSON.parse(source);

    assert.equal(rendu.name, 'Chez les Martin');
    assert.equal(rendu.short_name, 'Chez les Martin');
    // Les icônes restent déclarées au seul endroit qui les liste : les
    // redéclarer côté serveur les ferait diverger au premier ajout de taille.
    assert.deepEqual(rendu.icons, origine.icons);
    assert.equal(rendu.display, origine.display);
    assert.equal(rendu.theme_color, origine.theme_color);
  });

  it('refuse franchement un manifeste illisible', () => {
    // C'est un fichier du dépôt : s'il ne parse pas, le build est cassé. Servir
    // un manifeste vide rendrait l'application silencieusement non installable.
    assert.throws(() => renderManifest('{ pas du json', 'Photos'));
  });
});
