import type { AlbumVisitRow, DeviceKind, VisitorRow, VisitsOverview } from '@nonni/shared';
import type { Db } from './db.js';

/**
 * Télémétrie de visite : qui ouvre quel album, et depuis quand.
 *
 * Trois choix gouvernent ce fichier (D260809h).
 *
 * **La mesure est côté serveur.** L'accès à cette galerie est authentifié par
 * clé : seule l'instance sait *qui* regarde. Un traceur JS tiers verrait un
 * navigateur anonyme et raterait exactement la moitié de la question.
 *
 * **Elle est agrégée à l'écriture.** Une ligne par (album, clé, session, jour)
 * avec des compteurs, jamais une ligne par requête : la table reste de l'ordre
 * de la dizaine de lignes par jour au lieu de la dizaine de milliers, et il n'y
 * a aucune purge sérieuse à écrire.
 *
 * **Elle enregistre peu.** La clé, la session, l'album, le jour et des
 * compteurs. Jamais d'adresse IP, jamais de user-agent brut, jamais le média
 * ouvert : ce serait l'historique de lecture de quelqu'un, et personne ne l'a
 * demandé.
 */

const JOUR_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` en UTC — la même clé de journée que partout ailleurs. */
function jour(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Ce que rend l'agrégation par clé avant d'être complétée par le rôle du compte. */
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
   * Ouverture d'un album. Appelée sur la **première page** de la grille
   * seulement : les suivantes sont le même geste, et compter chaque défilement
   * ferait dire à la colonne « visites » le nombre de pages tournées.
   */
  recordAlbumOpen(albumId: string, username: string, sessionId: string, now = new Date()): void {
    this.record('visits', albumId, username, sessionId, now);
  }

  /** Ouverture d'une photo en visionneuse. */
  recordPhotoOpen(albumId: string, username: string, sessionId: string, now = new Date()): void {
    this.record('photos', albumId, username, sessionId, now);
  }

  /**
   * Le compteur nommé est incrémenté, la ligne créée si le quadruplet est
   * nouveau. Le nom de colonne est interpolé, ce qui est acceptable ici pour la
   * raison du sens de tri de `repo.ts` : il vient d'une union fermée du
   * compilateur, jamais d'une chaîne reçue.
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
   * Ce qu'il faut à l'onglet « Visites » : qui est venu, et ce qui a été
   * regardé, sur les `days` derniers jours (celui-ci compris).
   *
   * Trois requêtes bornées plutôt qu'une jointure : les visites, les sessions —
   * qui portent la classe d'appareil et la dernière requête reçue —, puis les
   * rôles. Une clé qui s'est connectée sans rien ouvrir figure quand même dans
   * la liste, à zéro : « connecté, n'a rien regardé » est une réponse, et la
   * faire disparaître ferait croire à une absence de visiteur.
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

    // Les deux colonnes que seule la session porte. La borne est la même chaîne
    // que ci-dessus, et c'est volontaire : `last_seen_at` est un instant ISO, et
    // « 2026-08-09T12:00:00.000Z » > « 2026-08-09 » dans l'ordre lexicographique
    // qui est celui de SQLite — le jour de la borne est donc inclus, comme pour
    // les visites.
    const vues = this.db
      .prepare(
        `SELECT username,
                MAX(last_seen_at)      AS lastSeenAt,
                GROUP_CONCAT(DISTINCT device) AS devices
           FROM sessions
          WHERE last_seen_at >= ?
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

    // Indexé en minuscules : `album_visits.username` est `COLLATE NOCASE` et
    // `sessions.username` ne l'est pas. Les deux portent la casse stockée du
    // compte, donc la même chaîne en pratique — mais faire dépendre la fusion
    // de cette coïncidence dédoublerait un visiteur le jour où elle cesse.
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
           -- Jointure externe, et le titre peut donc être NULL : l'album a pu
           -- être supprimé depuis, sans que sa fréquentation passée cesse
           -- d'être vraie. C'est tout l'intérêt de l'absence de clé étrangère.
           LEFT JOIN albums a ON a.id = v.album_id
          WHERE v.day >= ?
          GROUP BY v.album_id
          ORDER BY visits DESC, lastAt DESC`,
      )
      .all(since) as AlbumVisitRow[];

    return {
      days,
      since,
      // Le plus récent d'abord : c'est « qui est venu récemment » qu'on ouvre
      // cet onglet pour savoir.
      visitors: [...visiteurs.values()].sort((a, b) =>
        (b.lastSeenAt ?? b.lastAt ?? '').localeCompare(a.lastSeenAt ?? a.lastAt ?? ''),
      ),
      albums,
    };
  }

  /**
   * Oublie les journées trop anciennes. Quatre cents jours par défaut, pour que
   * la comparaison d'une année sur l'autre reste possible — un mois d'août se
   * lit contre celui d'avant, pas contre juillet.
   */
  purgeOld(days: number, now = new Date()): number {
    const borne = jour(new Date(now.getTime() - days * JOUR_MS));
    return this.db.prepare('DELETE FROM album_visits WHERE day < ?').run(borne).changes;
  }
}
