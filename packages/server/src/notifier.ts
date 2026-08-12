import type { Env } from './env.js';
import { buildAlbumUpdateMail, type Mailer } from './mail.js';
import type { MediaRepo, SyncStateRepo } from './repo.js';
import type { SubscriptionRepo } from './subscriptions.js';

/**
 * Announces an album's new photos to those who have opened it.
 *
 * **Why here instead of at the end of a synchronisation.** A sync runs every half
 * hour and writes in batches of 500: adding two hundred photos on a Sunday evening
 * would send around ten emails during the day. Announcements therefore run with
 * the hourly housekeeping in `main.ts` and only cover albums whose last successful
 * synchronisation has been **quiet** for an hour. The cadence remains responsive —
 * a few hours, not a daily digest — preserving the link between "we have just
 * returned from holiday" and "there are photos" (D41).
 */

/** Quiet period required after the last successful sync before announcing anything. */
const QUIET_PERIOD_MS = 60 * 60 * 1000;

interface Logger {
  info: (msg: string) => void;
  debug: (msg: string) => void;
}

/** The minimum album data an announcement needs: its ID and title. */
export interface NotifiableAlbum {
  id: string;
  title: string;
}

export interface AlbumNotifierDeps {
  /** Read again on every pass so an album created since startup is included too. */
  albums: () => NotifiableAlbum[];
  media: MediaRepo;
  syncState: SyncStateRepo;
  subscriptions: SubscriptionRepo;
  /**
   * A function rather than the instance, for the same reason as `albums`: capturing
   * the `Mailer` during construction freezes what the notifier sees. A test that
   * replaces `context.mailer` — as `comments.test.ts` already does — would then
   * control comments but not announcements, and the mismatch would only surface
   * as a wait that never completes.
   */
  mailer: () => Mailer;
  env: Env;
  log: Logger;
}

export class AlbumNotifier {
  constructor(private readonly deps: AlbumNotifierDeps) {}

  /**
   * One pass over all albums. Returns the number of albums announced.
   *
   * `now` is injectable: without it, checking that a freshly synchronised album
   * is not announced would require waiting an hour.
   */
  run(now = Date.now()): number {
    // Without a transport, nothing is touched — especially not `notified_at`.
    // Advancing it without sending would permanently miss photos added before SMTP
    // was configured; leaving it NULL means the first run with a transport sets
    // the boundary without announcing anything, which is exactly the intended behaviour.
    if (!this.deps.mailer().enabled) return 0;

    let announced = 0;

    for (const album of this.deps.albums()) {
      const state = this.deps.syncState.get(album.id);
      // `lastSyncAt` only advances on success: an album in error therefore has a
      // partial index, which must not be used to calculate a count of new items.
      if (state.status !== 'ok' || !state.lastSyncAt) continue;
      if (now - Date.parse(state.lastSyncAt) < QUIET_PERIOD_MS) continue;

      const notifiedAt = this.deps.syncState.notifiedAt(album.id);
      if (notifiedAt === null) {
        // First encounter with this album — either a new installation or an upgraded
        // database. Set the boundary without sending: announcing here would announce
        // the gallery's entire history at once.
        this.deps.syncState.markNotified(album.id, new Date(now).toISOString());
        continue;
      }

      const { count, latest } = this.deps.media.countAddedSince(album.id, notifiedAt);
      if (count === 0 || latest === null) continue;

      // The boundary advances before delivery, even with no recipient. Otherwise,
      // an album that nobody has opened yet would accumulate new items, and its first
      // subscriber would receive "3,000 new photos" in their first email — for photos
      // that arrived before they subscribed.
      this.deps.syncState.markNotified(album.id, latest);

      const subscribers = this.deps.subscriptions.subscribers(album.id);
      if (subscribers.length === 0) continue;

      for (const subscriber of subscribers) {
        this.deps
          .mailer()
          .queue(
            buildAlbumUpdateMail(
              { albumId: album.id, albumTitle: album.title, count },
              subscriber.email,
              this.deps.env,
            ),
          );
      }

      announced++;
      this.deps.log.info(
        `Album "${album.id}": ${count} new photos announced to ${subscribers.length} subscriber(s)`,
      );
    }

    return announced;
  }
}
