/**
 * Windowed reading of an MP4/QuickTime container header.
 *
 * An ISOBMFF file is a sequence of boxes prefixed by their size. Recording time lives
 * in `moov/mvhd`, but `moov` is not always first: a phone recording often places it
 * after `mdat`, tens of megabytes from the beginning. The file is therefore not
 * downloaded; follow the size chain from offset 0 to obtain successive boundaries
 * and reopen a `Range` window at each one.
 *
 * **This traversal is the only safe boundary.** Scanning bytes for the `moov`
 * signature fails in practice: a resaved file carries an old `moov` neutralised as
 * `free` that still contains a complete `mvhd` — the signature then finds a stale
 * date, sometimes months old, without any indication.
 *
 * All three functions are pure: no network access, and callers provide the buffers.
 * This makes them testable against hand-built cases.
 */

/**
 * Difference between the QuickTime epoch (1 January 1904 UTC) and the Unix epoch in
 * seconds. `mvhd` dates are counted from the former.
 */
const EPOCH_1904_OFFSET_S = 2_082_844_800;

/**
 * A date before this one is treated as absent. Some muxers write seconds since 1970
 * into this field, producing dates in the 1950s–1980s: rather than date the video half
 * a century too early, let the caller fall back to the file name.
 */
const MIN_YEAR = 1990;
const MAX_YEAR = 2200;

/** What a window reveals about the location of `moov`. */
export interface MoovScan {
  /** Absolute offset of the `moov` box if the window reached it. */
  moovOffset: number | null;
  /**
   * Absolute offset of the next box boundary when the window ends before `moov`: this
   * is where reading must resume. `null` when nothing remains — end of file reached
   * or an inconsistent box chain.
   */
  nextOffset: number | null;
}

export type BoxHeader =
  | {
      kind: 'box';
      /** Total size including the header. `0` means "to the end". */
      size: number;
      type: string;
      /** 8 bytes, or 16 when size is written in 64 bits. */
      headerSize: number;
    }
  /** The header exceeds the buffer, so a window must start here. */
  | { kind: 'truncated' }
  /** These are not boxes: an unusual container or arbitrary bytes. */
  | { kind: 'invalid' };

/** A box type consists of four printable ASCII characters. */
function isBoxType(type: string): boolean {
  return /^[\x20-\x7e]{4}$/.test(type);
}

/**
 * Exported because HEIC is the same container: `sync/exif.ts` walks `meta`, `iinf` and
 * `iloc` from here, and a second reading of the size field would be a second place for
 * the 64-bit form and the truncated window to be got wrong.
 */
export function readBoxHeader(buffer: Buffer, offset: number): BoxHeader {
  if (offset < 0 || offset + 8 > buffer.length) return { kind: 'truncated' };

  const short = buffer.readUInt32BE(offset);
  const type = buffer.toString('latin1', offset + 4, offset + 8);
  if (!isBoxType(type)) return { kind: 'invalid' };

  if (short !== 1) {
    // A box shorter than its header leads nowhere; traversing it would loop in place.
    if (short !== 0 && short < 8) return { kind: 'invalid' };
    return { kind: 'box', size: short, type, headerSize: 8 };
  }

  if (offset + 16 > buffer.length) return { kind: 'truncated' };
  const wide = buffer.readBigUInt64BE(offset + 8);
  if (wide < 16n || wide > BigInt(Number.MAX_SAFE_INTEGER)) return { kind: 'invalid' };
  return { kind: 'box', size: Number(wide), type, headerSize: 16 };
}

/**
 * Finds `moov` in a file window by following the top-level box chain.
 *
 * `buffer` starts **exactly** on a box boundary at file offset `windowStart` — offset
 * 0 or the value returned by a previous call. Supplying an arbitrary offset would
 * read random sizes.
 */
export function findMoovOffset(buffer: Buffer, windowStart: number, fileSize: number): MoovScan {
  let offset = 0;

  for (;;) {
    const header = readBoxHeader(buffer, offset);

    if (header.kind === 'invalid') return { moovOffset: null, nextOffset: null };

    if (header.kind === 'truncated') {
      const next = windowStart + offset;
      return { moovOffset: null, nextOffset: next < fileSize ? next : null };
    }

    if (header.type === 'moov') return { moovOffset: windowStart + offset, nextOffset: null };

    // `size == 0`: the box runs to the end of the file, with no boundary after it.
    const size = header.size === 0 ? fileSize - (windowStart + offset) : header.size;
    if (size < header.headerSize) return { moovOffset: null, nextOffset: null };

    const next = windowStart + offset + size;
    // Nothing follows this box: either it ends the file or exceeds it and the read
    // size was invalid. In both cases there is no `moov` to find.
    if (next >= fileSize) return { moovOffset: null, nextOffset: null };

    offset += size;
  }
}

/**
 * Recording date from `moov/mvhd` in ISO 8601 UTC, or `null` if the buffer does not
 * reach it, the clock was unset, or the value cannot be a capture date.
 *
 * `moovOffset` is the box index **within the buffer**, not the file:
 * `findMoovOffset` returns an absolute offset that must be adjusted to the window
 * start before calling this function.
 *
 * The read time is not always UTC. Phones may write local or universal time, and the
 * container does not identify which; this function returns what is written without
 * correction.
 */
export function readCreationTime(buffer: Buffer, moovOffset: number): string | null {
  const moov = readBoxHeader(buffer, moovOffset);
  if (moov.kind !== 'box' || moov.type !== 'moov') return null;

  for (const child of children(buffer, moovOffset)) {
    if (child.type === 'mvhd') return readMvhd(buffer, child.start, child.end);
  }

  return null;
}

/** A child box located in the buffer. */
interface Box {
  type: string;
  /** Header offset — this is what gets passed back to `children`. */
  offset: number;
  /** First content byte, excluding the header. */
  start: number;
  /** First byte after the box, bounded by the buffer. */
  end: number;
}

/**
 * Child boxes of a container in file order.
 *
 * `offset` identifies the container **header**. Traversal stops at the end of the
 * container or buffer: a window may cut through a box, and reading beyond would
 * interpret bytes that are not present. It also stops at the first inconsistent child —
 * a size shorter than its header would loop in place.
 */
function* children(buffer: Buffer, offset: number): Generator<Box> {
  const box = readBoxHeader(buffer, offset);
  if (box.kind !== 'box') return;

  const declaredEnd = box.size === 0 ? buffer.length : offset + box.size;
  const end = Math.min(declaredEnd, buffer.length);

  let cursor = offset + box.headerSize;
  while (cursor < end) {
    const child = readBoxHeader(buffer, cursor);
    if (child.kind !== 'box') return;

    const size = child.size === 0 ? end - cursor : child.size;
    if (size < child.headerSize) return;

    yield {
      type: child.type,
      offset: cursor,
      start: cursor + child.headerSize,
      end: Math.min(cursor + size, end),
    };
    cursor += size;
  }
}

/** First child of this type, or `null`. */
function child(buffer: Buffer, offset: number, type: string): Box | null {
  for (const box of children(buffer, offset)) {
    if (box.type === type) return box;
  }
  return null;
}

/**
 * Four-letter video-track codec — `avc1`, `hvc1`, `hev1` — or `null` if the buffer
 * does not reach `stsd`, `moov` carries no video track, or the value is not a box type.
 *
 * `moovOffset` is the box index **within the buffer**, as for `readCreationTime`.
 *
 * Traversal is `moov → trak → mdia → minf → stbl → stsd`, and the track is selected
 * by its `hdlr`: a phone video has at least one audio track, often before the video,
 * and sometimes metadata tracks. Taking the first `stsd` would return `mp4a` for half
 * the files.
 */
export function readVideoCodec(buffer: Buffer, moovOffset: number): string | null {
  const moov = readBoxHeader(buffer, moovOffset);
  if (moov.kind !== 'box' || moov.type !== 'moov') return null;

  for (const trak of children(buffer, moovOffset)) {
    if (trak.type !== 'trak') continue;

    const mdia = child(buffer, trak.offset, 'mdia');
    if (!mdia) continue;

    // `hdlr`: version and flags (4 bytes), `pre_defined` (4), then handler type —
    // `vide` for video, `soun` for audio.
    const hdlr = child(buffer, mdia.offset, 'hdlr');
    if (!hdlr || hdlr.start + 12 > hdlr.end) continue;
    if (buffer.toString('latin1', hdlr.start + 8, hdlr.start + 12) !== 'vide') continue;

    const minf = child(buffer, mdia.offset, 'minf');
    const stbl = minf && child(buffer, minf.offset, 'stbl');
    const stsd = stbl && child(buffer, stbl.offset, 'stsd');
    // `stsd`: version and flags (4), entry count (4), then the first entry — its size
    // (4) and format code (4).
    if (!stsd || stsd.start + 16 > stsd.end) return null;

    const format = buffer.toString('latin1', stsd.start + 12, stsd.start + 16);
    return isBoxType(format) ? format : null;
  }

  return null;
}

/** Body of an `mvhd`, versions 0 (32-bit dates) and 1 (64-bit dates). */
function readMvhd(buffer: Buffer, offset: number, end: number): string | null {
  if (offset + 4 > end) return null;
  const version = buffer[offset]!;

  let seconds: number;
  if (version === 0) {
    if (offset + 8 > end) return null;
    seconds = buffer.readUInt32BE(offset + 4);
  } else if (version === 1) {
    if (offset + 12 > end) return null;
    const wide = buffer.readBigUInt64BE(offset + 4);
    if (wide > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    seconds = Number(wide);
  } else {
    return null;
  }

  // Zero means the field was never set, not 1 January 1904.
  if (seconds === 0) return null;

  const date = new Date((seconds - EPOCH_1904_OFFSET_S) * 1000);
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getUTCFullYear();
  if (year < MIN_YEAR || year > MAX_YEAR) return null;

  return date.toISOString();
}
