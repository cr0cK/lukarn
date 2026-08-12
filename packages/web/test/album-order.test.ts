import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { readStoredOrder, resolveOrder } from '../src/lib/albumOrder';

/**
 * Album reading order: three sources with an order of precedence.
 *
 * This is the only part of the mechanism with branches, and the only part that
 * can be tested without a DOM. Getting the order wrong breaks nothing obvious:
 * the album opens in the opposite order from what its reader requested.
 */

describe('reading order resolution', () => {
  it('follows the URL before anything else', () => {
    // A shared link, or one received by email, restores an exact view: the
    // browser's stored preference must not contradict it.
    assert.equal(resolveOrder('desc', 'asc', 'asc'), 'desc');
    assert.equal(resolveOrder('asc', 'desc', 'desc'), 'asc');
  });

  it('falls back to what the browser stored', () => {
    assert.equal(resolveOrder(null, 'desc', 'asc'), 'desc');
  });

  it('falls back to the album default last', () => {
    assert.equal(resolveOrder(null, null, 'desc'), 'desc');
    assert.equal(resolveOrder(null, null, 'asc'), 'asc');
  });

  it('ignores a manually altered URL parameter', () => {
    // Otherwise the grid would request `?order=zigzag`, which the API rejects
    // with a 400 — an empty album and an error for a miscopied URL.
    assert.equal(resolveOrder('zigzag', 'desc', 'asc'), 'desc');
    assert.equal(resolveOrder('DESC', null, 'asc'), 'asc');
  });

  it('does not decide until a source has answered', () => {
    // `null` makes the grid wait. A fallback default here would load two
    // hundred items in an order rejected when the album arrives.
    assert.equal(resolveOrder(null, null, undefined), null);
  });
});

describe('per-album memory', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  /** Installs a test `window.localStorage` — there is no DOM here. */
  function stockage(getItem: (key: string) => string | null): void {
    (globalThis as { window?: unknown }).window = { localStorage: { getItem } };
  }

  it('reads the stored order under a per-album key', () => {
    stockage((key) => (key === 'lukarn:album-order:corse' ? 'desc' : null));

    assert.equal(readStoredOrder('corse'), 'desc');
    // One key per album means "Corse" follows the trip order while "Les
    // enfants" starts with the latest photos, without either deciding for the other.
    assert.equal(readStoredOrder('enfants'), null);
  });

  it('ignores a value this code did not write', () => {
    stockage(() => 'chronologique');
    assert.equal(readStoredOrder('corse'), null);
  });

  it('handles denied localStorage access', () => {
    // Private browsing in older Safari makes reading throw. The album must
    // still open in the order chosen by its administrator.
    stockage(() => {
      throw new Error('storage access denied');
    });
    assert.equal(readStoredOrder('corse'), null);
    assert.equal(resolveOrder(null, readStoredOrder('corse'), 'desc'), 'desc');
  });
});
