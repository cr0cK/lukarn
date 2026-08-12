/**
 * Validation of the `Range` header before relaying to Drive.
 *
 * The header is not rewritten — it is forwarded as-is so Google returns the correct
 * fragment directly. Only values that must not propagate are refused: multiple ranges
 * (`multipart/byteranges`, which the proxy cannot reconstruct) and units other than
 * `bytes`.
 *
 * An invalid header is not an error: ignore it and serve the whole file, as RFC 9110
 * explicitly recommends.
 */

export interface ByteRange {
  /** Inclusive start, or `null` for a suffix range (`bytes=-500`). */
  start: number | null;
  /** Inclusive end, or `null` for "to the end". */
  end: number | null;
}

export function parseRange(header: string | undefined | null): ByteRange | null {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  const hasStart = rawStart !== '';
  const hasEnd = rawEnd !== '';

  // `bytes=-` identifies nothing.
  if (!hasStart && !hasEnd) return null;

  const start = hasStart ? Number(rawStart) : null;
  const end = hasEnd ? Number(rawEnd) : null;

  if (start !== null && !Number.isSafeInteger(start)) return null;
  if (end !== null && !Number.isSafeInteger(end)) return null;
  // Reversed range: the client is mistaken, so serve everything.
  if (start !== null && end !== null && end < start) return null;
  // `bytes=-0` requests zero bytes from the end.
  if (start === null && end === 0) return null;

  return { start, end };
}

/** Reconstructs the header to relay in normalised form. */
export function formatRange(range: ByteRange): string {
  const start = range.start === null ? '' : String(range.start);
  const end = range.end === null ? '' : String(range.end);
  return `bytes=${start}-${end}`;
}
