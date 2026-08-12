import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatRange, parseRange } from '../src/media/range.js';

describe('parseRange', () => {
  it('reads a complete range', () => {
    assert.deepEqual(parseRange('bytes=0-1023'), { start: 0, end: 1023 });
  });

  it('reads an open range', () => {
    assert.deepEqual(parseRange('bytes=1024-'), { start: 1024, end: null });
  });

  it('reads a suffix range', () => {
    assert.deepEqual(parseRange('bytes=-500'), { start: null, end: 500 });
  });

  it('tolerates surrounding spaces', () => {
    assert.deepEqual(parseRange('  bytes=0-99  '), { start: 0, end: 99 });
  });

  for (const header of [
    undefined,
    '',
    'bytes=-',
    'bytes=abc-def',
    'items=0-10',
    // Multiple ranges: the response would be multipart, which the proxy does not reassemble.
    'bytes=0-50, 100-150',
    // End before start.
    'bytes=500-100',
    // Zero bytes from the end.
    'bytes=-0',
  ]) {
    it(`ignores ${JSON.stringify(header)}`, () => {
      assert.equal(parseRange(header), null);
    });
  }
});

describe('formatRange', () => {
  it('reconstructs every form', () => {
    assert.equal(formatRange({ start: 0, end: 1023 }), 'bytes=0-1023');
    assert.equal(formatRange({ start: 1024, end: null }), 'bytes=1024-');
    assert.equal(formatRange({ start: null, end: 500 }), 'bytes=-500');
  });

  it('round-trips faithfully', () => {
    for (const header of ['bytes=0-1023', 'bytes=1024-', 'bytes=-500']) {
      assert.equal(formatRange(parseRange(header)!), header);
    }
  });
});
