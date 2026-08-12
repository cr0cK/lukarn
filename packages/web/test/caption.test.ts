import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { captionEntries } from '../src/lib/caption';
import { makeTranslate } from '../src/lib/i18n/translate';

/**
 * Caption banner rows.
 *
 * Two pieces of text with decreasing scope, either of which may be absent: this
 * is the only part of the banner with branches and the only part testable
 * without a DOM. An empty row would open a banner on a photo with nothing to say.
 */

/**
 * The English catalogue, read without a provider: these functions produce text,
 * and a test that stubbed the translation would check its own stub.
 */
const t = makeTranslate('en');

describe('caption rows', () => {
  it('returns both scopes in order from most specific to most general', () => {
    const entries = captionEntries(
      {
        description: 'Léa saute du ponton',
        day: 'Bonifacio, then the beach',
      },
      t,
    );

    assert.deepEqual(
      entries.map((entry) => entry.scope),
      ['photo', 'day'],
    );
    // The photo row is the only one without a prefix: the one below concerns
    // something other than the image being viewed.
    assert.deepEqual(
      entries.map((entry) => entry.label),
      [null, 'That day'],
    );
    assert.equal(entries[0]?.text, 'Léa saute du ponton');
  });

  it('removes absent rows without shifting the others', () => {
    const entries = captionEntries({ description: null, day: 'Bonifacio, then the beach' }, t);
    assert.deepEqual(entries, [
      { scope: 'day', label: 'That day', text: 'Bonifacio, then the beach' },
    ]);
  });

  it('treats whitespace-only text as absent', () => {
    // The server already normalises "empty" to `null`, but a note may predate
    // this rule: a blank row would open a banner for nothing.
    assert.deepEqual(captionEntries({ description: '   ', day: '\n' }, t), []);
  });

  it('returns an empty list when nothing is provided', () => {
    assert.deepEqual(captionEntries({}, t), []);
  });

  it('trims surrounding whitespace from rendered text', () => {
    const entries = captionEntries({ description: '  Léa saute du ponton  ' }, t);
    assert.equal(entries[0]?.text, 'Léa saute du ponton');
  });
});
