/**
 * Validation du header `Range` avant relais vers Drive.
 *
 * Le header n'est pas réécrit — il est transmis tel quel pour que Google
 * réponde directement le bon fragment. On refuse simplement ce qu'on ne veut
 * pas propager : les plages multiples (réponse `multipart/byteranges`, que le
 * proxy ne sait pas recomposer) et les unités autres que `bytes`.
 *
 * Un header invalide n'est pas une erreur : on l'ignore et on sert le fichier
 * entier, ce que la RFC 9110 recommande explicitement.
 */

export interface ByteRange {
  /** Début inclusif, ou `null` pour une plage suffixe (`bytes=-500`). */
  start: number | null;
  /** Fin inclusive, ou `null` pour « jusqu'à la fin ». */
  end: number | null;
}

export function parseRange(header: string | undefined | null): ByteRange | null {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  const hasStart = rawStart !== '';
  const hasEnd = rawEnd !== '';

  // `bytes=-` ne désigne rien.
  if (!hasStart && !hasEnd) return null;

  const start = hasStart ? Number(rawStart) : null;
  const end = hasEnd ? Number(rawEnd) : null;

  if (start !== null && !Number.isSafeInteger(start)) return null;
  if (end !== null && !Number.isSafeInteger(end)) return null;
  // Plage à l'envers : le client s'est trompé, on sert tout.
  if (start !== null && end !== null && end < start) return null;
  // `bytes=-0` demande zéro octet depuis la fin.
  if (start === null && end === 0) return null;

  return { start, end };
}

/** Reconstruit le header à relayer, sous forme normalisée. */
export function formatRange(range: ByteRange): string {
  const start = range.start === null ? '' : String(range.start);
  const end = range.end === null ? '' : String(range.end);
  return `bytes=${start}-${end}`;
}
