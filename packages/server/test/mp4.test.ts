import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findMoovOffset, readCreationTime, readVideoCodec } from '../src/drive/mp4.js';

/**
 * Reading an MP4 container header in windows.
 *
 * Buffers are built by hand from forms found in a real 40-video import — `moov`
 * first or after a multi-MB `mdat`, 64-bit sizes, `mvhd` versions 0 and 1, and
 * an old `moov` neutralised as `free` that traps signature scans.
 */

const EPOCH_1904_OFFSET_S = 2_082_844_800;

function secondes1904(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000) + EPOCH_1904_OFFSET_S;
}

/** Ordinary box: 32-bit size followed by the four-letter type. */
function boite(type: string, contenu: Buffer = Buffer.alloc(0)): Buffer {
  const entete = Buffer.alloc(8);
  entete.writeUInt32BE(8 + contenu.length, 0);
  entete.write(type, 4, 'latin1');
  return Buffer.concat([entete, contenu]);
}

/** 64-bit size box: `size == 1`, with the real size after the type. */
function boite64(type: string, contenu: Buffer): Buffer {
  const entete = Buffer.alloc(16);
  entete.writeUInt32BE(1, 0);
  entete.write(type, 4, 'latin1');
  entete.writeBigUInt64BE(BigInt(16 + contenu.length), 8);
  return Buffer.concat([entete, contenu]);
}

/** `mvhd` version 0: 32-bit dates. The rest of the body is irrelevant here. */
function mvhd0(iso: string): Buffer {
  const corps = Buffer.alloc(100);
  corps.writeUInt8(0, 0);
  corps.writeUInt32BE(secondes1904(iso), 4);
  return boite('mvhd', corps);
}

/** `mvhd` version 1: 64-bit dates as written by recent devices. */
function mvhd1(iso: string): Buffer {
  const corps = Buffer.alloc(112);
  corps.writeUInt8(1, 0);
  corps.writeBigUInt64BE(BigInt(secondes1904(iso)), 4);
  return boite('mvhd', corps);
}

function ftyp(): Buffer {
  return boite('ftyp', Buffer.from('isommp42', 'latin1'));
}

/**
 * `hdlr`: version and flags, `pre_defined`, then handler type. It says whether
 * the track carries video (`vide`) or sound (`soun`).
 */
function hdlr(type: string): Buffer {
  const corps = Buffer.alloc(32);
  corps.write(type, 8, 'latin1');
  return boite('hdlr', corps);
}

/**
 * `stsd`: version and flags, entry count, then the first entry — its size and
 * the format's four-letter code.
 */
function stsd(format: string): Buffer {
  const corps = Buffer.alloc(24);
  corps.writeUInt32BE(1, 4);
  corps.writeUInt32BE(16, 8);
  corps.write(format, 12, 'latin1');
  return boite('stsd', corps);
}

/** A complete track as an encoder writes it: `trak/mdia/minf/stbl/stsd`. */
function trak(handler: string, format: string): Buffer {
  const stbl = boite('stbl', stsd(format));
  const minf = boite('minf', Buffer.concat([boite('dinf'), stbl]));
  const mdia = boite('mdia', Buffer.concat([boite('mdhd', Buffer.alloc(24)), hdlr(handler), minf]));
  return boite('trak', Buffer.concat([boite('tkhd', Buffer.alloc(84)), mdia]));
}

/**
 * The traversal used by synchronisation: one window, then the next at the
 * returned boundary. Returns the read date and number of opened windows — this
 * count determines sync cost.
 */
function lireEnTete(
  fichier: Buffer,
  tailleFenetre: number,
  maxFenetres = 4,
): { time: string | null; fenetres: number } {
  let start = 0;

  for (let fenetres = 1; fenetres <= maxFenetres; fenetres++) {
    const fenetre = fichier.subarray(start, Math.min(start + tailleFenetre, fichier.length));
    const { moovOffset, nextOffset } = findMoovOffset(fenetre, start, fichier.length);

    if (moovOffset !== null) {
      const time = readCreationTime(fenetre, moovOffset - start);
      if (time !== null || moovOffset === start) return { time, fenetres };
      start = moovOffset;
      continue;
    }

    if (nextOffset === null) return { time: null, fenetres };
    start = nextOffset;
  }

  return { time: null, fenetres: maxFenetres };
}

describe('findMoovOffset', () => {
  it('finds a leading `moov`', () => {
    const fichier = Buffer.concat([ftyp(), boite('moov', mvhd0('2026-07-29T14:30:12Z'))]);

    const scan = findMoovOffset(fichier, 0, fichier.length);

    assert.equal(scan.moovOffset, 16);
    assert.equal(scan.nextOffset, null);
  });

  it('returns the next boundary when the window ends before `moov`', () => {
    // Common phone recording: `moov` follows a multi-MB `mdat`, outside the first window.
    const mdat = boite('mdat', Buffer.alloc(4096));
    const fichier = Buffer.concat([ftyp(), mdat, boite('moov', mvhd0('2026-07-29T14:30:12Z'))]);
    const fenetre = fichier.subarray(0, 64);

    const scan = findMoovOffset(fenetre, 0, fichier.length);

    assert.equal(scan.moovOffset, null);
    assert.equal(scan.nextOffset, 16 + mdat.length, 'the boundary is the end of `mdat`');
  });

  it('follows a 64-bit size', () => {
    // Above 4 GB, and by convention in some encoders: the real size follows the
    // type and the header is 16 bytes.
    const mdat = boite64('mdat', Buffer.alloc(64));
    const fichier = Buffer.concat([ftyp(), mdat, boite('moov', mvhd0('2026-08-05T09:00:00Z'))]);

    const scan = findMoovOffset(fichier, 0, fichier.length);

    assert.equal(scan.moovOffset, 16 + mdat.length);
  });

  it('reports no boundary after a box that runs to the end', () => {
    // `size == 0`: the box takes the rest of the file. Continuing would reread
    // the same offset indefinitely.
    const entete = Buffer.alloc(8);
    entete.writeUInt32BE(0, 0);
    entete.write('mdat', 4, 'latin1');
    const fichier = Buffer.concat([ftyp(), entete, Buffer.alloc(1024)]);

    const scan = findMoovOffset(fichier, 0, fichier.length);

    assert.deepEqual(scan, { moovOffset: null, nextOffset: null });
  });

  it('gives up on bytes that are not boxes', () => {
    // A container that cannot be opened must not produce a date: traversal will
    // fall back to the filename.
    const bruit = Buffer.alloc(256);
    for (let i = 0; i < bruit.length; i++) bruit[i] = (i * 37 + 11) % 256;

    assert.deepEqual(findMoovOffset(bruit, 0, bruit.length), {
      moovOffset: null,
      nextOffset: null,
    });
  });
});

describe('readCreationTime', () => {
  it('reads a version 0 `mvhd`', () => {
    const fichier = Buffer.concat([ftyp(), boite('moov', mvhd0('2026-07-29T14:30:12Z'))]);

    assert.equal(readCreationTime(fichier, 16), '2026-07-29T14:30:12.000Z');
  });

  it('reads a version 1 `mvhd` with 64-bit dates', () => {
    const fichier = Buffer.concat([ftyp(), boite('moov', mvhd1('2026-08-05T09:15:44Z'))]);

    assert.equal(readCreationTime(fichier, 16), '2026-08-05T09:15:44.000Z');
  });

  it('ignores an orphaned `mvhd` left in a `free` box', () => {
    // Thirteen imported files had this defect: an old `moov` neutralised as
    // `free`, whose `mvhd` retains a stale date. A signature scan would use it.
    const perime = Buffer.concat([mvhd0('2019-01-01T00:00:00Z'), boite('trak', Buffer.alloc(32))]);
    const fichier = Buffer.concat([
      ftyp(),
      boite('free', perime),
      boite('moov', mvhd0('2026-07-29T14:30:12Z')),
    ]);

    const scan = findMoovOffset(fichier, 0, fichier.length);
    assert.notEqual(scan.moovOffset, null);
    assert.equal(readCreationTime(fichier, scan.moovOffset!), '2026-07-29T14:30:12.000Z');
  });

  it('infers nothing from a `moov` cut by the window', () => {
    const fichier = Buffer.concat([ftyp(), boite('moov', mvhd0('2026-07-29T14:30:12Z'))]);
    // The window stops midway through `mvhd`: the date is incomplete.
    const tronque = fichier.subarray(0, 30);

    assert.equal(readCreationTime(tronque, 16), null);
  });

  it('treats an unset clock as absent', () => {
    const corps = Buffer.alloc(100);
    const fichier = Buffer.concat([ftyp(), boite('moov', boite('mvhd', corps))]);

    assert.equal(readCreationTime(fichier, 16), null);
  });

  it('discards a date nothing could have recorded', () => {
    // Some muxers write seconds since 1970 here, producing a 1950s date: better
    // to return nothing.
    const corps = Buffer.alloc(100);
    corps.writeUInt32BE(Math.floor(Date.parse('2026-07-29T14:30:12Z') / 1000), 4);
    const fichier = Buffer.concat([ftyp(), boite('moov', boite('mvhd', corps))]);

    assert.equal(readCreationTime(fichier, 16), null);
  });
});

describe('readVideoCodec', () => {
  it('reads the video-track codec after the audio track', () => {
    // Common phone recording order. Taking the first `stsd` would return `mp4a`
    // — an audio codec — and transcode every video, including playable ones.
    const fichier = Buffer.concat([
      ftyp(),
      boite(
        'moov',
        Buffer.concat([mvhd0('2026-07-29T14:30:12Z'), trak('soun', 'mp4a'), trak('vide', 'hvc1')]),
      ),
    ]);

    assert.equal(readVideoCodec(fichier, 16), 'hvc1');
  });

  it('recognises both HEVC spellings and H.264', () => {
    // `hvc1` and `hev1` denote the same codec with different parameter storage:
    // both are unreadable wherever either is.
    for (const format of ['hvc1', 'hev1', 'avc1']) {
      const fichier = Buffer.concat([
        ftyp(),
        boite('moov', Buffer.concat([mvhd0('2026-07-29T14:30:12Z'), trak('vide', format)])),
      ]);

      assert.equal(readVideoCodec(fichier, 16), format);
    }
  });

  it('infers nothing when `stsd` extends beyond the window', () => {
    const fichier = Buffer.concat([
      ftyp(),
      boite('moov', Buffer.concat([mvhd0('2026-07-29T14:30:12Z'), trak('vide', 'hvc1')])),
    ]);
    // The window stops ten bytes before the end: `stsd` is incomplete, and
    // returning nothing is better than reading absent bytes.
    const tronque = fichier.subarray(0, fichier.length - 10);

    assert.equal(readVideoCodec(tronque, 16), null);
  });

  it('returns `null` for a `moov` without a video track', () => {
    // A misclassified audio recording or differently described video track:
    // the column records "examined, nothing found".
    const fichier = Buffer.concat([
      ftyp(),
      boite('moov', Buffer.concat([mvhd0('2026-07-29T14:30:12Z'), trak('soun', 'mp4a')])),
    ]);

    assert.equal(readVideoCodec(fichier, 16), null);
  });

  it('does not read a `trak` left in a `free` box', () => {
    // The same trap as `readCreationTime`: a neutralised old `moov` still holds
    // its tracks, whose codec may no longer match the file.
    const perime = boite('free', trak('vide', 'avc1'));
    const fichier = Buffer.concat([
      ftyp(),
      perime,
      boite('moov', Buffer.concat([mvhd0('2026-07-29T14:30:12Z'), trak('vide', 'hvc1')])),
    ]);

    const scan = findMoovOffset(fichier, 0, fichier.length);
    assert.equal(readVideoCodec(fichier, scan.moovOffset!), 'hvc1');
  });
});

describe('windowed traversal', () => {
  it('reaches a distant `moov` in two windows', () => {
    const fichier = Buffer.concat([
      ftyp(),
      boite('mdat', Buffer.alloc(200_000)),
      boite('moov', mvhd0('2026-07-29T14:30:12Z')),
    ]);

    assert.deepEqual(lireEnTete(fichier, 64 * 1024), {
      time: '2026-07-29T14:30:12.000Z',
      fenetres: 2,
    });
  });

  it('reopens a window on a `moov` not fully contained in the previous one', () => {
    // `moov` starts twenty bytes before the window ends: its header fits but
    // `mvhd` does not. The date must not be inferred from the remainder.
    const fichier = Buffer.concat([
      ftyp(),
      boite('mdat', Buffer.alloc(1000)),
      boite('moov', mvhd0('2026-08-05T09:15:44Z')),
    ]);

    assert.deepEqual(lireEnTete(fichier, 1044), {
      time: '2026-08-05T09:15:44.000Z',
      fenetres: 2,
    });
  });

  it('returns `null` for a file without `moov`', () => {
    const fichier = Buffer.concat([ftyp(), boite('mdat', Buffer.alloc(512)), boite('free')]);

    assert.equal(lireEnTete(fichier, 64).time, null);
  });
});
