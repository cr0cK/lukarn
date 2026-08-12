import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { captionEntries } from '../src/lib/caption';

/**
 * Caption banner rows.
 *
 * Two pieces of text with decreasing scope, either of which may be absent: this
 * is the only part of the banner with branches and the only part testable
 * without a DOM. An empty row would open a banner on a photo with nothing to say.
 */

describe('caption rows', () => {
  it('returns both scopes in order from most specific to most general', () => {
    const entries = captionEntries({
      description: 'Léa saute du ponton',
      day: 'Bonifacio, then the beach',
    });

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
    const entries = captionEntries({ description: null, day: 'Bonifacio, then the beach' });
    assert.deepEqual(entries, [
      { scope: 'day', label: 'That day', text: 'Bonifacio, then the beach' },
    ]);
  });

  it('treats whitespace-only text as absent', () => {
    // The server already normalises "empty" to `null`, but a note may predate
    // this rule: a blank row would open a banner for nothing.
    assert.deepEqual(captionEntries({ description: '   ', day: '\n' }), []);
  });

  it('returns an empty list when nothing is provided', () => {
    assert.deepEqual(captionEntries({}), []);
  });

  it('trims surrounding whitespace from rendered text', () => {
    const entries = captionEntries({ description: '  Léa saute du ponton  ' });
    assert.equal(entries[0]?.text, 'Léa saute du ponton');
  });
});
