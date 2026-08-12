import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseVideoSource } from '../src/lib/videoSource';

/**
 * Choosing a video source.
 *
 * A wrong rule is invisible: the video plays or does not, without indicating
 * which of the two sources was involved. These cases therefore follow real
 * `canPlayType` responses.
 */

/** Chrome decodes H.264 but not HEVC, and returns `maybe` for the bare type (D98). */
const chrome = (type: string): string => {
  if (/hvc1|hev1/.test(type)) return '';
  if (/avc1/.test(type)) return 'probably';
  return 'maybe';
};

/** Safari on an iPhone decodes both. */
const safari = (): string => 'probably';

describe('video source selection', () => {
  it('uses the prepared version when the browser cannot decode the codec', () => {
    assert.equal(chooseVideoSource('hvc1', chrome), 'transcoded');
    assert.equal(chooseVideoSource('hev1', chrome), 'transcoded');
  });

  it('keeps the original when the browser can play it', () => {
    assert.equal(chooseVideoSource('avc1', chrome), 'original');
    // A device that decodes HEVC must never receive the transcode: it would lose
    // quality for no benefit and wait for preparation it does not need.
    assert.equal(chooseVideoSource('hvc1', safari), 'original');
  });

  it('keeps the original when the codec is unknown', () => {
    // `null`: header never read, or row indexed before the column existed.
    // Empty string: header read, but no recognised video track. In both cases,
    // uncertainty does not justify requesting a version that was not prepared.
    assert.equal(chooseVideoSource(null, chrome), 'original');
    assert.equal(chooseVideoSource('', chrome), 'original');
  });

  it('asks the browser about the codec, never the bare type', () => {
    // This is D260809b's contribution over D98: for `video/mp4` alone, every
    // browser returns `maybe`, which reveals nothing about the content.
    const demandes: string[] = [];
    chooseVideoSource('hvc1', (type) => {
      demandes.push(type);
      return '';
    });

    assert.deepEqual(demandes, ['video/mp4; codecs="hvc1"']);
  });
});
