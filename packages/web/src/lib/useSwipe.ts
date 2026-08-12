import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { GUTTER_PX, decideSwipe, resistAtEdge, settleDuration } from './swipeTrack';

/**
 * Horizontal viewer swipe: the photo follows the finger, neighbours enter from
 * the edges and the rail settles into place on release.
 *
 * A family gallery is viewed mainly on phones, where changing photos required
 * aiming at a 44 px arrow over the image. Swipe already existed, but **nothing
 * showed it**: the image jumped after the finger lifted, so nobody discovered
 * the gesture or could reverse it midway. Every native viewer moves the photo
 * beneath the finger — movement teaches the gesture, not a tutorial.
 *
 * **Touch and stylus only.** With a mouse, a horizontal drag on a photo is rare
 * while click already zooms: adding photo changes would make clicks unpredictable
 * depending on three pixels of movement.
 */

/**
 * Movement after which the gesture is recognised as horizontal or vertical.
 *
 * Nothing moves beforehand: a rail twitching over the first two pixels of every
 * press would make merely placing a finger unsettling.
 */
const DIRECTION_LOCK_PX = 10;

/**
 * The gesture must be clearly horizontal. Without this ratio, a slightly angled
 * vertical scroll — the most common phone gesture — would skip a photo.
 */
const HORIZONTAL_RATIO = 1.5;

/**
 * After this silence, treat the finger as stopped. Without the reset, a flick
 * followed by a pause before release would confirm from speed measured a second
 * earlier — the gesture of someone who specifically changed their mind.
 */
const VELOCITY_IDLE_MS = 80;

/** Easing curve: firm start, gentle arrival, like fading inertia. */
export const SETTLE_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';

interface SwipeTrackOptions {
  /** Displayed index; its change resets the rail. */
  index: number;
  /** Number of loaded media, used to know whether a neighbour exists on a side. */
  count: number;
  /** Receives `1` for the next photo and `-1` for the previous. */
  onNavigate: (towards: 1 | -1) => void;
  enabled: boolean;
}

export interface SwipeTrack {
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
  /** Rail offset in pixels. */
  offset: number;
  /** Current transition duration; `0` while the finger holds the rail. */
  settleMs: number;
  /**
   * A gesture occupies the rail. This signal makes the viewer mount adjacent
   * photos: outside a swipe, they do not belong in the document.
   */
  active: boolean;
}

/**
 * Swipe rail. Returns handlers for the frame and movement state for the
 * three-photo container.
 */
export function useSwipeTrack({
  index,
  count,
  onNavigate,
  enabled,
}: SwipeTrackOptions): SwipeTrack {
  const [offset, setOffset] = useState(0);
  const [settleMs, setSettleMs] = useState(0);
  const [active, setActive] = useState(false);

  const gesture = useRef<{
    id: number;
    origin: { x: number; y: number };
    /** Frame width on press, the scale for every gesture threshold. */
    width: number;
    /** Whether the gesture has been recognised as horizontal. */
    locked: boolean;
    /** Latest timestamped point for instantaneous speed. */
    lastX: number;
    lastAt: number;
    velocity: number;
  } | null>(null);

  const commit = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canPrev = index > 0;
  const canNext = index < count - 1;

  /**
   * The rail returns home when the photo changes, not before.
   *
   * The viewer does not decide its index: it requests it and receives it through
   * the URL. Meanwhile the rail must remain where animation left it — on the
   * adjacent photo already on screen. Resetting when requesting the change would
   * reveal the photo just left for one frame.
   */
  useLayoutEffect(() => {
    setOffset(0);
    setSettleMs(0);
    setActive(false);
  }, [index]);

  useEffect(
    () => () => {
      if (commit.current) clearTimeout(commit.current);
    },
    [],
  );

  const end = useCallback(
    (event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      const from = gesture.current;
      gesture.current = null;
      if (!from || from.id !== event.pointerId) return;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      // A gesture never recognised as horizontal moved nothing and still belongs
      // to zoom, which separately decides whether it was a press.
      if (!from.locked) return;

      const dx = resistAtEdge(event.clientX - from.origin.x, canPrev, canNext);
      const velocity = performance.now() - from.lastAt > VELOCITY_IDLE_MS ? 0 : from.velocity;
      const towards = cancelled
        ? 0
        : decideSwipe({ dx, velocity, width: from.width, canPrev, canNext });

      const target = towards === 0 ? 0 : -towards * (from.width + GUTTER_PX);
      const duration = settleDuration(target - dx, velocity);
      setSettleMs(duration);
      setOffset(target);

      // Change the photo only after the rail arrives: requesting earlier would
      // remount the viewer mid-animation on a photo not yet shown by the screen.
      commit.current = setTimeout(() => {
        if (towards === 0) {
          setActive(false);
          setSettleMs(0);
        } else {
          onNavigate(towards);
        }
      }, duration);
    },
    [canPrev, canNext, onNavigate],
  );

  return {
    offset,
    settleMs,
    active,

    handlers: {
      onPointerDown: (event) => {
        // A moving rail already carries a decision: grabbing it midway would confirm
        // a gesture on a photo no longer being targeted.
        if (!enabled || event.pointerType === 'mouse' || settleMs > 0) return;
        const now = performance.now();
        gesture.current = {
          id: event.pointerId,
          origin: { x: event.clientX, y: event.clientY },
          width: event.currentTarget.getBoundingClientRect().width,
          locked: false,
          lastX: event.clientX,
          lastAt: now,
          velocity: 0,
        };
      },

      onPointerMove: (event) => {
        const from = gesture.current;
        if (!from || from.id !== event.pointerId) return;

        const dx = event.clientX - from.origin.x;
        const dy = event.clientY - from.origin.y;

        if (!from.locked) {
          if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return;
          // The first threshold crossing decides once and for all: a curving gesture
          // must not change type beneath the finger.
          if (Math.abs(dx) < Math.abs(dy) * HORIZONTAL_RATIO) {
            gesture.current = null;
            return;
          }
          from.locked = true;
          // Guarantees release even if the finger leaves the frame and blocks zoom
          // handlers lower in the tree.
          event.currentTarget.setPointerCapture(event.pointerId);
          setActive(true);
          setSettleMs(0);
        }

        const now = performance.now();
        const elapsed = now - from.lastAt;
        // Two points too close together produce absurd speed: retain the previous
        // value rather than divide by a zero interval.
        if (elapsed >= 4) {
          from.velocity = (event.clientX - from.lastX) / elapsed;
          from.lastX = event.clientX;
          from.lastAt = now;
        }

        setOffset(resistAtEdge(dx, canPrev, canNext));
      },

      onPointerUp: (event) => end(event, false),

      // Gesture interrupted by the browser — second finger or edge-swipe back:
      // settle the rail without changing photo.
      onPointerCancel: (event) => end(event, true),
    },
  };
}
