/**
 * What has already been read: per photo for the viewer badge, and as one block
 * for the activity-feed badge.
 *
 * Remember **a number of seen comments**, not a date. Comparing two integers
 * answers the only question — "is anything new since my last visit?" — whereas
 * a date would require the server to carry every thread timestamp for comparison.
 *
 * The marker lives in the browser rather than the database, while the account
 * comes from the server. A server table would need indexing by access key, but a
 * key is shared by a household (D38): the first person opening a photo would
 * clear everyone else's badge. The browser does belong to one person. The
 * accepted cost is starting over on a new device: one's own comments appear
 * unread once, never the reverse.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** Number of seen comments by media identifier. */
export type SeenCounts = Record<string, number>;

/**
 * Comments received since the last visit.
 *
 * Flooring at zero is necessary: deletion or hiding can lower the total below
 * what was read, and a negative number would appear unchanged on the badge.
 */
export function unreadCount(total: number, seen: number | undefined): number {
  return Math.max(0, total - (seen ?? 0));
}

function storageKey(albumId: string): string {
  return `nonni:comments-seen:${albumId}`;
}

/**
 * Tolerant reading: denied `localStorage` (private browsing in older Safari) or
 * a value corrupted by a previous version must not prevent comments from
 * appearing. Treat everything as unread, the least misleading interpretation of
 * absent memory.
 */
function load(albumId: string): SeenCounts {
  try {
    const raw = window.localStorage.getItem(storageKey(albumId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

    const counts: SeenCounts = {};
    for (const [mediaId, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        counts[mediaId] = value;
      }
    }
    return counts;
  } catch {
    return {};
  }
}

function save(albumId: string, counts: SeenCounts): void {
  try {
    window.localStorage.setItem(storageKey(albumId), JSON.stringify(counts));
  } catch {
    // Quota exceeded or write denied: the badge becomes noisy again next visit,
    // which is not worth failing a render.
  }
}

export interface SeenComments {
  seen: SeenCounts;
  /** Marks this photo read up to `count` comments. */
  markSeen: (mediaId: string, count: number) => void;
}

/* --------------------------------------------------------------------------
 * Activity feed
 * ------------------------------------------------------------------------ */

const FEED_KEY = 'nonni:comments-feed-seen';

/**
 * Activity-feed reading marker: the greatest identifier already seen.
 *
 * An identifier, not a count, unlike a photo badge. The feed is paginated with no
 * total: counting what was read would require traversing all of it, while
 * `AUTOINCREMENT` makes the ID an exact marker — everything above it arrived
 * later, regardless of messages deleted meanwhile.
 *
 * One global scope even when the drawer is filtered to an album: the badge asks
 * "is anything new anywhere?", and a marker per album would let opening
 * "Vacances" clear it without reading anything from "Corse".
 */
export function useSeenFeed(): {
  seenId: number;
  /** Marks the feed read up to this identifier. */
  markFeedSeen: (id: number) => void;
} {
  const [seenId, setSeenId] = useState(() => loadFeedMarker());
  const seenRef = useRef(seenId);

  const markFeedSeen = useCallback((id: number) => {
    // Use strict equality, not `>=`: the marker must be able to **decrease** when
    // latest messages are deleted or hidden, or the next one remains invisible
    // until exceeding an unreachable marker. Same rule as `markSeen` for a photo.
    const cible = Math.max(0, id);
    if (seenRef.current === cible) return;

    seenRef.current = cible;
    try {
      window.localStorage.setItem(FEED_KEY, String(cible));
    } catch {
      // Write denied: the badge becomes noisy again next visit, which is not worth
      // failing a render.
    }
    setSeenId(cible);
  }, []);

  return { seenId, markFeedSeen };
}

/**
 * Number of messages received since the last visit among what has been loaded.
 *
 * **No remembered marker makes everything unread.** This is the same handling of
 * absent memory as for photos: a new device demands attention once, never the
 * reverse, and one click clears it.
 */
export function unreadFeedCount(ids: readonly number[], seenId: number): number {
  return ids.filter((id) => id > seenId).length;
}

function loadFeedMarker(): number {
  try {
    const raw = window.localStorage.getItem(FEED_KEY);
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

/**
 * Album reading markers remembered between visits.
 *
 * One object per album rather than one key per photo: markers for a deleted album
 * can still be cleared or inspected by hand, and `localStorage` entry count does
 * not follow the number of viewed photos.
 */
export function useSeenComments(albumId: string): SeenComments {
  const [seen, setSeen] = useState<SeenCounts>(() => load(albumId));

  /**
   * State mirror read without creating a dependency. Above all it avoids writing
   * from the `setSeen` updater: React replays that function in strict mode, where
   * a side effect does not belong.
   */
  const seenRef = useRef(seen);

  useEffect(() => {
    const loaded = load(albumId);
    seenRef.current = loaded;
    setSeen(loaded);
  }, [albumId]);

  const markSeen = useCallback(
    (mediaId: string, count: number) => {
      const current = seenRef.current;
      if ((current[mediaId] ?? 0) === Math.max(0, count)) return;

      const next = { ...current };
      // Remove a photo returning to zero comments from the table: retaining a
      // marker that can hide nothing would grow storage indefinitely.
      if (count > 0) next[mediaId] = count;
      else delete next[mediaId];

      seenRef.current = next;
      save(albumId, next);
      setSeen(next);
    },
    [albumId],
  );

  return { seen, markSeen };
}
