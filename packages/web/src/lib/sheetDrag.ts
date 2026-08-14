import { EDGE_RESISTANCE, FLICK_VELOCITY } from './swipeTrack';

/**
 * Bottom-sheet rules: what happens to a vertical drag after the finger lifts.
 *
 * The vertical counterpart of `swipeTrack.ts`, and deliberately built on the
 * **same** constants: a sheet that resisted differently from the photo rail, or
 * accepted a flick at another speed, would feel like a second application inside
 * the first. `settleDuration` and `SETTLE_EASING` are reused as they stand.
 *
 * Here as well, the decision lives outside React because it is a matter of
 * thresholds, and thresholds are where a gesture actually fails.
 */

/** Below this, a gesture is a trembling press rather than a flick. Same as the rail. */
const FLICK_MIN_PX = 12;

/**
 * Movement actually applied to the sheet.
 *
 * Downwards it always follows the finger — that direction always leads somewhere,
 * either a lower stop or dismissal. Above the tallest stop only a fraction
 * remains: the ceiling is felt rather than announced, exactly as the rail's edge is.
 */
export function resistAboveTop(dy: number, atTallest: boolean): number {
  return dy < 0 && atTallest ? dy * EDGE_RESISTANCE : dy;
}

interface SheetDecision {
  /** Total vertical finger movement in pixels, **positive downwards**. */
  dy: number;
  /** Speed at release in px/ms, signed like `dy`. */
  velocity: number;
  /** Stop heights in pixels, ascending. Never empty. */
  stops: readonly number[];
  /** Index in `stops` the gesture started from. */
  from: number;
}

/**
 * Stop the sheet settles on: an index in `stops`, or `-1` for dismissal.
 *
 * Two paths, like the rail's two. A **flick** moves exactly one stop in its own
 * direction, without looking at distance: this is the gesture of someone who has
 * already decided, and making them cross half the screen for it would be the
 * defect D260809e describes from the other side. Anything slower **snaps to the
 * nearest stop**, because a slow drag is someone watching the result arrive.
 *
 * One stop below the lowest is dismissal, not a floor: a sheet that could only
 * be shrunk would leave the photo permanently covered by a strip nobody asked for.
 */
export function decideSheetStop({ dy, velocity, stops, from }: SheetDecision): number {
  const start = stops[from] ?? stops[0]!;
  // Dragging **down** shortens the sheet: height falls as `dy` grows.
  const height = start - dy;

  const flick =
    Math.abs(velocity) >= FLICK_VELOCITY &&
    Math.abs(dy) >= FLICK_MIN_PX &&
    // A finger reversing at the last moment cancels rather than confirms — the
    // rail's rule, for the same reason.
    Math.sign(velocity) === Math.sign(dy);

  if (flick) {
    const step = dy > 0 ? -1 : 1;
    return Math.min(stops.length - 1, from + step);
  }

  // Pulled below half the smallest stop: the sheet is being put away, not resized.
  if (height < stops[0]! / 2) return -1;

  let nearest = 0;
  for (let index = 1; index < stops.length; index++) {
    if (Math.abs(stops[index]! - height) < Math.abs(stops[nearest]! - height)) nearest = index;
  }
  return nearest;
}
