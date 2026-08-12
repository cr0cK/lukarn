/**
 * Caption of an open photo: two texts, two scopes.
 *
 * Text explaining an image used to appear elsewhere — the day note in its
 * section header, and nothing on the photo itself. The viewer's bottom bar
 * gathers it from the most specific to the broadest: what is happening here,
 * then what was happening that day (D84).
 *
 * **The album description is not included** (D89). It used to be a third line,
 * but is read on opening the album and is identical across its nine hundred
 * photos: one line per photo to reread it. The album title remains in the header,
 * where it locates without telling a story.
 *
 * Calculate what to display here, outside any component: this is the only part
 * testable without the DOM and the only one with cases — empty lines, everything
 * empty and scope order.
 */

import { useCallback, useEffect, useState } from 'react';

/** The two candidate texts as held by the viewer. */
export interface CaptionSource {
  /** Description of the open photo. */
  description?: string | null;
  /** Note for the day containing it. */
  day?: string | null;
}

/** Caption-line scope, from most specific to broadest. */
export type CaptionScope = 'photo' | 'day';

export interface CaptionEntry {
  scope: CaptionScope;
  /**
   * Prefix shown before text, `null` on the photo line. The line below discusses
   * something other than the viewed image: without this word, "Bonifacio, the
   * beach" would read as the photo caption.
   */
  label: string | null;
  text: string;
}

/**
 * Non-empty lines in scope order. Whitespace-only text does not count: it would
 * open an empty line in the bar, and the bar itself on a photo with nothing to say.
 */
export function captionEntries(source: CaptionSource): CaptionEntry[] {
  const candidates: { scope: CaptionScope; label: string | null; value: string | null }[] = [
    { scope: 'photo', label: null, value: source.description ?? null },
    { scope: 'day', label: 'That day', value: source.day ?? null },
  ];

  return candidates
    .map((candidate) => ({ ...candidate, text: candidate.value?.trim() ?? '' }))
    .filter((candidate) => candidate.text !== '')
    .map(({ scope, label, text }) => ({ scope, label, text }));
}

/**
 * "Caption hidden" preference across visits.
 *
 * Persisted while expansion is not, for a deliberate reason: hiding is a choice
 * about how to view photos — made once rather than repeatedly — while expansion
 * responds to specific text and has no meaning on the next photo.
 *
 * One key for the whole application, unlike comment reading markers: this is a
 * display setting, not album data.
 */
const STORAGE_KEY = 'lukarn:caption-hidden';

/**
 * Tolerant reading modelled on `lib/seenComments.ts`: denied `localStorage`
 * (private browsing in older Safari) must not prevent the viewer from opening.
 * Fall back to "visible", the least misleading interpretation of absent memory
 * — an extra bar can be closed, while a missing bar cannot be guessed.
 */
function load(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export interface CaptionHidden {
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
}

export function useCaptionHidden(): CaptionHidden {
  const [hidden, setHiddenState] = useState(load);

  // Another tab may have changed the setting between openings; on the first
  // render, the state initialiser has already called `load()`.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === STORAGE_KEY) setHiddenState(load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setHidden = useCallback((next: boolean) => {
    setHiddenState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Quota exceeded or write denied: the bar reappears next visit, which is
      // not worth failing a render.
    }
  }, []);

  return { hidden, setHidden };
}
