import type { Env } from './env.js';
import { buildAlbumUpdateMail, type Mailer } from './mail.js';
import type { MediaRepo, SyncStateRepo } from './repo.js';
import type { SubscriptionRepo } from './subscriptions.js';

/**
 * Annonce des nouvelles photos d'un album à ceux qui l'ont ouvert.
 *
 * **Pourquoi ici et pas à la fin d'une synchronisation.** Une sync tourne toutes
 * les demi-heures et écrit par lots de 500 : verser deux cents photos un
 * dimanche soir enverrait une dizaine d'emails dans la journée. L'annonce est
 * donc branchée sur le ménage horaire de `main.ts` et ne parle que des albums
 * dont la dernière synchronisation réussie est **calme** depuis une heure. La
 * cadence reste réactive — quelques heures, pas un récapitulatif quotidien —,
 * ce qui garde le lien entre « on vient de rentrer de vacances » et « il y a
 * des photos » (D41).
 */

/** Silence exigé après la dernière sync réussie avant d'annoncer quoi que ce soit. */
const QUIET_PERIOD_MS = 60 * 60 * 1000;

interface Logger {
  info: (msg: string) => void;
  debug: (msg: string) => void;
}

/** Le minimum dont l'annonce a besoin d'un album : son id et son titre. */
export interface NotifiableAlbum {
  id: string;
  title: string;
}

export interface AlbumNotifierDeps {
  /** Relu à chaque passage : un album créé depuis le démarrage compte aussi. */
  albums: () => NotifiableAlbum[];
  media: MediaRepo;
  syncState: SyncStateRepo;
  subscriptions: SubscriptionRepo;
  /**
   * Une fonction et non l'instance, pour la même raison qu'`albums` : capturer
   * le `Mailer` à la construction fige ce que le notifieur voit. Un test qui
   * remplace `context.mailer` — ce que fait déjà `comments.test.ts` — piloterait
   * alors les commentaires sans piloter les annonces, et le décalage ne se
   * manifesterait que par une attente qui n'arrive jamais.
   */
  mailer: () => Mailer;
  env: Env;
  log: Logger;
}

export class AlbumNotifier {
  constructor(private readonly deps: AlbumNotifierDeps) {}

  /**
   * Un passage sur tous les albums. Rend le nombre d'albums annoncés.
   *
   * `now` est injectable : sans lui, vérifier qu'un album fraîchement
   * synchronisé n'est pas annoncé demanderait d'attendre une heure.
   */
  run(now = Date.now()): number {
    // Sans transport, on ne touche à rien — surtout pas à `notified_at`.
    // L'avancer sans envoyer ferait manquer définitivement les photos arrivées
    // avant la configuration de SMTP ; le laisser à NULL fait que la première
    // exécution avec un transport initialise la borne sans rien annoncer, ce
    // qui est exactement le comportement voulu.
    if (!this.deps.mailer().enabled) return 0;

    let announced = 0;

    for (const album of this.deps.albums()) {
      const state = this.deps.syncState.get(album.id);
      // `lastSyncAt` n'avance qu'en cas de succès : un album en erreur porte
      // donc un index partiel, dont on n'a pas à tirer un compte de nouveautés.
      if (state.status !== 'ok' || !state.lastSyncAt) continue;
      if (now - Date.parse(state.lastSyncAt) < QUIET_PERIOD_MS) continue;

      const notifiedAt = this.deps.syncState.notifiedAt(album.id);
      if (notifiedAt === null) {
        // Première rencontre avec cet album — installation neuve, ou base mise
        // à jour. On pose la borne sans envoyer : annoncer ici, ce serait
        // annoncer tout l'historique de la galerie d'un coup.
        this.deps.syncState.markNotified(album.id, new Date(now).toISOString());
        continue;
      }

      const { count, latest } = this.deps.media.countAddedSince(album.id, notifiedAt);
      if (count === 0 || latest === null) continue;

      // La borne avance avant l'envoi, et même sans destinataire. Sans cela,
      // un album que personne n'a encore ouvert accumulerait ses nouveautés, et
      // le premier abonné recevrait « 3 000 nouvelles photos » pour son premier
      // email — pour des photos arrivées avant qu'il ne s'abonne.
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
        `Album "${album.id}" : ${count} nouveautés annoncées à ${subscribers.length} abonné(s)`,
      );
    }

    return announced;
  }
}
