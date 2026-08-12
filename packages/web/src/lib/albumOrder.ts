/**
 * Album reading order: what the URL requests, what this browser remembers and
 * what the album offers by default.
 *
 * Three sources answer three separate questions. The URL is an exact view,
 * shared or received by email: it takes precedence or a link would not open what
 * its sender saw. The browser carries its user's habit — changing direction on
 * every visit to the same album is exactly what memory avoids. Finally, the
 * album carries the direction of its story, configurable in /admin (D99).
 *
 * Subscription is excluded even though it seems to distinguish a newly found
 * album from a followed one: it is automatic on first opening (D41), so true for
 * both. The actual signal is "this browser has opened this album before", namely
 * local memory itself.
 */

import { isSortOrder, type SortOrder } from '@nonni/shared';
import { useCallback, useEffect, useState } from 'react';

function storageKey(albumId: string): string {
  return `nonni:album-order:${albumId}`;
}

/**
 * What this browser remembers of the album order, `null` when it remembers nothing.
 *
 * Tolerant reading modelled on `lib/seenComments.ts`: denied `localStorage`
 * (private browsing in older Safari) or a value written by a previous version
 * must not prevent the album from opening. The fallback is "nothing remembered",
 * which simply lets the album decide.
 */
export function readStoredOrder(albumId: string): SortOrder | null {
  try {
    const raw = window.localStorage.getItem(storageKey(albumId));
    return isSortOrder(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Order to apply, or `null` until a source answers — the album is not loaded and
 * nothing is remembered.
 *
 * `null` is not a fallback default: the grid waits instead of loading two hundred
 * items in an order it would reject when the album arrives.
 */
export function resolveOrder(
  urlParam: string | null,
  stored: SortOrder | null,
  albumDefault: SortOrder | undefined,
): SortOrder | null {
  if (isSortOrder(urlParam)) return urlParam;
  if (stored) return stored;
  return albumDefault ?? null;
}

export interface StoredOrder {
  /** Remembered order for this album, `null` if this browser has not seen it. */
  stored: SortOrder | null;
  remember: (order: SortOrder) => void;
}

/**
 * Remembered order for this album and a way to update it.
 *
 * One key per album, like comment reading markers: "Corse" follows the trip's
 * order while "Les enfants" starts with the latest photos, and one shared key
 * would make switching one reverse the other.
 */
export function useStoredOrder(albumId: string): StoredOrder {
  const [stored, setStored] = useState<SortOrder | null>(() => readStoredOrder(albumId));

  useEffect(() => {
    setStored(readStoredOrder(albumId));

    // Another tab may have switched the same album meanwhile; without this, two
    // views of the same album would diverge until the next reload.
    const onStorage = (event: StorageEvent): void => {
      if (event.key === storageKey(albumId)) setStored(readStoredOrder(albumId));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [albumId]);

  const remember = useCallback(
    (order: SortOrder) => {
      setStored(order);
      try {
        window.localStorage.setItem(storageKey(albumId), order);
      } catch {
        // Quota exceeded or write denied: the album returns to its default next
        // visit, which is not worth failing a render.
      }
    },
    [albumId],
  );

  return { stored, remember };
}
