import { useEffect, useState } from 'react';

/**
 * The `md` breakpoint, from below.
 *
 * Written once here because three components now branch on it in **JavaScript**
 * rather than in CSS, and a breakpoint retyped at each of them is a breakpoint
 * that will eventually differ from Tailwind's by a pixel.
 */
export const PHONE_QUERY = '(max-width: 47.99rem)';

/** A finger rather than a cursor: no hover, and a 48 px minimum target. */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';

/**
 * Whether a media query currently matches, kept in step with the browser.
 *
 * Used where CSS cannot decide alone: below `md` the viewer's panel and caption
 * merge into **one** sheet, and rendering both structures to hide one with
 * `md:hidden` would mount two comment forms, two scroll containers and two
 * message drafts for a single photo.
 *
 * Initialised from the query rather than from `false`: starting at the wrong
 * value would mount the desktop column on a phone for one frame, and the sheet
 * would then animate in from a position it never had.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    // Re-read on subscribe: between the initial render and this effect, an
    // orientation change may already have invalidated the first answer.
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);

  return matches;
}
