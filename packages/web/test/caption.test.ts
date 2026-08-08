import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { captionEntries } from '../src/lib/caption';

/**
 * Les lignes du bandeau de légende.
 *
 * Deux textes de portée décroissante, dont chacun peut manquer : c'est le seul
 * endroit du bandeau qui ait des cas, et le seul qui se teste sans DOM. Une
 * ligne vide y ouvrirait un bandeau sur une photo qui n'a rien à dire.
 */

describe('lignes de légende', () => {
  it('rend les deux portées dans l’ordre, du plus précis au plus général', () => {
    const entries = captionEntries({
      description: 'Léa saute du ponton',
      day: 'Bonifacio, puis la plage',
    });

    assert.deepEqual(
      entries.map((entry) => entry.scope),
      ['photo', 'day'],
    );
    // La ligne de la photo est la seule sans préfixe : celle du dessous parle
    // d'autre chose que de l'image qu'on regarde.
    assert.deepEqual(
      entries.map((entry) => entry.label),
      [null, 'Ce jour-là'],
    );
    assert.equal(entries[0]?.text, 'Léa saute du ponton');
  });

  it('écarte les lignes absentes sans décaler les autres', () => {
    const entries = captionEntries({ description: null, day: 'Bonifacio, puis la plage' });
    assert.deepEqual(entries, [
      { scope: 'day', label: 'Ce jour-là', text: 'Bonifacio, puis la plage' },
    ]);
  });

  it('traite un texte réduit à des espaces comme absent', () => {
    // Le serveur ramène déjà « vide » à `null`, mais une note a pu être écrite
    // avant cette règle : une ligne blanche ouvrirait un bandeau sur rien.
    assert.deepEqual(captionEntries({ description: '   ', day: '\n' }), []);
  });

  it('rend une liste vide quand rien n’est renseigné', () => {
    assert.deepEqual(captionEntries({}), []);
  });

  it('rogne les blancs de bord du texte rendu', () => {
    const entries = captionEntries({ description: '  Léa saute du ponton  ' });
    assert.equal(entries[0]?.text, 'Léa saute du ponton');
  });
});
