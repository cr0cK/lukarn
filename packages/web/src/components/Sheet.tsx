import {
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { tapFeedback } from '../lib/haptics';
import { useT } from '../lib/i18n';
import { decideSheetStop, resistAboveTop } from '../lib/sheetDrag';
import { settleDuration } from '../lib/swipeTrack';
import { SETTLE_EASING } from '../lib/useSwipe';

/**
 * Movement after which a press becomes a drag.
 *
 * Nothing moves before it: a sheet twitching under the first two pixels of every
 * tap would make touching its handle unsettling. Same threshold and same reason
 * as the photo rail's direction lock.
 */
const DRAG_LOCK_PX = 8;

/**
 * After this silence, treat the finger as stopped, so a flick followed by a
 * pause does not commit from a speed measured a second earlier.
 */
const VELOCITY_IDLE_MS = 80;

/**
 * Height of the grip row. A 44 px target for a 36 px bar — the bar alone would
 * be a four-pixel handle. Named because an `'auto'` stop has to add it to the
 * content it measures.
 */
const GRIP_PX = 44;

/**
 * A stop, as a fraction of the viewport height — or `'auto'`, measured from the
 * content. The caption's height depends on how much someone wrote about the
 * photo, and no fraction describes that.
 */
export type SheetStop = number | 'auto';

interface SheetProps {
  /** Stops in ascending height. The first is where the sheet rests. */
  stops: readonly SheetStop[];
  /** Index of the stop in force, or `-1` for a closed sheet. */
  stop: number;
  /** A gesture, the backdrop, `Escape` or the handle asks for another stop. */
  onStopChange: (stop: number) => void;
  /**
   * First stop at which the sheet is a **layer**: backdrop, trapped focus and
   * `Escape`. Below it the sheet is a strip resting on the page, which stays
   * usable behind it — the viewer's caption, where the photo must remain
   * reachable. Defaults to `0`: every open stop is a layer.
   */
  layerFrom?: number;
  /** Accessible name. A sheet is a dialog and dialogs are named. */
  label: string;
  /**
   * What the resting stop shows, and **the only thing an `'auto'` stop is
   * measured from**. Without it, that measurement would include whatever the
   * taller stop reveals: dragging the viewer's panel back down would aim at the
   * height of the panel rather than the caption, land at half the screen and
   * then jump to the caption once the content swapped.
   *
   * Omit it when the sheet has one stop and one content — the account menu —
   * and `'auto'` then measures `children` instead.
   */
  peek?: ReactNode;
  children: ReactNode;
}

/**
 * Bottom sheet: the phone's answer to a side panel and a dropdown menu.
 *
 * Both surfaces this replaces sat out of reach of a thumb — a panel covering the
 * screen from the top, a 16 rem menu anchored to the upper right corner. A sheet
 * arrives from the edge the hand is already on, and its **height is the gesture**:
 * the same drag that opened it puts it away.
 *
 * It follows the finger pixel for pixel and decides on release, exactly like the
 * viewer's photo rail, and reuses that rail's settling curve and duration
 * (`settleDuration`, `SETTLE_EASING`). Two motion vocabularies in one application
 * are noticed even when neither can be named.
 *
 * `env(safe-area-inset-bottom)` is padding **inside** the sheet: its content
 * clears the home bar while its surface still reaches the bottom of the screen,
 * which is what makes it look attached to the edge rather than floating above it.
 */
export function Sheet({
  stops,
  stop,
  onStopChange,
  layerFrom = 0,
  label,
  peek,
  children,
}: SheetProps): ReactElement | null {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);
  const resting = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  /** Pixel height of every stop, in the same order. Measured, never assumed. */
  const [heights, setHeights] = useState<number[]>([]);
  /** Live drag offset in pixels, positive downwards. `0` at rest. */
  const [dragged, setDragged] = useState(0);
  const [settleMs, setSettleMs] = useState(0);

  const gesture = useRef<{
    id: number;
    originY: number;
    locked: boolean;
    lastY: number;
    lastAt: number;
    velocity: number;
  } | null>(null);
  const commit = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLayer = stop >= layerFrom;
  /**
   * What a tap on the grip will do, named for whoever cannot see the sheet move.
   * A one-stop sheet has nowhere to go but away, so it says so.
   */
  const gripLabel =
    stop < stops.length - 1
      ? t('sheet.expand')
      : stops.length > 1
        ? t('sheet.collapse')
        : t('common.close');

  /**
   * Measure after layout, not during render: an `'auto'` stop is the height its
   * content actually took, and asking before the browser has laid it out returns
   * the previous photo's caption.
   */
  useLayoutEffect(() => {
    const measure = (): void => {
      const available = window.innerHeight;
      // `'auto'` is the content plus the grip above it, and never more than half
      // the screen: a thousand-character description would otherwise give the
      // resting stop the whole photo.
      const measured = peek === undefined ? content.current : resting.current;
      const auto = Math.min((measured?.scrollHeight ?? 0) + GRIP_PX, available * 0.5);
      const next = stops.map((value) => (value === 'auto' ? auto : available * value));
      // Replace only on a real change: this effect depends on `children`, which is
      // a new value on every render, and an unconditional `setHeights` would
      // schedule the render that runs it again.
      setHeights((current) =>
        current.length === next.length && current.every((value, index) => value === next[index])
          ? current
          : next,
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [stops, peek, children]);

  useEffect(
    () => () => {
      if (commit.current) clearTimeout(commit.current);
    },
    [],
  );

  // A stop reached from outside — the URL, a keyboard shortcut — must not inherit
  // the offset of whatever gesture last ran.
  useLayoutEffect(() => {
    setDragged(0);
    setSettleMs(0);
  }, [stop]);

  const settleTo = useCallback(
    (next: number, from: number, velocity: number) => {
      const target = next < 0 ? 0 : (heights[next] ?? 0);
      const duration = settleDuration(target - from, velocity);
      setSettleMs(duration);
      // Express the destination as an offset from the current stop so one
      // transition carries the sheet there, whether or not the stop changes.
      setDragged((heights[stop] ?? 0) - target);

      commit.current = setTimeout(() => {
        setSettleMs(0);
        if (next === stop) setDragged(0);
        else {
          tapFeedback();
          onStopChange(next);
        }
      }, duration);
    },
    [heights, stop, onStopChange],
  );

  /**
   * Where a **tap** on the grip goes: up one stop, or back down from the top.
   *
   * The drag teaches the sheet's whole range, but it asks for a gesture where a
   * press would do — and on a one-stop sheet, dragging it away to dismiss is a
   * lot of hand for a menu somebody opened by mistake. A tap therefore does the
   * obvious thing at each end: open it further, or put it back
   * ([D260814f](../../../../specs/08-decisions/D260814f-the-sheet-s-grip-answers-a-tap-not-only-a-drag.md)).
   */
  const nextOnTap = stop < stops.length - 1 ? stop + 1 : stop - 1;

  const tapGrip = useCallback(() => {
    if (heights.length === 0) return;
    if (nextOnTap > stop) {
      // Growing is not animated — the sheet's height is a style, and a drag
      // upwards does not preview it either — so commit at once rather than sit
      // still for a settling delay that shows nothing.
      tapFeedback();
      onStopChange(nextOnTap);
      return;
    }
    // Shrinking and dismissal do animate: `dragged` is positive there, which is
    // the direction the transform actually renders.
    settleTo(nextOnTap, heights[stop] ?? 0, 0);
  }, [heights, stop, nextOnTap, onStopChange, settleTo]);

  /**
   * A gesture that moved is not also a press.
   *
   * The browser fires `click` on the element after `pointerup`, so without this
   * every completed drag would settle on a stop and then be toggled off it again
   * by the click that followed.
   */
  const dragMoved = useRef(false);

  const end = useCallback(
    (event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      const from = gesture.current;
      gesture.current = null;
      if (!from || from.id !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      // Before the first measurement there is no stop to decide between, and
      // `decideSheetStop` would compare against nothing.
      if (heights.length === 0) return;
      // A press that never moved is left to the button's own `click`, which also
      // covers the keyboard.
      if (!from.locked) return;
      dragMoved.current = true;

      const dy = resistAboveTop(event.clientY - from.originY, stop === stops.length - 1);
      const velocity = performance.now() - from.lastAt > VELOCITY_IDLE_MS ? 0 : from.velocity;
      const next = cancelled ? stop : decideSheetStop({ dy, velocity, stops: heights, from: stop });

      settleTo(next, (heights[stop] ?? 0) - dy, velocity);
    },
    [stop, stops.length, heights, settleTo],
  );

  // `Escape` and focus belong to a layer only: a resting caption is part of the
  // page, and trapping focus in it would make the photo unreachable by keyboard.
  useEffect(() => {
    if (!isLayer || stop < 0) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // Stop propagation like `ActionMenu`: in the viewer the same key also
        // closes the photo, and one press must not do both.
        event.stopPropagation();
        onStopChange(layerFrom - 1);
        return;
      }
      if (event.key !== 'Tab') return;

      // Keep focus inside: a sheet covering the screen with a backdrop is a
      // dialog, and tabbing out of it would move through a page nobody can see.
      const focusable = panel.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isLayer, stop, layerFrom, onStopChange]);

  if (stop < 0) return null;

  const height = heights[stop] ?? 0;

  // Render into `document.body`, like `InstallInstructions` and for the same
  // reason: the three places that open a sheet are a `backdrop-blur` header, a
  // `z-10` band inside the viewer and a `fixed` tab bar. A `fixed` element
  // inside any of them resolves against its ancestor rather than the viewport,
  // and its paint order against that ancestor's layer rather than the page's.
  return createPortal(
    <>
      {/* The backdrop belongs to the layer stops only, and it carries the tap
          that dismisses — the gesture everyone tries first. */}
      {isLayer && (
        <button
          type="button"
          aria-label={t('common.close')}
          tabIndex={-1}
          onClick={() => onStopChange(layerFrom - 1)}
          className="fixed inset-0 z-50 cursor-default bg-black/50"
        />
      )}

      <div
        ref={panel}
        role="dialog"
        aria-modal={isLayer}
        aria-label={label}
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden rounded-t-[20px] border-t border-ink-700 bg-ink-850 pb-[env(safe-area-inset-bottom)] shadow-2xl"
        style={{
          height,
          // Positive `dragged` shortens the sheet by pushing it down, so the
          // handle stays under the finger that is holding it.
          transform: `translate3d(0, ${Math.max(0, dragged)}px, 0)`,
          transition: settleMs ? `transform ${settleMs}ms ${SETTLE_EASING}` : 'none',
        }}
      >
        {/* The grip is the affordance **and** the target: a 44 px row for a 36 px
            bar, because the bar alone would be a four-pixel-tall handle.

            `touch-action: none` on it and nothing else: the browser must not
            claim this drag as a page scroll, while the content below keeps its
            own scrolling — which is the whole point of the taller stop. */}
        <button
          type="button"
          // A `button`, not a bare handle: it answers a tap and, with it, `Enter`
          // and `Space` from the keyboard the focus trap can reach — the drag was
          // the only way in, and a gesture is the one thing a keyboard cannot make.
          aria-label={gripLabel}
          aria-expanded={stops.length > 1 ? stop === stops.length - 1 : undefined}
          onClick={() => {
            // A drag ends with a `click` on the same element: without this, every
            // completed gesture would settle on a stop and then be toggled off it.
            if (dragMoved.current) {
              dragMoved.current = false;
              return;
            }
            tapGrip();
          }}
          className="flex h-11 w-full shrink-0 cursor-grab touch-none items-center justify-center transition-colors hover:bg-white/5"
          onPointerDown={(event) => {
            dragMoved.current = false;
            if (settleMs > 0) return;
            // Capture **immediately**, unlike the photo rail, which must first
            // decide whether the gesture is horizontal. A grip is 44 px tall and
            // the drag that matters is 400 px long: without capture, the very
            // first move already lands outside the handle, the element never
            // sees it, and the sheet stays where it was. Nothing competes for
            // this pointer — `touch-action: none` on the grip settles that.
            event.currentTarget.setPointerCapture(event.pointerId);
            gesture.current = {
              id: event.pointerId,
              originY: event.clientY,
              locked: false,
              lastY: event.clientY,
              lastAt: performance.now(),
              velocity: 0,
            };
          }}
          onPointerMove={(event) => {
            const from = gesture.current;
            if (!from || from.id !== event.pointerId) return;
            const dy = event.clientY - from.originY;
            if (!from.locked) {
              if (Math.abs(dy) < DRAG_LOCK_PX) return;
              from.locked = true;
              setSettleMs(0);
            }
            const now = performance.now();
            const elapsed = now - from.lastAt;
            // Two points too close together produce an absurd speed: keep the
            // previous value rather than divide by nothing.
            if (elapsed >= 4) {
              from.velocity = (event.clientY - from.lastY) / elapsed;
              from.lastY = event.clientY;
              from.lastAt = now;
            }
            setDragged(resistAboveTop(dy, stop === stops.length - 1));
          }}
          onPointerUp={(event) => end(event, false)}
          onPointerCancel={(event) => end(event, true)}
        >
          <span aria-hidden="true" className="h-1 w-9 rounded-full bg-ink-600" />
        </button>

        {peek !== undefined && (
          <div ref={resting} className="shrink-0">
            {peek}
          </div>
        )}

        <div
          ref={content}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
        >
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}
