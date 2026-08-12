import type { MediaDetail, MediaExif } from '@lukarn/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { exifRows } from '../src/lib/exifRows';

/**
 * Information panel rows.
 *
 * The invariant concerns position: it can be read without waiting for
 * geocoding, and its absence is stated — for photos only, because Drive never
 * returns a position for video (D94).
 */

/** EXIF is the only field patched partially, hence its separate type. */
type DetailPatch = Partial<Omit<MediaDetail, 'exif'>> & { exif?: Partial<MediaExif> };

function detail(patch: DetailPatch = {}): MediaDetail {
  return {
    id: 'm1',
    albumId: 'vacances',
    name: 'IMG_0001.jpg',
    kind: 'photo',
    mimeType: 'image/jpeg',
    size: 4_200_000,
    width: 4032,
    height: 3024,
    takenAt: '2026-08-07T15:21:00.000Z',
    takenAtFromExif: true,
    durationMs: null,
    hasPreview: true,
    version: 'abc',
    videoCodec: null,
    description: null,
    commentCount: 0,
    ...patch,
    exif: {
      cameraMake: null,
      cameraModel: null,
      lens: null,
      isoSpeed: null,
      exposureTime: null,
      aperture: null,
      focalLength: null,
      latitude: null,
      longitude: null,
      ...patch.exif,
    },
  };
}

const position = (rows: ReturnType<typeof exifRows>): (typeof rows)[number] | undefined =>
  rows.find((row) => row.label === 'Position');

describe('information panel rows', () => {
  it('shows the position without waiting for the day to be named', () => {
    const rows = exifRows(detail({ exif: { latitude: 41.3878, longitude: 9.1597 } }), {
      day: '2026-08-07',
      description: null,
      place: null,
      // Reverse geocoding has not returned anything yet: the "Lieu" row is
      // missing, but the position remains readable.
      autoPlaces: [],
    });

    assert.equal(
      rows.find((row) => row.label === 'Lieu'),
      undefined,
    );
    assert.equal(position(rows)?.value, '41.38780° N, 9.15970° E');
    assert.match(position(rows)?.href ?? '', /openstreetmap\.org/);
  });

  it('states that a photo has no position instead of omitting the row', () => {
    const row = position(exifRows(detail(), undefined));

    assert.equal(row?.value, 'No GPS data');
    assert.equal(row?.absent, true);
    // An absence is not clickable: without coordinates, there is nowhere to
    // open a map.
    assert.equal(row?.href, undefined);
  });

  it('says nothing about the position of video, which Drive never geolocates', () => {
    const rows = exifRows(detail({ kind: 'video', durationMs: 12_000 }), undefined);

    assert.equal(position(rows), undefined);
    // The missing row must not remove the rest of the panel with it.
    assert.equal(rows.find((row) => row.label === 'Duration')?.value, '0:12');
  });
});
