/**
 * Finding the EXIF block in the first bytes of a photograph.
 *
 * Drive returns capture date, camera and position in the listing itself, which is what
 * lets an album of several thousand photographs be indexed without downloading a byte
 * (D3). No other backend does: a folder, a bucket and a WebDAV server hand over files,
 * and the metadata has to be read out of them.
 *
 * Reading it need not cost the file. EXIF lives at the **front** of both formats that
 * carry it — a JPEG's `APP1` segment is the second thing in the file, and a HEIC's
 * `meta` box precedes the image data — so one ranged window covers it, exactly as
 * `mp4.ts` covers a video header. That is what keeps "index without downloading"
 * true for every backend rather than only for Drive.
 *
 * Everything here is pure: the caller provides the window, and nothing reaches the
 * network. The functions answer `null` rather than throwing, because a file with no
 * EXIF at all — a screenshot, a re-encoded photograph — is the ordinary case and not
 * an error.
 */
import { readBoxHeader } from './mp4.js';

/** JPEG start of image. */
const SOI = 0xffd8;
/** `APP1`, the marker whose payload begins with `Exif\0\0`. */
const APP1 = 0xffe1;
/** Start of scan: image data begins and no metadata segment follows. */
const SOS = 0xffda;

/** `Exif\0\0`, the six bytes that open an EXIF `APP1` payload. */
const EXIF_HEADER = Buffer.from('Exif\0\0', 'latin1');

/**
 * Largest EXIF block accepted.
 *
 * A JPEG segment cannot exceed 64 KB by construction, and a HEIC `iloc` extent is
 * declared by the file itself — a corrupt or hostile one may declare anything, and this
 * is what stops a listing from allocating it.
 */
const MAX_EXIF_BYTES = 256 * 1024;

/**
 * The EXIF block of a photograph, ready for a TIFF reader, or `null`.
 *
 * `buffer` is a window starting at **file offset 0**. `null` means one of: not a format
 * that carries EXIF, no EXIF in the file, or the block sits beyond the window — the
 * three are indistinguishable to the caller and lead to the same fallback, the file's
 * modification date.
 */
export function findExifSegment(buffer: Buffer): Buffer | null {
  if (buffer.length >= 2 && buffer.readUInt16BE(0) === SOI) return fromJpeg(buffer);
  return fromIsobmff(buffer);
}

/**
 * JPEG: walk the marker chain from the start of image to the first `APP1` carrying
 * `Exif\0\0`.
 *
 * The chain is followed rather than the bytes scanned, for the reason spelled out in
 * `mp4.ts`: a thumbnail embedded inside the EXIF block is itself a JPEG with its own
 * markers, and a scan finds its segments as readily as the real ones.
 */
function fromJpeg(buffer: Buffer): Buffer | null {
  let cursor = 2;

  while (cursor + 4 <= buffer.length) {
    // Markers may be padded with any number of 0xFF bytes before the identifying one.
    if (buffer[cursor] !== 0xff) return null;
    let identifier = cursor + 1;
    while (identifier < buffer.length && buffer[identifier] === 0xff) identifier++;
    if (identifier + 2 >= buffer.length) return null;

    const marker = 0xff00 | buffer[identifier]!;
    // Standalone markers carry no length; the only ones that can appear here are the
    // restart markers and `SOI` itself, none of which precede `APP1` in practice.
    if (marker === SOS) return null;

    const length = buffer.readUInt16BE(identifier + 1);
    // The length includes its own two bytes; anything below that would not advance.
    if (length < 2) return null;

    const start = identifier + 3;
    const end = identifier + 1 + length;

    if (marker === APP1 && buffer.subarray(start, start + 6).equals(EXIF_HEADER)) {
      // Bounded by the window: a segment declaring more than arrived is returned as
      // what did arrive, and the TIFF reader stops where the data stops.
      return buffer.subarray(start, Math.min(end, buffer.length));
    }

    cursor = end;
  }

  return null;
}

/**
 * HEIC and its relatives: `meta` → `iinf` names the item of type `Exif`, `iloc` says
 * where it is.
 *
 * The indirection exists because a HEIC is a container of items rather than an image
 * with headers: the EXIF block is stored like any other item, addressed by an
 * identifier that only `iinf` maps to a type.
 */
function fromIsobmff(buffer: Buffer): Buffer | null {
  const meta = topLevel(buffer, 'meta');
  if (meta === null) return null;

  // `meta` is a FullBox: four bytes of version and flags sit between its header and its
  // children. Reading straight on from the header would take those four bytes for a box
  // size and find nothing — the one difference from the traversal in `mp4.ts`.
  const inner = meta + boxHeaderSize(buffer, meta) + 4;

  const iinf = childFrom(buffer, inner, meta, 'iinf');
  const iloc = childFrom(buffer, inner, meta, 'iloc');
  if (iinf === null || iloc === null) return null;

  const itemId = exifItemId(buffer, iinf);
  if (itemId === null) return null;

  const extent = itemExtent(buffer, iloc, itemId);
  if (extent === null) return null;

  return tiffFrom(buffer, extent.offset, extent.length);
}

/** Offset of a top-level box of this type, or `null`. */
function topLevel(buffer: Buffer, type: string): number | null {
  let cursor = 0;

  while (cursor < buffer.length) {
    const header = readBoxHeader(buffer, cursor);
    if (header.kind !== 'box') return null;
    if (header.type === type) return cursor;

    const size = header.size === 0 ? buffer.length - cursor : header.size;
    if (size < header.headerSize) return null;
    cursor += size;
  }

  return null;
}

function boxHeaderSize(buffer: Buffer, offset: number): number {
  const header = readBoxHeader(buffer, offset);
  return header.kind === 'box' ? header.headerSize : 8;
}

/** A named child of a container, searched from `start` and bounded by its declared end. */
function childFrom(buffer: Buffer, start: number, container: number, type: string): number | null {
  const header = readBoxHeader(buffer, container);
  if (header.kind !== 'box') return null;
  const end = Math.min(header.size === 0 ? buffer.length : container + header.size, buffer.length);

  let cursor = start;
  while (cursor < end) {
    const box = readBoxHeader(buffer, cursor);
    if (box.kind !== 'box') return null;
    if (box.type === type) return cursor;

    const size = box.size === 0 ? end - cursor : box.size;
    if (size < box.headerSize) return null;
    cursor += size;
  }

  return null;
}

/**
 * Identifier of the item whose type is `Exif`, read from the `infe` entries of `iinf`.
 *
 * Version 2 writes the identifier on two bytes and version 3 on four; both are in use,
 * and taking the wrong width finds an item that does not exist.
 */
function exifItemId(buffer: Buffer, iinf: number): number | null {
  const header = readBoxHeader(buffer, iinf);
  if (header.kind !== 'box') return null;

  const version = buffer[iinf + header.headerSize];
  if (version === undefined) return null;
  // Entry count: two bytes in version 0, four from version 1.
  const countSize = version === 0 ? 2 : 4;
  const entries = iinf + header.headerSize + 4 + countSize;

  for (const entry of childrenBetween(buffer, entries, boxEnd(buffer, iinf))) {
    if (entry.type !== 'infe') continue;

    const infeVersion = buffer[entry.start];
    if (infeVersion === undefined) return null;

    const idSize = infeVersion >= 3 ? 4 : 2;
    // version and flags (4), item id, protection index (2), then the four-character type
    const typeAt = entry.start + 4 + idSize + 2;
    if (typeAt + 4 > entry.end) continue;
    if (buffer.toString('latin1', typeAt, typeAt + 4) !== 'Exif') continue;

    const idAt = entry.start + 4;
    return idSize === 4 ? buffer.readUInt32BE(idAt) : buffer.readUInt16BE(idAt);
  }

  return null;
}

/** Boxes between two offsets, without a parent header to start from. */
function* childrenBetween(
  buffer: Buffer,
  start: number,
  end: number,
): Generator<{ type: string; start: number; end: number }> {
  let cursor = start;

  while (cursor < end) {
    const box = readBoxHeader(buffer, cursor);
    if (box.kind !== 'box') return;

    const size = box.size === 0 ? end - cursor : box.size;
    if (size < box.headerSize) return;

    yield {
      type: box.type,
      start: cursor + box.headerSize,
      end: Math.min(cursor + size, end),
    };
    cursor += size;
  }
}

function boxEnd(buffer: Buffer, offset: number): number {
  const header = readBoxHeader(buffer, offset);
  if (header.kind !== 'box') return buffer.length;
  return Math.min(header.size === 0 ? buffer.length : offset + header.size, buffer.length);
}

/**
 * Where an item's bytes are, from `iloc`.
 *
 * The field widths are declared in the box itself — four nibbles giving the size of an
 * offset, a length, a base offset and, from version 1, an index — so nothing here can
 * be read at a fixed position. Only the first extent of the wanted item is used: an
 * EXIF block split across several is legal and has never been observed, and following
 * the rest would mean stitching ranges for no gain.
 */
function itemExtent(
  buffer: Buffer,
  iloc: number,
  itemId: number,
): { offset: number; length: number } | null {
  const header = readBoxHeader(buffer, iloc);
  if (header.kind !== 'box') return null;

  let cursor = iloc + header.headerSize;
  const version = buffer[cursor];
  if (version === undefined || version > 2) return null;
  cursor += 4;

  const sizes = buffer[cursor];
  const more = buffer[cursor + 1];
  if (sizes === undefined || more === undefined) return null;
  const offsetSize = sizes >> 4;
  const lengthSize = sizes & 0x0f;
  const baseOffsetSize = more >> 4;
  const indexSize = version >= 1 ? more & 0x0f : 0;
  cursor += 2;

  const idSize = version < 2 ? 2 : 4;
  const count = version < 2 ? readUInt(buffer, cursor, 2) : (readUInt(buffer, cursor, 4) ?? null);
  if (count === null) return null;
  cursor += version < 2 ? 2 : 4;

  for (let index = 0; index < count; index++) {
    const id = readUInt(buffer, cursor, idSize);
    if (id === null) return null;
    cursor += idSize;

    // Versions 1 and 2 carry a construction method in the low nibble of a reserved
    // 16-bit field. Only method 0 — an offset into this file — is resolvable from a
    // window; the others address another item or an external file.
    let constructionMethod = 0;
    if (version >= 1) {
      const method = readUInt(buffer, cursor, 2);
      if (method === null) return null;
      constructionMethod = method & 0x0f;
      cursor += 2;
    }

    cursor += 2; // data reference index
    const baseOffset = readUInt(buffer, cursor, baseOffsetSize);
    if (baseOffset === null) return null;
    cursor += baseOffsetSize;

    const extents = readUInt(buffer, cursor, 2);
    if (extents === null) return null;
    cursor += 2;

    let found: { offset: number; length: number } | null = null;
    for (let extent = 0; extent < extents; extent++) {
      cursor += indexSize;
      const offset = readUInt(buffer, cursor, offsetSize);
      cursor += offsetSize;
      const length = readUInt(buffer, cursor, lengthSize);
      cursor += lengthSize;

      if (offset === null || length === null) return null;
      if (id === itemId && found === null && constructionMethod === 0) {
        found = { offset: baseOffset + offset, length };
      }
    }
    if (found) return found;
  }

  return null;
}

/** Big-endian unsigned integer of the given width. `0` bytes reads as `0`, per the box format. */
function readUInt(buffer: Buffer, offset: number, bytes: number): number | null {
  if (bytes === 0) return 0;
  if (bytes > 8 || offset + bytes > buffer.length) return null;

  let value = 0n;
  for (let index = 0; index < bytes; index++) {
    value = (value << 8n) | BigInt(buffer[offset + index]!);
  }
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
}

/**
 * The EXIF block at an `iloc` extent.
 *
 * An item's payload opens with a four-byte count of the bytes to skip before the TIFF
 * header — usually six, for a `Exif\0\0` that some writers include and others do not.
 * Both are accepted: the declared skip is tried first, and the opening bytes are
 * checked to be a TIFF byte-order mark before the block is trusted.
 */
function tiffFrom(buffer: Buffer, offset: number, length: number): Buffer | null {
  if (length <= 4 || length > MAX_EXIF_BYTES) return null;
  if (offset + 4 > buffer.length) return null;

  const skip = buffer.readUInt32BE(offset);
  const end = Math.min(offset + length, buffer.length);

  for (const start of [offset + 4 + skip, offset + 4]) {
    if (start + 4 > end) continue;
    const mark = buffer.toString('latin1', start, start + 2);
    if (mark === 'MM' || mark === 'II') return buffer.subarray(start, end);
    // Some writers keep the JPEG-style header inside the item as well.
    if (buffer.subarray(start, start + 6).equals(EXIF_HEADER)) return buffer.subarray(start, end);
  }

  return null;
}
