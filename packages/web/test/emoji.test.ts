import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emojify, insertEmoji } from '../src/lib/emoji';

/**
 * Conversion of shortcuts to emoji.
 *
 * The risk is not missing a substitution, which would be visible, but making
 * one too many in the middle of a word or address. A link broken in an already
 * published comment will not be caught: the stored body is intact, but nobody
 * will reopen the thread to check what rendering did to it.
 */

describe('emoji shortcuts', () => {
  it('converts isolated shortcuts', () => {
    assert.equal(emojify('Superbe photo :)'), 'Superbe photo 🙂');
    assert.equal(emojify(':) au début'), '🙂 au début');
    assert.equal(emojify('avant :) après'), 'avant 🙂 après');
  });

  it('prefers the longest shortcut', () => {
    // Without sorting the alternation, `:)` would split `:-)` and leave a hyphen.
    assert.equal(emojify('coucou :-)'), 'coucou 🙂');
    assert.equal(emojify('cassé </3'), 'cassé 💔');
  });

  it('does not alter a URL', () => {
    // This would be the costliest regression because `:/` occurs in every link.
    const lien = 'Regarde https://exemple.fr/photos';
    assert.equal(emojify(lien), lien);
    assert.equal(emojify('http://exemple.fr'), 'http://exemple.fr');
  });

  it('does not split a word that starts with a shortcut', () => {
    assert.equal(emojify('mange une :pizza'), 'mange une :pizza');
    assert.equal(emojify('AC:DC'), 'AC:DC');
    assert.equal(emojify('rendez-vous à 20:30'), 'rendez-vous à 20:30');
  });

  it('accepts punctuation after the shortcut', () => {
    assert.equal(emojify('génial :)!'), 'génial 🙂!');
    assert.equal(emojify('bravo :), vraiment'), 'bravo 🙂, vraiment');
  });

  it('converts several shortcuts in the same text', () => {
    assert.equal(emojify(':) et ;) et <3'), '🙂 et 😉 et ❤️');
  });

  it('is idempotent', () => {
    // An emoji is not a shortcut: applying the function again, as every React
    // render does, must not change anything further.
    const une = emojify('trop bien :) <3');
    assert.equal(emojify(une), une);
  });

  it('passes through real emoji from the keyboard', () => {
    // This is the mobile path: nothing to convert and nothing to damage.
    assert.equal(emojify('Quelle vue 😍🏔️'), 'Quelle vue 😍🏔️');
  });

  it('treats line breaks as separators', () => {
    assert.equal(emojify('une ligne\n:)'), 'une ligne\n🙂');
  });
});

describe('insertion from the palette', () => {
  it('inserts at the cursor position', () => {
    const { value, caret } = insertEmoji('bonjour tout le monde', 7, 7, '👋');
    assert.equal(value, 'bonjour👋 tout le monde');
    // The cursor moves after the emoji, otherwise the next one would appear before it.
    assert.equal(caret, 7 + '👋'.length);
  });

  it('replaces the selection', () => {
    const { value } = insertEmoji('bonjour tout le monde', 0, 7, '👋');
    assert.equal(value, '👋 tout le monde');
  });

  it('supports an empty field', () => {
    const { value, caret } = insertEmoji('', 0, 0, '🎉');
    assert.equal(value, '🎉');
    assert.equal(caret, '🎉'.length);
  });

  it('bounds inconsistent positions', () => {
    // `selectionStart` may be `null` in the DOM, and the caller substitutes the
    // text length: the function must not produce `undefined`.
    const { value } = insertEmoji('abc', 99, 99, '✨');
    assert.equal(value, 'abc✨');

    const inverse = insertEmoji('abc', 2, 1, '✨');
    assert.equal(inverse.value, 'ab✨c');
  });
});
