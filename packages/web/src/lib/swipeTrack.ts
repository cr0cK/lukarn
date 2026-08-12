/**
 * Viewer rail rules: what happens to a horizontal swipe after the finger lifts.
 *
 * The rail follows the finger pixel for pixel — making the gesture visible and
 * discoverable — but the photo-change decision happens on release. It lives here
 * outside React because its thresholds need testing: half of failed gestures
 * come from a threshold, never an event handler.
 */

/**
 * Gap between rail photos in pixels. Without it, the next photo appears attached
 * to the previous one during a swipe — two edge-to-edge images read as one cut image.
 */
export const GUTTER_PX = 24;

/**
 * Width fraction beyond which the rail switches to the neighbour.
 *
 * Roughly one quarter: higher requires crossing the screen to change photo,
 * tiring on a large phone; lower lets a hesitant gesture skip a photo.
 */
export const COMMIT_FRACTION = 0.22;

/**
 * Speed (px/ms) at which a short gesture still switches. This lets a quick thumb
 * flick suffice without crossing a quarter of the screen: the native gesture
 * everyone already knows.
 */
export const FLICK_VELOCITY = 0.35;

/** Below this, it is a trembling press rather than a flick. */
const FLICK_MIN_PX = 12;

/**
 * Remaining movement when no photo exists on that side. The rail moves, showing
 * that the gesture was received, but resists: an edge is felt without a message
 * or abrupt block.
 */
export const EDGE_RESISTANCE = 0.35;

/** Bounds for settling so it stays lively without feeling abrupt. */
const SETTLE_MIN_MS = 160;
const SETTLE_MAX_MS = 320;

/** Minimum speed for duration calculation, avoiding division by a still finger. */
const SETTLE_MIN_VELOCITY = 0.5;

interface SwipeDecision {
  /** Total horizontal finger movement in pixels. */
  dx: number;
  /** Speed at release in px/ms, signed like `dx`. */
  velocity: number;
  /** Frame width, which determines gesture scale. */
  width: number;
  canPrev: boolean;
  canNext: boolean;
}

/**
 * Movement actually applied to the rail, including edges.
 *
 * The finger pulls freely while a photo exists on that side; beyond the first or
 * last media, only a fraction of the gesture remains.
 */
export function resistAtEdge(dx: number, canPrev: boolean, canNext: boolean): number {
  if (dx > 0 && !canPrev) return dx * EDGE_RESISTANCE;
  if (dx < 0 && !canNext) return dx * EDGE_RESISTANCE;
  return dx;
}

/**
 * Gesture outcome: `1` for the next photo, `-1` for the previous and `0` to settle back.
 *
 * Two validation paths for two gestures: cross a fraction of the screen — seeing
 * what comes before release — or flick the rail without looking. Keeping only
 * one would make the other ineffective.
 */
export function decideSwipe({ dx, velocity, width, canPrev, canNext }: SwipeDecision): -1 | 0 | 1 {
  if (dx === 0) return 0;
  const towards = dx < 0 ? 1 : -1;
  if (towards === 1 && !canNext) return 0;
  if (towards === -1 && !canPrev) return 0;

  if (Math.abs(dx) >= width * COMMIT_FRACTION) return towards;

  // A flick counts only in the movement direction: a finger reversing at the
  // last moment cancels rather than confirms.
  const flick =
    Math.abs(velocity) >= FLICK_VELOCITY &&
    Math.sign(velocity) === Math.sign(dx) &&
    Math.abs(dx) >= FLICK_MIN_PX;

  return flick ? towards : 0;
}

/**
 * Settling duration derived from remaining distance and finger speed.
 *
 * A fixed duration betrays the gesture: after a quick flick the rail seems to
 * stick; after a slow nearly complete drag it shoots away. Here animation
 * extends finger movement instead of replacing it.
 */
export function settleDuration(remainingPx: number, velocity: number): number {
  const speed = Math.max(Math.abs(velocity), SETTLE_MIN_VELOCITY);
  return Math.min(SETTLE_MAX_MS, Math.max(SETTLE_MIN_MS, Math.abs(remainingPx) / speed));
}
