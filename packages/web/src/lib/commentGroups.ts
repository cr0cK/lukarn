import type { Comment } from '@nonni/shared';
import { dayLabel, localDayKey } from './justify';

/**
 * What a comment needs to be grouped here: itself and enough context to locate
 * it. Both `AdminComment` and `FeedComment` satisfy this — the moderation queue
 * and activity drawer ask the same question, "what was written, and where?",
 * and need not answer it twice.
 */
export interface SituatedComment extends Comment {
  albumId: string;
  albumTitle: string;
  mediaId: string;
  /** `null` if the photo disappeared from the index; the message remains. */
  mediaName: string | null;
}

/** Comments on one photo in the order returned by the list. */
export interface PhotoGroup<T extends SituatedComment = SituatedComment> {
  /** Identifies the group among siblings — React `key` and `Map` key. */
  key: string;
  albumId: string;
  albumTitle: string;
  mediaId: string;
  /** `null` if the photo disappeared from the index; the thread remains readable and moderatable. */
  mediaName: string | null;
  comments: T[];
}

/** One day in the list and the photos commented on that day. */
export interface DayGroup<T extends SituatedComment = SituatedComment> {
  /** `YYYY-MM-DD` on the reader's clock. */
  key: string;
  /** "Today", "Yesterday" or the full date. */
  label: string;
  photos: PhotoGroup<T>[];
}

/**
 * Groups a page of comments by day, then by photo.
 *
 * Two repetitions disappear at once: the date, which need not appear on every
 * row when twenty messages share a day, and the photo/album pair repeated
 * identically beneath every comment in a thread.
 *
 * **The day follows the reader, not UTC** — unlike the grid. `format.ts` explains
 * why: `taken_at` is wall time without a zone, while a comment date is the moment
 * someone pressed "Post". UTC grouping would place a message written at 23:30
 * in Paris under the previous day.
 *
 * **Grouping applies only to the received page**, not the corpus: a photo whose
 * comments cross a page boundary appears at the bottom of one and top of the
 * next. This is the cost of grouping afterwards, less than forcing the server to
 * paginate whole groups, where pages would no longer contain a known row count.
 *
 * Preserve input order throughout: days and photos appear in the order of their
 * first comment, and comments on a photo retain theirs. The incoming list is in
 * reverse chronological order and stays that way.
 */
export function groupByDayAndPhoto<T extends SituatedComment>(comments: T[]): DayGroup<T>[] {
  const days = new Map<string, Map<string, PhotoGroup<T>>>();

  for (const comment of comments) {
    const dayKey = localDayKey(new Date(comment.createdAt));
    let photos = days.get(dayKey);
    if (!photos) {
      photos = new Map();
      days.set(dayKey, photos);
    }

    // Include the photo, not media alone: the same Drive file indexed under two
    // albums has two separate conversations (D12), which remain separate here.
    //
    // Build the key with `JSON.stringify` rather than delimiter concatenation:
    // the encoded array escapes its contents, so no pair can imitate another
    // regardless of Drive identifier shape. Elsewhere the repository separates
    // with a null byte (media cursor), but it must be escaped here — a literal
    // byte makes git classify the file as binary and stop showing diffs.
    const photoKey = JSON.stringify([comment.albumId, comment.mediaId]);
    const existing = photos.get(photoKey);
    if (existing) {
      existing.comments.push(comment);
    } else {
      photos.set(photoKey, {
        key: photoKey,
        albumId: comment.albumId,
        albumTitle: comment.albumTitle,
        mediaId: comment.mediaId,
        mediaName: comment.mediaName,
        comments: [comment],
      });
    }
  }

  return [...days].map(([key, photos]) => ({
    key,
    label: dayLabel(key),
    photos: [...photos.values()],
  }));
}
