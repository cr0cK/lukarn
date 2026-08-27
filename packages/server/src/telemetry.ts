import type { AlbumVisitRow, DeviceKind, VisitorRow, VisitsOverview } from '@lukarn/shared';
import type { Db } from './db.js';

/**
 * Visit telemetry: who opens which album, and since when.
 *
 * Three choices govern this file (D260809h).
 *
 * **Measurement is server-side.** Access to this gallery is authenticated by key,
 * so only the instance knows *who* is viewing. A third-party JavaScript tracker
 * would see an anonymous browser and miss exactly half the question.
 *
 * **It is aggregated on write.** One row per (album, key, session, day) with counters,
 * never one row per request: the table remains around ten rows per day rather than
 * tens of thousands, and requires no substantial purge.
 *
 * **It records little.** The key, session, album, day and counters. Never an IP
 * address, raw user-agent or opened media item: that would be someone's viewing
 * history, and nobody asked for it.
 */

const JOUR_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` in UTC — the same day key as everywhere else. */
function jour(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Key-level aggregation before the account role is added. */
interface LigneVisiteur {
  username: string;
  lastAt: string | null;
  days: number;
  sessions: number;
  albums: number;
  visits: number;
  photos: number;
}

export class VisitLog {
  constructor(private readonly db: Db) {}

  /**
   * Album opening. Called only on the grid's **first page**: subsequent pages are
   * part of the same action, and counting every scroll would make the "visits"
   * column report the number of pages turned.
   */
  recordAlbumOpen(albumId: string, username: string, sessionId: string, now = new Date()): void {
    this.record('visits', albumId, username, sessionId, now);
  }

  /** Opening a photo in the viewer. */
  recordPhotoOpen(albumId: string, username: string, sessionId: string, now = new Date()): void {
    this.record('photos', albumId, username, sessionId, now);
  }

  /**
   * Increments the named counter and creates the row when the tuple is new. The column
   * name is interpolated, which is safe here for the same reason as the sort order in
   * `repo.ts`: it comes from a closed compiler union, never from a received string.
   */
  private record(
    colonne: 'visits' | 'photos',
    albumId: string,
    username: string,
    sessionId: string,
    now: Date,
  ): void {
    this.db
      .prepare(
        `INSERT INTO album_visits (album_id, username, session_id, day, ${colonne}, last_at)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT (album_id, username, session_id, day)
         DO UPDATE SET ${colonne} = ${colonne} + 1, last_at = excluded.last_at`,
      )
      .run(albumId, username, sessionId, jour(now), now.toISOString());
  }

  /**
   * What the "Visits" tab needs: who visited and what they viewed over the last
   * `days` days, including today.
   *
   * Three bounded queries rather than a join: visits, sessions — which carry the
   * device class and last received request — then roles. A key that signed in without
   * opening anything still appears with zero counts: "signed in, viewed nothing" is
   * an answer, and omitting it would suggest no visitor was present.
   */
  overview(days: number, now = new Date()): VisitsOverview {
    const since = jour(new Date(now.getTime() - (days - 1) * JOUR_MS));

    const lignes = this.db
      .prepare(
        `SELECT username,
                MAX(last_at)               AS lastAt,
                COUNT(DISTINCT day)        AS days,
                COUNT(DISTINCT session_id) AS sessions,
                COUNT(DISTINCT album_id)   AS albums,
                SUM(visits)                AS visits,
                SUM(photos)                AS photos
           FROM album_visits
          WHERE day >= ?
          GROUP BY username`,
      )
      .all(since) as LigneVisiteur[];

    // The two columns carried only by the session. The boundary is deliberately the
    // same string as above: `last_seen_at` is an ISO instant, and
    // "2026-08-09T12:00:00.000Z" > "2026-08-09" in SQLite's lexicographic order —
    // the boundary day is therefore included, as it is for visits.
    //
    // **`username IS NOT NULL` excludes the sessions a share link opened.** This tab
    // answers "which access key visited, and on what" (D260809h), and a link is not
    // an access key — its openings are a different question, recorded at the hour in
    // `share_openings` and read in the Links section (D260825c). Without the clause
    // a link's sessions group under NULL and arrive here as a visitor with no name,
    // which is a 500 on this screen rather than a wrong number.
    const vues = this.db
      .prepare(
        `SELECT username,
                MAX(last_seen_at)      AS lastSeenAt,
                GROUP_CONCAT(DISTINCT device) AS devices
           FROM sessions
          WHERE last_seen_at >= ? AND username IS NOT NULL
          GROUP BY username`,
      )
      .all(since) as { username: string; lastSeenAt: string; devices: string | null }[];

    const admins = new Set(
      (
        this.db.prepare('SELECT username FROM users WHERE admin = 1').all() as {
          username: string;
        }[]
      ).map((row) => row.username.toLowerCase()),
    );

    // Indexed in lower case: `album_visits.username` uses `COLLATE NOCASE` while
    // `sessions.username` does not. Both carry the account's stored casing and are
    // therefore the same string in practice, but relying on that coincidence would
    // duplicate a visitor the day it stops holding.
    const visiteurs = new Map<string, VisitorRow>();
    const entree = (username: string): VisitorRow => {
      const cle = username.toLowerCase();
      const deja = visiteurs.get(cle);
      if (deja) return deja;
      const neuf: VisitorRow = {
        username,
        admin: admins.has(cle),
        devices: [],
        lastAt: null,
        lastSeenAt: null,
        days: 0,
        sessions: 0,
        albums: 0,
        visits: 0,
        photos: 0,
      };
      visiteurs.set(cle, neuf);
      return neuf;
    };

    for (const ligne of lignes) Object.assign(entree(ligne.username), ligne);
    for (const vue of vues) {
      const visiteur = entree(vue.username);
      visiteur.lastSeenAt = vue.lastSeenAt;
      visiteur.devices = (vue.devices ?? '')
        .split(',')
        .filter((valeur): valeur is DeviceKind => valeur.length > 0);
    }

    const albums = this.db
      .prepare(
        `SELECT v.album_id                  AS albumId,
                a.title                     AS title,
                COUNT(DISTINCT v.session_id) AS visitors,
                COUNT(DISTINCT v.username)   AS keys,
                SUM(v.visits)                AS visits,
                SUM(v.photos)                AS photos,
                MAX(v.last_at)               AS lastAt
           FROM album_visits v
           -- Outer join, so the title may be NULL: the album may have been deleted
           -- without making its past visits untrue. This is the purpose of having no
           -- foreign key.
           LEFT JOIN albums a ON a.id = v.album_id
          WHERE v.day >= ?
          GROUP BY v.album_id
          ORDER BY visits DESC, lastAt DESC`,
      )
      .all(since) as AlbumVisitRow[];

    return {
      days,
      since,
      // Most recent first: this tab is opened to learn "who visited recently".
      visitors: [...visiteurs.values()].sort((a, b) =>
        (b.lastSeenAt ?? b.lastAt ?? '').localeCompare(a.lastSeenAt ?? a.lastAt ?? ''),
      ),
      albums,
    };
  }

  /**
   * Forgets days that are too old. Four hundred days by default so year-on-year
   * comparison remains possible — one August is compared with the previous one,
   * not with July.
   */
  purgeOld(days: number, now = new Date()): number {
    const borne = jour(new Date(now.getTime() - days * JOUR_MS));
    return this.db.prepare('DELETE FROM album_visits WHERE day < ?').run(borne).changes;
  }
}
