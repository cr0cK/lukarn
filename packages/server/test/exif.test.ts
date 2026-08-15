import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { findExifSegment } from '../src/sync/exif.js';
import { fromExifBlock } from '../src/sync/metadata.js';

/**
 * Reading a photograph's metadata out of the first bytes of the file.
 *
 * Drive returns it pre-parsed in the listing; every other backend hands over bytes.
 * These cases are the ones that decide whether a folder of holiday photographs lands in
 * the right month and on the right map: an orientation that exchanges the axes, a
 * southern hemisphere, and a file with no EXIF at all — which is the ordinary case, not
 * an error.
 *
 * The fixtures are built rather than committed: a JPEG is assembled marker by marker
 * from a real EXIF block so the test states exactly what it exercises, and a binary in
 * the repository would state nothing.
 */

/**
 * Big-endian TIFF entry: tag, type, count, then either the value or an offset to it.
 *
 * The four-byte field holds the value itself when it fits, **left-aligned**, and an
 * offset from the TIFF header otherwise. A two-letter hemisphere reference is the case
 * that catches this out: it fits, so a reader looking for it at an offset finds nothing
 * and every southern photograph lands in the north.
 */
function entry(tag: number, type: number, count: number, value: number | Buffer): Buffer {
  const buffer = Buffer.alloc(12);
  buffer.writeUInt16BE(tag, 0);
  buffer.writeUInt16BE(type, 2);
  buffer.writeUInt32BE(count, 4);

  if (Buffer.isBuffer(value)) value.copy(buffer, 8, 0, Math.min(value.length, 4));
  else if (type === SHORT) buffer.writeUInt16BE(value, 8);
  else buffer.writeUInt32BE(value, 8);

  return buffer;
}

const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;

interface Photo {
  orientation?: number;
  dateTimeOriginal?: string;
  make?: string;
  latitude?: [number, number, number];
  latitudeRef?: string;
  longitude?: [number, number, number];
  longitudeRef?: string;
}

/**
 * A TIFF structure carrying IFD0, an Exif sub-IFD and a GPS sub-IFD.
 *
 * Written by hand because that is the only way to place a value the reader must follow
 * an offset to reach — a date is twenty bytes and a coordinate twenty-four, so neither
 * fits in an entry and both live in the trailing block. Getting that indirection wrong
 * is the failure this whole file exists to catch.
 */
function tiff(photo: Photo): Buffer {
  const header = Buffer.alloc(8);
  header.write('MM', 0, 'latin1');
  header.writeUInt16BE(42, 2);
  header.writeUInt32BE(8, 4);

  const trailing: Buffer[] = [];
  let trailingAt = 0;

  // Offsets are counted from the TIFF header, so the position of the trailing block has
  // to be known before its contents are written: everything before it is fixed-size.
  const ifd0Entries: Buffer[] = [];
  const exifEntries: Buffer[] = [];
  const gpsEntries: Buffer[] = [];

  const ifd0Count =
    (photo.make ? 1 : 0) + (photo.orientation ? 1 : 0) + 1 + (photo.latitude ? 1 : 0);
  const exifCount = photo.dateTimeOriginal ? 1 : 0;
  const gpsCount = photo.latitude ? 4 : 0;

  const ifd0At = 8;
  const exifAt = ifd0At + 2 + ifd0Count * 12 + 4;
  const gpsAt = exifAt + 2 + exifCount * 12 + 4;
  const trailingBase = gpsAt + 2 + gpsCount * 12 + 4;

  const place = (value: Buffer): number => {
    const at = trailingBase + trailingAt;
    trailing.push(value);
    trailingAt += value.length;
    return at;
  };

  if (photo.make) {
    ifd0Entries.push(
      entry(0x010f, ASCII, photo.make.length + 1, place(Buffer.from(`${photo.make}\0`, 'latin1'))),
    );
  }
  if (photo.orientation) ifd0Entries.push(entry(0x0112, SHORT, 1, photo.orientation));
  // ExifIFDPointer, always present so the sub-IFD is reachable even when empty.
  ifd0Entries.push(entry(0x8769, LONG, 1, exifAt));
  if (photo.latitude) ifd0Entries.push(entry(0x8825, LONG, 1, gpsAt));

  if (photo.dateTimeOriginal) {
    exifEntries.push(
      entry(0x9003, ASCII, 20, place(Buffer.from(`${photo.dateTimeOriginal}\0`, 'latin1'))),
    );
  }

  if (photo.latitude && photo.longitude) {
    const rational = (parts: [number, number, number]): Buffer => {
      const buffer = Buffer.alloc(24);
      parts.forEach((part, index) => {
        buffer.writeUInt32BE(Math.round(part * 100), index * 8);
        buffer.writeUInt32BE(100, index * 8 + 4);
      });
      return buffer;
    };
    gpsEntries.push(entry(0x0001, ASCII, 2, Buffer.from(`${photo.latitudeRef ?? 'N'}\0`)));
    gpsEntries.push(entry(0x0002, RATIONAL, 3, place(rational(photo.latitude))));
    gpsEntries.push(entry(0x0003, ASCII, 2, Buffer.from(`${photo.longitudeRef ?? 'E'}\0`)));
    gpsEntries.push(entry(0x0004, RATIONAL, 3, place(rational(photo.longitude))));
  }

  const ifd = (entries: Buffer[]): Buffer => {
    const count = Buffer.alloc(2);
    count.writeUInt16BE(entries.length, 0);
    return Buffer.concat([count, ...entries, Buffer.alloc(4)]);
  };

  return Buffer.concat([header, ifd(ifd0Entries), ifd(exifEntries), ifd(gpsEntries), ...trailing]);
}

/** A JPEG carrying that TIFF in its `APP1` segment, preceded by a `JFIF` `APP0`. */
function jpeg(photo: Photo): Buffer {
  const block = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff(photo)]);

  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0]),
    lengthOf(16),
    Buffer.from('JFIF\0\0\0\0\0\0', 'latin1'),
  ]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), lengthOf(block.length + 2), block]);

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    app1,
    Buffer.from([0xff, 0xda, 0x00, 0x02]),
  ]);
}

function lengthOf(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value, 0);
  return buffer;
}

describe('a JPEG', () => {
  it('reads the capture date, the camera and the orientation', async () => {
    const block = findExifSegment(
      jpeg({ make: 'Canon', orientation: 6, dateTimeOriginal: '2026:07:14 09:21:03' }),
    );
    assert.ok(block, 'the APP1 segment must be found past the JFIF one');

    const media = fromExifBlock(block)!;
    // The device's clock, read without a time zone and stored as UTC: this is the
    // convention the whole application displays in.
    assert.equal(media.takenAt, '2026-07-14T09:21:03.000Z');
    assert.equal(media.cameraMake, 'Canon');
    // Orientation 6 exchanges the axes. The grid computes its rows from the dimensions
    // before loading a thumbnail, so a portrait photograph reported as landscape shows
    // a distorted tile on first paint.
    assert.equal(media.rotated, true);
  });

  it('puts a southern, western position in the right quarter of the world', async () => {
    const block = findExifSegment(
      jpeg({
        latitude: [33, 26, 15],
        latitudeRef: 'S',
        longitude: [70, 39, 1],
        longitudeRef: 'W',
      }),
    )!;
    const media = fromExifBlock(block)!;

    // EXIF stores degrees unsigned: Santiago and Kraków carry nearly the same three
    // numbers and differ only by these two letters.
    assert.ok(media.lat !== null && media.lat < -33 && media.lat > -34, `lat ${media.lat}`);
    assert.ok(media.lng !== null && media.lng < -70 && media.lng > -71, `lng ${media.lng}`);
  });

  it('reports no position rather than half of one', async () => {
    const block = findExifSegment(jpeg({ make: 'Canon' }))!;
    const media = fromExifBlock(block)!;

    assert.equal(media.lat, null);
    assert.equal(media.lng, null);
  });

  it('finds nothing in a JPEG that carries no EXIF', async () => {
    const plain = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    // A screenshot or a re-encoded photograph. The ordinary case, not an error: the
    // caller falls back to the file's modification date.
    assert.equal(findExifSegment(plain), null);
  });

  it('does not read past the end of a truncated window', async () => {
    const full = jpeg({ make: 'Canon', dateTimeOriginal: '2026:07:14 09:21:03' });
    // The window ends inside the APP1 segment: the date lives in the trailing block and
    // is unreachable. Nothing may be invented, and nothing may throw.
    const block = findExifSegment(full.subarray(0, 40));
    if (block) assert.equal(fromExifBlock(block)?.takenAt ?? null, null);
  });
});

describe('a HEIC', () => {
  /**
   * A HEIC stores its EXIF as an item: `iinf` gives the item of type `Exif` a number and
   * `iloc` says where its bytes are. This fixture is the smallest file that exercises
   * that indirection, which is the part a JPEG never tests.
   */
  function heic(photo: Photo): { file: Buffer; payloadAt: number } {
    const block = Buffer.concat([
      Buffer.alloc(4), // exif_tiff_header_offset: none, the TIFF follows directly
      tiff(photo),
    ]);

    const box = (type: string, body: Buffer): Buffer => {
      const size = Buffer.alloc(4);
      size.writeUInt32BE(body.length + 8, 0);
      return Buffer.concat([size, Buffer.from(type, 'latin1'), body]);
    };

    const ftyp = box('ftyp', Buffer.from('heic\0\0\0\0heicmif1', 'latin1'));

    // infe version 2: version and flags, item id (2), protection index (2), type,
    // then a null-terminated name.
    const infeBody = Buffer.concat([
      Buffer.from([2, 0, 0, 0]),
      Buffer.from([0, 1]),
      Buffer.from([0, 0]),
      Buffer.from('Exif\0', 'latin1'),
    ]);
    const iinf = box(
      'iinf',
      Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from([0, 1]), box('infe', infeBody)]),
    );

    // The item's offset is absolute in the file, so the boxes that precede it have to
    // be measured before it can be written. `iloc` itself has a fixed size here.
    const ilocSize = 8 + 4 + 2 + 2 + 2 + 2 + 2 + 4 + 4;
    const metaHeader = 8 + 4;
    const payloadAt = ftyp.length + metaHeader + iinf.length + ilocSize;

    // version 0: offset_size 4, length_size 4, base_offset_size 0.
    const ilocBody = Buffer.alloc(ilocSize - 8);
    let at = 0;
    ilocBody.writeUInt32BE(0, at); // version and flags
    at += 4;
    ilocBody.writeUInt8(0x44, at); // offset_size 4, length_size 4
    ilocBody.writeUInt8(0x00, at + 1); // base_offset_size 0
    at += 2;
    ilocBody.writeUInt16BE(1, at); // item count
    at += 2;
    ilocBody.writeUInt16BE(1, at); // item id
    at += 2;
    ilocBody.writeUInt16BE(0, at); // data reference index
    at += 2;
    ilocBody.writeUInt16BE(1, at); // extent count
    at += 2;
    ilocBody.writeUInt32BE(payloadAt, at);
    at += 4;
    ilocBody.writeUInt32BE(block.length, at);

    const iloc = box('iloc', ilocBody);
    const meta = box('meta', Buffer.concat([Buffer.from([0, 0, 0, 0]), iinf, iloc]));

    return { file: Buffer.concat([ftyp, meta, block]), payloadAt };
  }

  it('follows iinf and iloc to the EXIF item', async () => {
    const { file } = heic({ make: 'Apple', dateTimeOriginal: '2026:08:02 18:40:00' });
    const block = findExifSegment(file);
    assert.ok(block, 'the Exif item must be located through iinf and iloc');

    const media = fromExifBlock(block)!;
    assert.equal(media.cameraMake, 'Apple');
    assert.equal(media.takenAt, '2026-08-02T18:40:00.000Z');
  });

  it('finds nothing when the item lies beyond the window', async () => {
    const { file, payloadAt } = heic({ make: 'Apple' });
    // The real limit of reading without downloading: `iloc` gives an absolute offset,
    // and a file whose item sits past the window must produce no metadata rather than
    // a wrong one.
    assert.equal(findExifSegment(file.subarray(0, payloadAt)), null);
  });
});
