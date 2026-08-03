// En tout premier : la taille du pool de fils est fixée au chargement de ce
// module, et doit l'être avant la moindre entrée-sortie. Voir `threadpool.ts`
// pour la mesure qui justifie ce réglage.
import { threadPoolSize } from './threadpool.js';
import { dirname } from 'node:path';
import { buildApp } from './app.js';
import type { AppContext } from './context.js';
import { loadDotEnv } from './dotenv.js';
import { loadEnv } from './env.js';

/** Purge des sessions expirées et des compteurs de throttle. */
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
        void context.syncer.syncAll(context.albums).catch((error: unknown) => {
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

  if (context.settings.syncOnStartup && context.drive.connected) {
    // Sans `await` : le serveur doit accepter des requêtes pendant que l'index
    // se remplit, l'ancien index restant servi entre-temps.
    void context.syncer.syncAll(context.albums).catch((error: unknown) => {
      context.log.error({ err: error }, 'Synchronisation de démarrage en échec');
    });
  }

  const shutdown = async (signal: string): Promise<void> => {
    context.log.info(`${signal} reçu, arrêt en cours`);
    stopScheduler();
    try {
      await server.close();
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
