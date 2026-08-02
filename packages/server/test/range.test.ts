import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatRange, parseRange } from '../src/media/range.js';

describe('parseRange', () => {
  it('lit une plage complète', () => {
    assert.deepEqual(parseRange('bytes=0-1023'), { start: 0, end: 1023 });
  });

  it('lit une plage ouverte', () => {
    assert.deepEqual(parseRange('bytes=1024-'), { start: 1024, end: null });
  });

  it('lit une plage suffixe', () => {
    assert.deepEqual(parseRange('bytes=-500'), { start: null, end: 500 });
  });

  it('tolère les espaces autour', () => {
    assert.deepEqual(parseRange('  bytes=0-99  '), { start: 0, end: 99 });
  });

  for (const header of [
    undefined,
    '',
    'bytes=-',
    'bytes=abc-def',
    'items=0-10',
    // Plages multiples : la réponse serait multipart, que le proxy ne recompose pas.
    'bytes=0-50, 100-150',
    // Fin avant le début.
    'bytes=500-100',
    // Zéro octet depuis la fin.
    'bytes=-0',
  ]) {
    it(`ignore ${JSON.stringify(header)}`, () => {
      assert.equal(parseRange(header), null);
    });
  }
});

describe('formatRange', () => {
  it('reconstruit chaque forme', () => {
    assert.equal(formatRange({ start: 0, end: 1023 }), 'bytes=0-1023');
    assert.equal(formatRange({ start: 1024, end: null }), 'bytes=1024-');
    assert.equal(formatRange({ start: null, end: 500 }), 'bytes=-500');
  });

  it('fait un aller-retour fidèle', () => {
    for (const header of ['bytes=0-1023', 'bytes=1024-', 'bytes=-500']) {
      assert.equal(formatRange(parseRange(header)!), header);
    }
  });
});
