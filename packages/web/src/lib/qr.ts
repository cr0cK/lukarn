import qrcode from 'qrcode-generator';

/** QR code ready to draw: an SVG `path` and its grid side in modules. */
export interface QrCode {
  /** Drawing commands for a `viewBox="0 0 size size"`. */
  path: string;
  /** Modules per side — 21, 25, 29… depending on text length. */
  size: number;
}

/**
 * Encodes text as a QR code and returns an SVG path.
 *
 * Use an inline `<path>` rather than a `data:` image: the application CSP allows
 * `data:` only for images inlined at build time, and a path scales without
 * aliasing on a television screen.
 *
 * `M` error correction — the practical compromise: a QR code displayed on screen
 * is neither folded nor dirty, but is photographed at an angle, from afar and
 * sometimes through glare.
 */
export function qrCode(text: string): QrCode {
  // Type 0: the library chooses the smallest version holding the text. A fixed
  // version would break on the first slightly long domain name.
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const size = qr.getModuleCount();
  let path = '';

  for (let row = 0; row < size; row++) {
    let start = -1;
    for (let col = 0; col <= size; col++) {
      // Merge consecutive dark modules in a row into one rectangle. One rectangle
      // per module would produce the same drawing with three times more commands
      // in an attribute crossing the DOM on every render.
      const dark = col < size && qr.isDark(row, col);
      if (dark && start === -1) start = col;
      if (!dark && start !== -1) {
        const width = col - start;
        path += `M${start} ${row}h${width}v1h-${width}z`;
        start = -1;
      }
    }
  }

  return { path, size };
}
