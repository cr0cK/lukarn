import { useEffect, useState } from 'react';

/**
 * Travel required before the bar changes state, in pixels.
 *
 * A phone reports a handful of pixels in both directions during elastic
 * overscroll, without anyone having scrolled: reacting to every event made the
 * bar flicker while the page stood still.
 */
const THRESHOLD = 12;

/**
 * Offset below which the bar always shows.
 *
 * Nothing is gained by hiding it at the top of a page, and a bar that leaves on
 * the first downward pixel takes the album title away before anything has
 * scrolled past it.
 */
const TOP_ZONE = 64;

/**
 * Whether the top bar should retract because the page is being scrolled down.
 *
 * The reading surface of a phone **is** the photo grid, and a permanently
 * reserved bar costs 65 px of it at every moment. Retracting on the way down and
 * returning on the first upward movement gives that height back without removing
 * the bar — the only control the page still has once the tabs took the rest.
 *
 * The listener is passive, like `useGridLayout`'s: the handler never calls
 * `preventDefault`, and a non-passive one would let it delay every scroll frame.
 *
 * Under `prefers-reduced-motion` it stays `false` for good. A bar sliding in and
 * out on every gesture is precisely the movement that setting asks to stop, and
 * the reserved height is the behaviour it replaces.
 */
export function useHideOnScroll(): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let anchor = window.scrollY;

    const onScroll = (): void => {
      const y = window.scrollY;
      const travel = y - anchor;
      // Keep the anchor where it was until the threshold is crossed, so a slow
      // deliberate scroll accumulates towards it instead of never reaching it.
      if (Math.abs(travel) < THRESHOLD) return;
      anchor = y;
      setHidden(travel > 0 && y > TOP_ZONE);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return hidden;
}
