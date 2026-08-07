import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emojify, insertEmoji } from '../src/lib/emoji';

/**
 * Traduction des raccourcis en emoji.
 *
 * Le risque n'est pas de manquer une substitution — on le verrait — mais d'en
 * faire une de trop, au milieu d'un mot ou d'une adresse. Un lien coupé dans un
 * commentaire déjà publié ne se rattrape pas : le corps stocké est intact, mais
 * personne ne va rouvrir le fil pour vérifier ce que l'affichage en a fait.
 */

describe('raccourcis emoji', () => {
  it('traduit les raccourcis isolés', () => {
    assert.equal(emojify('Superbe photo :)'), 'Superbe photo 🙂');
    assert.equal(emojify(':) au début'), '🙂 au début');
    assert.equal(emojify('avant :) après'), 'avant 🙂 après');
  });

  it('préfère le raccourci le plus long', () => {
    // Sans tri de l'alternance, `:)` couperait `:-)` en laissant un tiret.
    assert.equal(emojify('coucou :-)'), 'coucou 🙂');
    assert.equal(emojify('cassé </3'), 'cassé 💔');
  });

  it('ne touche pas à une URL', () => {
    // La régression qui coûterait le plus cher : `:/` vit dans tout lien.
    const lien = 'Regarde https://exemple.fr/photos';
    assert.equal(emojify(lien), lien);
    assert.equal(emojify('http://exemple.fr'), 'http://exemple.fr');
  });

  it('ne coupe pas un mot qui commence par un raccourci', () => {
    assert.equal(emojify('mange une :pizza'), 'mange une :pizza');
    assert.equal(emojify('AC:DC'), 'AC:DC');
    assert.equal(emojify('rendez-vous à 20:30'), 'rendez-vous à 20:30');
  });

  it('accepte une ponctuation derrière le raccourci', () => {
    assert.equal(emojify('génial :)!'), 'génial 🙂!');
    assert.equal(emojify('bravo :), vraiment'), 'bravo 🙂, vraiment');
  });

  it('traduit plusieurs raccourcis dans le même texte', () => {
    assert.equal(emojify(':) et ;) et <3'), '🙂 et 😉 et ❤️');
  });

  it('est idempotente', () => {
    // Un emoji n'est pas un raccourci : réappliquer la fonction, ce que fait
    // chaque rendu React, ne doit rien changer de plus.
    const une = emojify('trop bien :) <3');
    assert.equal(emojify(une), une);
  });

  it('laisse passer les vrais emoji du clavier', () => {
    // Le chemin mobile : rien à traduire, rien à abîmer.
    assert.equal(emojify('Quelle vue 😍🏔️'), 'Quelle vue 😍🏔️');
  });

  it('respecte les retours à la ligne comme séparateurs', () => {
    assert.equal(emojify('une ligne\n:)'), 'une ligne\n🙂');
  });
});

describe('insertion depuis la palette', () => {
  it('insère à la position du curseur', () => {
    const { value, caret } = insertEmoji('bonjour tout le monde', 7, 7, '👋');
    assert.equal(value, 'bonjour👋 tout le monde');
    // Le curseur passe derrière l'emoji, sinon le suivant se placerait devant.
    assert.equal(caret, 7 + '👋'.length);
  });

  it('remplace la sélection', () => {
    const { value } = insertEmoji('bonjour tout le monde', 0, 7, '👋');
    assert.equal(value, '👋 tout le monde');
  });

  it('supporte un champ vide', () => {
    const { value, caret } = insertEmoji('', 0, 0, '🎉');
    assert.equal(value, '🎉');
    assert.equal(caret, '🎉'.length);
  });

  it('borne des positions incohérentes', () => {
    // `selectionStart` peut valoir `null` côté DOM, et l'appelant y substitue la
    // longueur du texte : la fonction ne doit pas produire de `undefined`.
    const { value } = insertEmoji('abc', 99, 99, '✨');
    assert.equal(value, 'abc✨');

    const inverse = insertEmoji('abc', 2, 1, '✨');
    assert.equal(inverse.value, 'ab✨c');
  });
});
