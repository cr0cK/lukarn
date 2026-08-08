import qrcode from 'qrcode-generator';

/** Un QR prêt à être tracé : un `path` SVG, et le côté de sa grille en modules. */
export interface QrCode {
  /** Commandes de tracé, à poser dans un `viewBox="0 0 size size"`. */
  path: string;
  /** Nombre de modules par côté — 21, 25, 29… selon la longueur du texte. */
  size: number;
}

/**
 * Encode un texte en QR et rend un tracé SVG.
 *
 * Un `<path>` inline plutôt qu'une image en `data:` : la CSP de l'application
 * n'autorise `data:` que pour les images inlinées au build, et un tracé se
 * redimensionne sans crénelage sur un écran de télévision.
 *
 * Correction d'erreur `M` — le compromis d'usage : un QR affiché à l'écran ne
 * subit ni pliure ni salissure, mais il est photographié de travers, de loin,
 * et parfois à travers un reflet.
 */
export function qrCode(text: string): QrCode {
  // Type 0 : la bibliothèque choisit la plus petite version qui contient le
  // texte. Une version figée casserait au premier nom de domaine un peu long.
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const size = qr.getModuleCount();
  let path = '';

  for (let row = 0; row < size; row++) {
    let start = -1;
    for (let col = 0; col <= size; col++) {
      // Les modules noirs consécutifs d'une ligne deviennent un seul rectangle.
      // Un rectangle par module donnerait le même dessin pour trois fois plus
      // de commandes, dans un attribut qui traverse le DOM à chaque rendu.
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
