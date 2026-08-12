import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classify,
  parseExifTime,
  parseNameTime,
  resolveVideoTakenAt,
  toCoordinates,
  toNumber,
} from '../src/drive/metadata.js';

describe('classify', () => {
  it('recognises photos and videos', () => {
    assert.equal(classify('image/jpeg'), 'photo');
    assert.equal(classify('image/heic'), 'photo');
    assert.equal(classify('video/mp4'), 'video');
    assert.equal(classify('video/quicktime'), 'video');
  });

  it('discards everything else', () => {
    assert.equal(classify('application/pdf'), null);
    assert.equal(classify('application/vnd.google-apps.folder'), null);
    assert.equal(classify(null), null);
    assert.equal(classify(undefined), null);
  });
});

describe('parseExifTime', () => {
  it('reads the Drive format', () => {
    // Interpreted as UTC: the displayed time is the device time.
    assert.equal(parseExifTime('2023:07:14 18:32:10'), '2023-07-14T18:32:10.000Z');
  });

  it('tolerates the ISO separator', () => {
    assert.equal(parseExifTime('2023:07:14T18:32:10'), '2023-07-14T18:32:10.000Z');
  });

  it('rejects empty EXIF', () => {
    assert.equal(parseExifTime('0000:00:00 00:00:00'), null);
  });

  it('rejects a nonexistent date', () => {
    // Without validation, Date.UTC would roll over to 3 March.
    assert.equal(parseExifTime('2023:02:31 12:00:00'), null);
  });

  it('rejects missing or unreadable values', () => {
    assert.equal(parseExifTime(null), null);
    assert.equal(parseExifTime(undefined), null);
    assert.equal(parseExifTime(''), null);
    assert.equal(parseExifTime('pas une date'), null);
  });
});

describe('parseNameTime', () => {
  it('reads names produced by phones', () => {
    // The milliseconds a Pixel adds after the seconds do not interfere.
    assert.equal(parseNameTime('PXL_20260729_143012123.mp4'), '2026-07-29T14:30:12.000Z');
    assert.equal(parseNameTime('VID_20260729_143012.mp4'), '2026-07-29T14:30:12.000Z');
    assert.equal(parseNameTime('IMG_20260805_091544.MOV'), '2026-08-05T09:15:44.000Z');
    assert.equal(parseNameTime('20260805-091544.mp4'), '2026-08-05T09:15:44.000Z');
  });

  it('finds nothing in a name without a timestamp', () => {
    assert.equal(parseNameTime('anniversaire.mp4'), null);
    assert.equal(parseNameTime('20260805.mp4'), null);
    assert.equal(parseNameTime(null), null);
    assert.equal(parseNameTime(''), null);
  });

  it('rejects a date that cannot exist', () => {
    assert.equal(parseNameTime('VID_20260231_143012.mp4'), null);
    assert.equal(parseNameTime('VID_20260729_251012.mp4'), null);
    assert.equal(parseNameTime('VID_20260729_146012.mp4'), null);
  });

  it('does not split a long number into a date', () => {
    // An export identifier, not a timestamp: the preceding digit is enough to tell.
    assert.equal(parseNameTime('9920260729_143012.mp4'), null);
  });
});

describe('resolveVideoTakenAt', () => {
  const modifiedTime = '2026-08-08T07:51:00.000Z';

  it('prefers the name when the container corroborates it', () => {
    // The name carries the recording start in device time, exactly like photo
    // EXIF. Here the container is UTC, two hours earlier: two representations
    // of the same instant.
    const resolu = resolveVideoTakenAt({
      name: 'PXL_20260729_143012123.mp4',
      containerTime: '2026-07-29T12:30:38.000Z',
      durationMs: 26_000,
      modifiedTime,
    });

    assert.deepEqual(resolu, { takenAt: '2026-07-29T14:30:12.000Z', fromFile: true });
  });

  it('works back from the container to the recording start', () => {
    // Without a usable name, the header is written when recording stops, so
    // capture begins one duration earlier.
    const resolu = resolveVideoTakenAt({
      name: 'vacances.mp4',
      containerTime: '2026-07-29T12:30:38.000Z',
      durationMs: 38_000,
      modifiedTime,
    });

    assert.deepEqual(resolu, { takenAt: '2026-07-29T12:30:00.000Z', fromFile: true });
  });

  it('discards a timestamped name unrelated to the file', () => {
    // More than 26 hours apart: the name comes from elsewhere — a renamed file
    // or a number resembling a date. The container is inside the file.
    const resolu = resolveVideoTakenAt({
      name: 'VID_20240101_120000.mp4',
      containerTime: '2026-07-29T12:30:38.000Z',
      durationMs: 38_000,
      modifiedTime,
    });

    assert.deepEqual(resolu, { takenAt: '2026-07-29T12:30:00.000Z', fromFile: true });
  });

  it('uses the name alone when the container cannot be opened', () => {
    const resolu = resolveVideoTakenAt({
      name: 'VID_20260729_143012.avi',
      containerTime: null,
      durationMs: null,
      modifiedTime,
    });

    assert.deepEqual(resolu, { takenAt: '2026-07-29T14:30:12.000Z', fromFile: true });
  });

  it('falls back to the modification date and reports it', () => {
    // The only case that does not claim to date capture: `fromFile` is false,
    // and the interface writes "Modified" rather than "Taken".
    const resolu = resolveVideoTakenAt({
      name: 'anniversaire.mp4',
      containerTime: null,
      durationMs: null,
      modifiedTime,
    });

    assert.deepEqual(resolu, { takenAt: modifiedTime, fromFile: false });
  });

  it('works without duration when Drive does not know it', () => {
    const resolu = resolveVideoTakenAt({
      name: null,
      containerTime: '2026-07-29T12:30:38.000Z',
      durationMs: null,
      modifiedTime,
    });

    assert.deepEqual(resolu, { takenAt: '2026-07-29T12:30:38.000Z', fromFile: true });
  });
});

describe('toNumber', () => {
  it('converts numbers and numeric strings', () => {
    assert.equal(toNumber(42), 42);
    assert.equal(toNumber('1024'), 1024);
    assert.equal(toNumber(''), null);
    assert.equal(toNumber(null), null);
    assert.equal(toNumber('abc'), null);
  });
});

describe('toCoordinates', () => {
  it('returns a populated position', () => {
    assert.deepEqual(toCoordinates(48.8566, 2.3522), { lat: 48.8566, lng: 2.3522 });
  });

  it('discards the (0, 0) pair Drive returns without a position', () => {
    assert.deepEqual(toCoordinates(0, 0), { lat: null, lng: null });
  });

  it('keeps the latitude of a photo taken on the equator', () => {
    // Zero is not absence: this photo does have a position.
    assert.deepEqual(toCoordinates(0, 32.5825), { lat: 0, lng: 32.5825 });
  });

  it('keeps the longitude of a photo taken on the Greenwich meridian', () => {
    assert.deepEqual(toCoordinates(51.4779, 0), { lat: 51.4779, lng: 0 });
  });

  it('rejects half a position', () => {
    // A latitude without longitude locates nothing: displaying nothing is safer.
    assert.deepEqual(toCoordinates(48.8566, null), { lat: null, lng: null });
    assert.deepEqual(toCoordinates(undefined, 2.3522), { lat: null, lng: null });
  });
});
