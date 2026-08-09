// En tout premier : la taille du pool de fils est fixée au chargement de ce
// module, et doit l'être avant la moindre entrée-sortie. Voir `threadpool.ts`
// pour la mesure qui justifie ce réglage.
import { threadPoolSize } from './threadpool.js';
import { dirname } from 'node:path';
import { buildApp } from './app.js';
import type { AppContext } from './context.js';
import { loadDotEnv } from './dotenv.js';
import { loadEnv } from './env.js';

/**
 * Purge des sessions expirées et des compteurs de throttle, annonce des
 * nouvelles photos aux abonnés, agrégation des lieux et préchauffage du cache.
 */
const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Minuteurs de fond. Le minuteur de synchronisation est reprogrammé dès que le
 * réglage change : armé une fois pour toutes, modifier l'intervalle depuis
 * l'administration n'aurait d'effet qu'au redémarrage suivant.
 */
function startScheduler(context: AppContext): () => void {
  const housekeeping = setInterval(() => {
    const purged = context.sessions.purgeExpired();
    if (purged > 0) context.log.debug(`${purged} sessions expirées purgées`);

    // Les compteurs de connexion vivent en mémoire : sans cette purge, une
    // rafale d'identifiants inventés laisserait ses entrées jusqu'au
    // redémarrage, même une fois la pénalité expirée.
    const forgotten = context.throttle.purge();
    if (forgotten > 0) context.log.debug(`${forgotten} compteurs de connexion oubliés`);

    // Les demandes d'appairage vivent cinq minutes ; celles que personne n'a
    // relevées ne s'effacent pas d'elles-mêmes, et la table est bornée.
    const abandoned = context.pairings.purgeExpired();
    if (abandoned > 0) context.log.debug(`${abandoned} demandes d'appairage expirées purgées`);

    // Quatre cents jours de visites, pour que la comparaison d'une année sur
    // l'autre reste possible. La table étant agrégée à l'écriture, il n'y a
    // jamais grand-chose à effacer (D260809h).
    const forgottenVisits = context.visits.purgeOld(400);
    if (forgottenVisits > 0) context.log.debug(`${forgottenVisits} journées de visite oubliées`);

    // L'annonce des nouvelles photos est ici, et non à la fin d'une sync : avec
    // une synchronisation toutes les demi-heures écrivant par lots, verser deux
    // cents photos enverrait une dizaine d'emails dans la journée. Le notifieur
    // n'annonce que les albums calmes depuis une heure.
    try {
      context.notifier.run();
    } catch (error) {
      // Le ménage horaire ne doit pas s'interrompre pour ça : les purges
      // ci-dessus ont déjà eu lieu, mais le prochain tour aurait lieu quand
      // même — c'est la même règle qu'en D37, une notification manquée est un
      // désagrément.
      context.log.error({ err: error }, 'Annonce des nouvelles photos en échec');
    }

    // Les lieux sont ici pour la même raison que l'annonce : le géocodage est
    // plafonné à une requête par seconde et n'a rien à faire dans le chemin
    // d'une synchronisation, ni dans celui d'une requête. Sans `await` : un
    // premier passage sur une grosse bibliothèque dure des minutes.
    void context.places.run().catch((error: unknown) => {
      context.log.error({ err: error }, 'Passage des lieux en échec');
    });

    // Le préchauffage est ici plutôt qu'à la fin d'une synchronisation : la
    // sync automatique peut être désactivée — elle l'est par défaut sur une
    // instance dont le Drive bouge peu — et le cache aurait alors besoin d'un
    // clic pour se remplir, ce qui est exactement ce qu'on cherche à éviter.
    // Sans `await` : le passage dure des minutes, le ménage n'a pas à
    // l'attendre pour rendre la main.
    void context.prewarmer
      .run()
      .then(
        // Enchaîné et non lancé en parallèle : les deux passages tirent des
        // originaux depuis Drive, et le transcodage occuperait un cœur pendant
        // que le préchauffage attend le sien.
        () => context.transcoder.run(),
      )
      .catch((error: unknown) => {
        context.log.error({ err: error }, 'Préparation des médias en fond en échec');
      });
  }, HOUSEKEEPING_INTERVAL_MS);
  housekeeping.unref();

  let periodic: NodeJS.Timeout | null = null;
  let armedMinutes = -1;

  const arm = (minutes: number): void => {
    // Réarmer à l'identique redémarrerait le compte à rebours : un réglage
    // enregistré toutes les cinq minutes repousserait la synchronisation
    // indéfiniment.
    if (minutes === armedMinutes) return;
    armedMinutes = minutes;

    if (periodic) {
      clearInterval(periodic);
      periodic = null;
    }
    if (minutes <= 0) {
      context.log.info('Synchronisation automatique désactivée');
      return;
    }

    periodic = setInterval(
      () => {
        if (!context.drive.connected) return;
        void context.syncThenPrewarm(context.albums).catch((error: unknown) => {
          context.log.error({ err: error }, 'Synchronisation périodique en échec');
        });
      },
      minutes * 60 * 1000,
    );
    // `unref` : ce minuteur ne doit pas maintenir le process en vie à lui seul.
    periodic.unref();
    context.log.info(`Synchronisation automatique toutes les ${minutes} min`);
  };

  arm(context.settings.syncIntervalMinutes);
  context.onSettingsChanged((settings) => arm(settings.syncIntervalMinutes));

  return () => {
    clearInterval(housekeeping);
    if (periodic) clearInterval(periodic);
  };
}

async function main(): Promise<void> {
  const envFile = loadDotEnv();

  const env = loadEnv(process.env, envFile ? dirname(envFile) : process.cwd());
  const { server, context } = await buildApp(env);

  const stopScheduler = startScheduler(context);

  // Sans ce premier passage, le cache attendrait le ménage horaire pour
  // commencer à se remplir : une heure pendant laquelle chaque première
  // ouverture se paie plein tarif, juste après un redémarrage.
  //
  // Les deux branches s'excluent, et c'est délibéré : lancées ensemble, le
  // préchauffage partirait sur l'index d'avant pendant que la sync le remplit,
  // et celui qui doit suivre la sync se ferait refuser comme passage concurrent
  // — les photos qui viennent d'arriver, précisément celles qu'on va ouvrir,
  // attendraient le ménage horaire.
  //
  // Sans `await` : le serveur doit accepter des requêtes pendant que l'index se
  // remplit, l'ancien index restant servi entre-temps.
  if (context.settings.syncOnStartup && context.drive.connected) {
    void context.syncThenPrewarm(context.albums).catch((error: unknown) => {
      context.log.error({ err: error }, 'Synchronisation de démarrage en échec');
    });
  } else {
    void context.prewarmer
      .run()
      .then(() => context.transcoder.run())
      .catch((error: unknown) => {
        context.log.error({ err: error }, 'Préparation des médias en fond en échec');
      });

    // Même raison pour les lieux, et même exclusion : une instance qu'on vient
    // de mettre à jour a ses journées à agréger, et personne n'attendra une
    // heure pour les voir. Quand la sync de démarrage part, c'est elle qui les
    // déclenche (D91) — les lancer ici en plus ferait refuser celui qui doit la
    // suivre comme passage concurrent, et les photos qui viennent d'arriver
    // attendraient précisément le ménage horaire qu'on cherche à éviter.
    void context.places.run().catch((error: unknown) => {
      context.log.error({ err: error }, 'Passage des lieux en échec');
    });
  }

  const shutdown = async (signal: string): Promise<void> => {
    context.log.info(`${signal} reçu, arrêt en cours`);
    stopScheduler();
    // Un passage en cours tiendrait l'arrêt pendant des minutes, pour des
    // rendus qui repartiront d'eux-mêmes au démarrage suivant. Le transcodage
    // tue en plus son ffmpeg : sans ça, un encodage de dix minutes survivrait
    // au conteneur qui l'a lancé.
    context.prewarmer.stop();
    context.transcoder.stop();
    try {
      await server.close();
      // Les notifications partent hors du chemin de la requête : sans cette
      // attente, un commentaire posté juste avant un redéploiement serait
      // enregistré sans que personne n'en soit prévenu.
      await context.mailer.drain();
      context.close();
    } catch (error) {
      context.log.error({ err: error }, "Erreur pendant l'arrêt");
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await server.listen({ port: env.port, host: env.host });

  server.log.info(
    `Pool de fils : ${threadPoolSize} · rendus simultanés : ${context.renderer.load.limit}`,
  );

  if (!context.drive.configured) {
    server.log.warn(
      'OAuth Google non configuré : renseigne GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans .env',
    );
  } else if (!context.drive.connected) {
    server.log.warn(`Google Drive non connecté : ouvre ${env.publicUrl}/admin pour autoriser`);
  }
}

main().catch((error: unknown) => {
  // Avant `listen`, le logger Fastify n'existe pas forcément : on écrit le
  // message d'erreur brut, qui est déjà rédigé pour être lisible.
  console.error(`\nDémarrage impossible :\n${(error as Error).message}\n`);
  process.exit(1);
});
