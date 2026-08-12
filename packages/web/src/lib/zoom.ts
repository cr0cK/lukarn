/**
 * Viewer zoom scales.
 *
 * Calculation is isolated because an error is invisible to the eye: a scale 40%
 * off looks like a slightly soft image, not a bug. The subtlety is that the
 * displayed photo is never the original file but a WebP render whose longest
 * side the server caps — available pixels cannot be inferred from index dimensions.
 */

/**
 * Longest-side cap for the `hd` render, mirroring `HD_MAX_EDGE`
 * (`packages/server/src/media/renderer.ts`).
 *
 * It exists only for anticipation: the `hd` variant loads on first enlargement,
 * and the zoom limit is needed before then. Once the render arrives, its
 * measurement is authoritative — any server divergence corrects itself on display.
 */
export const HD_MAX_EDGE = 4096;

export interface ZoomScaleInput {
  /** Original file width from the index, `0` if unknown. */
  sourceWidth: number;
  /** Original file height from the index, `0` if unknown. */
  sourceHeight: number;
  /** `naturalWidth` of the render actually loaded, `0` before the first load. */
  renderedWidth: number;
  /** True when the measured render is `hd`, making the measurement authoritative. */
  hdLoaded: boolean;
  /** Image width after fitting the frame, in CSS pixels. */
  displayedWidth: number;
  /** Component zoom cap. */
  maxScale: number;
}

export interface ZoomScale {
  /** Pixels actually available across the width once the `hd` render is in place. */
  availableWidth: number;
  /**
   * Scale where one available pixel occupies one screen pixel: the indicator's
   * "100%" and the target of the `z` key and click.
   */
  pixelScale: number;
  /** True when the available render has fewer pixels than the original file. */
  limited: boolean;
}

/**
 * Resolution of the `hd` render the server will produce: reduce the longest side
 * to `HD_MAX_EDGE`, while `withoutEnlargement` prevents enlarging a smaller photo.
 */
function hdWidthFor(sourceWidth: number, sourceHeight: number): number {
  const longest = Math.max(sourceWidth, sourceHeight);
  if (longest <= HD_MAX_EDGE) return sourceWidth;
  return Math.round((sourceWidth * HD_MAX_EDGE) / longest);
}

/**
 * Zoom scales from actually available resolution, not original file dimensions.
 *
 * A 6000 px photo is served at only 4096 px: basing "100%" on 6000 px would claim
 * native pixels while interpolating one in three. Here, 100% means "one render
 * pixel per screen pixel", the boundary beyond which the browser invents;
 * `limited` says whether that boundary falls below the original file so the
 * interface can disclose rather than hide it.
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
        : // With no index dimensions, the received render is all that is known.
          // Zoom starts lower, then corrects when `hd` is measured.
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
 * Displayed percentage: share of available pixels actually painted on screen.
 * 100% means one render pixel per screen pixel; above it the browser interpolates.
 *
 * Calculate from `availableWidth`, not `pixelScale`, which `maxScale` caps: on a
 * photo requiring more than that cap, comparing scale to `pixelScale` would show
 * 100% while maximum zoom still displayed only some pixels.
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
 * Fraction of the image occupied by the visible area on each axis, in `[0, 1]`.
 *
 * Used by the position-indicator frame: `1` means the image fits entirely in the
 * window on that axis — the frame then covers the whole indicator, correctly.
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
 * Centre of the visible area in the image, as fractions `[0, 1]`.
 *
 * Pan moves the image beneath a fixed window, so the viewed area moves in the
 * opposite direction, hence the negative sign.
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
 * Inverse of `viewCenter`: pan required to bring an image point to window centre.
 *
 * This makes the position indicator interactive — clicking selects a location in
 * the photo and the display must move there. Do not bound the result here: only
 * the caller knows its overflow limits.
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
 * Movement tolerance in pixels below which a released pointer still counts as a click.
 *
 * Zero would fail: hands tremble, and a fine pointer — stylus or finger — always
 * moves one or two pixels between press and release, so no click would register.
 * Too large would let the start of an intentional pan toggle zoom.
 */
export const TAP_SLOP_PX = 5;

/**
 * Distinguishes click from drag using only movement since press.
 *
 * Duration is not a criterion: a slow short drag remains a drag, and a finger
 * held still remains a click. Movement, not time, separates selecting from panning.
 */
export function isTap(origin: Point, release: Point, slop: number = TAP_SLOP_PX): boolean {
  return Math.hypot(release.x - origin.x, release.y - origin.y) <= slop;
}
