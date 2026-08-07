/**
 * Échelles de zoom de la visionneuse.
 *
 * Le calcul est isolé ici parce qu'une erreur y est invisible à l'œil : une
 * échelle fausse de 40 % ressemble à une image un peu molle, pas à un bug. Le
 * point délicat est que la photo affichée n'est jamais le fichier d'origine
 * mais un rendu WebP dont le serveur plafonne le plus grand côté — le nombre de
 * pixels réellement disponibles ne se déduit donc pas des dimensions de l'index.
 */

/**
 * Plafond du plus grand côté du rendu `hd`, en miroir de `HD_MAX_EDGE`
 * (`packages/server/src/media/renderer.ts`).
 *
 * Il n'y est que pour anticiper : la variante `hd` n'est chargée qu'au premier
 * agrandissement, et il faut savoir avant ce chargement jusqu'où le zoom pourra
 * aller. Dès que le rendu est là, c'est sa mesure qui fait autorité — une
 * divergence avec le serveur se corrige donc d'elle-même à l'affichage.
 */
export const HD_MAX_EDGE = 4096;

export interface ZoomScaleInput {
  /** Largeur du fichier d'origine d'après l'index, `0` si inconnue. */
  sourceWidth: number;
  /** Hauteur du fichier d'origine d'après l'index, `0` si inconnue. */
  sourceHeight: number;
  /** `naturalWidth` du rendu effectivement chargé, `0` avant le premier chargement. */
  renderedWidth: number;
  /** Vrai quand le rendu mesuré est la variante `hd` : la mesure fait alors autorité. */
  hdLoaded: boolean;
  /** Largeur de l'image une fois ajustée au cadre, en pixels CSS. */
  displayedWidth: number;
  /** Plafond de zoom du composant. */
  maxScale: number;
}

export interface ZoomScale {
  /** Pixels réellement disponibles sur la largeur, une fois le rendu `hd` en place. */
  availableWidth: number;
  /**
   * Échelle à laquelle un pixel disponible occupe un pixel d'écran : c'est le
   * « 100 % » de l'indicateur, et la cible de la touche `z` et du clic.
   */
  pixelScale: number;
  /** Vrai quand le rendu disponible contient moins de pixels que le fichier d'origine. */
  limited: boolean;
}

/**
 * Résolution du rendu `hd` telle que le serveur la produira : le plus grand
 * côté est ramené à `HD_MAX_EDGE`, et `withoutEnlargement` interdit d'agrandir
 * une photo plus petite.
 */
function hdWidthFor(sourceWidth: number, sourceHeight: number): number {
  const longest = Math.max(sourceWidth, sourceHeight);
  if (longest <= HD_MAX_EDGE) return sourceWidth;
  return Math.round((sourceWidth * HD_MAX_EDGE) / longest);
}

/**
 * Échelles de zoom d'après la résolution réellement disponible, et non d'après
 * les dimensions du fichier d'origine.
 *
 * Une photo de 6000 px n'est servie qu'en 4096 px : caler le « 100 % » sur
 * 6000 px reviendrait à annoncer des pixels natifs en interpolant un pixel sur
 * trois. Ici, 100 % signifie « un pixel du rendu par pixel d'écran », donc la
 * limite au-delà de laquelle le navigateur invente ; `limited` dit si cette
 * limite est en deçà du fichier d'origine, pour que l'interface puisse
 * l'annoncer plutôt que le cacher.
 */
export function computeZoomScale({
  sourceWidth,
  sourceHeight,
  renderedWidth,
  hdLoaded,
  displayedWidth,
  maxScale,
}: ZoomScaleInput): ZoomScale {
  const available =
    hdLoaded && renderedWidth > 0
      ? renderedWidth
      : sourceWidth > 0 && sourceHeight > 0
        ? hdWidthFor(sourceWidth, sourceHeight)
        : // Index sans dimensions : le rendu déjà reçu est tout ce qu'on sait.
          // Le zoom part plus bas, puis se corrige quand `hd` est mesuré.
          renderedWidth;

  if (available <= 0 || displayedWidth <= 0) {
    return { availableWidth: 0, pixelScale: 1, limited: false };
  }

  return {
    availableWidth: available,
    pixelScale: Math.min(maxScale, Math.max(1, available / displayedWidth)),
    limited: sourceWidth > available,
  };
}

/**
 * Pourcentage affiché : part des pixels disponibles réellement peints à
 * l'écran. 100 % = un pixel du rendu par pixel d'écran, au-delà le navigateur
 * interpole.
 *
 * Il se calcule à partir de `availableWidth` et non de `pixelScale`, qui est
 * plafonné par `maxScale` : sur une photo qui demanderait plus que ce plafond,
 * rapporter l'échelle à `pixelScale` afficherait 100 % là où le zoom maximal ne
 * montre encore qu'une partie des pixels.
 */
export function zoomPercent(displayedWidth: number, scale: number, availableWidth: number): number {
  if (availableWidth <= 0 || displayedWidth <= 0) return 100;
  return Math.round(((displayedWidth * scale) / availableWidth) * 100);
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Part de l'image occupée par la zone visible, sur chaque axe, dans `[0, 1]`.
 *
 * Sert au cadre du repère de position : `1` signifie que l'image tient
 * entièrement dans la fenêtre sur cet axe — le cadre couvre alors tout le
 * repère, ce qui est la lecture juste.
 */
export function visibleFraction(
  displayedSize: number,
  containerSize: number,
  scale: number,
): number {
  if (displayedSize <= 0 || scale <= 0) return 1;
  return Math.min(1, containerSize / (displayedSize * scale));
}

/**
 * Position du centre de la zone visible dans l'image, en fractions `[0, 1]`.
 *
 * Le déplacement décale l'image sous une fenêtre fixe : la zone regardée se
 * déplace donc en sens inverse, d'où le signe négatif.
 */
export function viewCenter(
  offset: Point,
  displayed: { width: number; height: number },
  scale: number,
): Point {
  return {
    x: displayed.width > 0 ? 0.5 - offset.x / (displayed.width * scale) : 0.5,
    y: displayed.height > 0 ? 0.5 - offset.y / (displayed.height * scale) : 0.5,
  };
}

/**
 * Réciproque de `viewCenter` : déplacement à appliquer pour amener un point de
 * l'image au centre de la fenêtre.
 *
 * C'est ce qui rend le repère de position manipulable — cliquer dedans désigne
 * un endroit de la photo, et l'affichage doit s'y rendre. Le résultat n'est pas
 * borné ici : c'est à l'appelant d'appliquer ses limites de débordement, qu'il
 * est le seul à connaître.
 */
export function offsetForCenter(
  center: Point,
  displayed: { width: number; height: number },
  scale: number,
): Point {
  return {
    x: (0.5 - center.x) * displayed.width * scale,
    y: (0.5 - center.y) * displayed.height * scale,
  };
}

/**
 * Tolérance de déplacement, en pixels, sous laquelle un pointeur relâché compte
 * encore comme un clic.
 *
 * Zéro ne conviendrait pas : une main tremble, et un pointeur fin — stylet,
 * doigt — bouge toujours d'un ou deux pixels entre l'appui et le relâchement,
 * si bien qu'aucun clic ne serait jamais reconnu. Trop large, un début de
 * déplacement délibéré finirait par basculer le zoom.
 */
export const TAP_SLOP_PX = 5;

/**
 * Distingue le clic du glisser, d'après le seul déplacement parcouru depuis
 * l'appui.
 *
 * La durée ne sert pas de critère : un glisser lent et court reste un glisser,
 * et un doigt posé longuement sans bouger reste un clic. C'est le déplacement,
 * pas le temps, qui sépare l'intention de désigner de celle de déplacer.
 */
export function isTap(origin: Point, release: Point, slop: number = TAP_SLOP_PX): boolean {
  return Math.hypot(release.x - origin.x, release.y - origin.y) <= slop;
}
