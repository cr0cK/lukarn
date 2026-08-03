import type { Db } from './db.js';

/**
 * Abonnements aux nouveautés d'un album.
 *
 * Le problème que cette table résout tient en une phrase : **une identité n'est
 * rattachée à aucun album.** L'accès vient de la clé d'accès (`users`),
 * l'identité de l'adresse vérifiée (`commenters`), et rien ne relie les deux —
 * on ne sait donc pas nativement à qui écrire quand des photos arrivent.
 *
 * La réponse retenue est l'abonnement **à l'ouverture de l'album** : ouvrir un
 * album est un signal d'intérêt bien meilleur qu'une case à cocher, que
 * personne ne coche. Seules les identités déjà vérifiées sont concernées — ces
 * gens ont fourni leur adresse en connaissance de cause (D41).
 *
 * D'où l'état plutôt que la simple présence d'une ligne : l'abonnement étant
 * automatique, une ligne effacée au désabonnement serait recréée à la
 * réouverture de l'album le lendemain.
 */

/** Ce que le notifieur a besoin de savoir d'un abonné. */
export interface Subscriber {
  id: number;
  email: string;
  displayName: string;
}

export type SubscriptionState = 'auto' | 'opted_out';

export class SubscriptionRepo {
  constructor(private readonly db: Db) {}

  /**
   * Abonne à l'ouverture de l'album. Ne fait rien si l'identité n'est pas
   * vérifiée, ni si une ligne existe déjà — c'est tout l'intérêt du
   * `INSERT OR IGNORE` : un `opted_out` reste `opted_out`, sinon rouvrir
   * l'album réabonnerait celui qui vient de se désabonner.
   *
   * La condition de vérification est portée par le SQL et non par l'appelant :
   * une adresse seulement déclarée peut être celle d'un tiers, à qui cette
   * galerie n'a rien à écrire (D39).
   */
  subscribe(commenterId: number, albumId: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO album_subscriptions (commenter_id, album_id, state, created_at)
         SELECT id, ?, 'auto', ? FROM commenters WHERE id = ? AND verified_at IS NOT NULL`,
      )
      .run(albumId, new Date().toISOString(), commenterId);
  }

  /**
   * Désabonne de **cet** album, sans toucher aux autres ni à `commenters.notify`
   * qui gouverne les réponses aux commentaires. Trouver « Noël 2019 » trop
   * bavard ne doit pas faire perdre les réponses à ses propres messages.
   *
   * Écrit la ligne si elle n'existe pas : le lien vit dans un email qu'on
   * rouvre des mois plus tard, et l'abonnement a pu être effacé entre-temps —
   * mieux vaut enregistrer le refus que de le perdre.
   */
  unsubscribe(commenterId: number, albumId: string): void {
    this.db
      .prepare(
        `INSERT INTO album_subscriptions (commenter_id, album_id, state, created_at)
         VALUES (?, ?, 'opted_out', ?)
         ON CONFLICT (commenter_id, album_id) DO UPDATE SET state = 'opted_out'`,
      )
      .run(commenterId, albumId, new Date().toISOString());
  }

  /** État de l'abonnement, `null` si l'album n'a jamais été ouvert. */
  state(commenterId: number, albumId: string): SubscriptionState | null {
    const row = this.db
      .prepare('SELECT state FROM album_subscriptions WHERE commenter_id = ? AND album_id = ?')
      .get(commenterId, albumId) as { state: SubscriptionState } | undefined;
    return row?.state ?? null;
  }

  /**
   * À qui annoncer les nouveautés de cet album.
   *
   * `notify = 0` exclut aussi : c'est le seul interrupteur qui dise « plus
   * aucun email de cette galerie », et le lien des notifications de
   * commentaires est le seul endroit où on peut l'actionner. Continuer à écrire
   * à quelqu'un qui l'a coupé serait la meilleure façon de finir en indésirable.
   */
  subscribers(albumId: string): Subscriber[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.email, c.display_name
           FROM album_subscriptions s
           JOIN commenters c ON c.id = s.commenter_id
          WHERE s.album_id = ? AND s.state = 'auto'
            AND c.verified_at IS NOT NULL AND c.notify = 1
          ORDER BY c.id`,
      )
      .all(albumId) as { id: number; email: string; display_name: string }[];
    return rows.map((row) => ({ id: row.id, email: row.email, displayName: row.display_name }));
  }
}
