import { dirname } from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { AppContext } from './context.js';
import { loadDotEnv } from './dotenv.js';
import { loadEnv } from './env.js';

/** Purge des sessions expirées et des compteurs de throttle. */
const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000;

function startScheduler(context: AppContext): NodeJS.Timeout[] {
  const timers: NodeJS.Timeout[] = [];

  const housekeeping = setInterval(() => {
    const purged = context.sessions.purgeExpired();
    if (purged > 0) context.log.debug(`${purged} sessions expirées purgées`);
  }, HOUSEKEEPING_INTERVAL_MS);
  timers.push(housekeeping);

  const intervalMinutes = context.config.sync.intervalMinutes;
  if (intervalMinutes > 0) {
    const periodic = setInterval(
      () => {
        if (!context.drive.connected) return;
        void context.syncer.syncAll(context.albums).catch((error: unknown) => {
          context.log.error({ err: error }, 'Synchronisation périodique en échec');
        });
      },
      intervalMinutes * 60 * 1000,
    );
    timers.push(periodic);
    context.log.info(`Synchronisation automatique toutes les ${intervalMinutes} min`);
  }

  // `unref` : ces minuteurs ne doivent pas maintenir le process en vie à eux seuls.
  timers.forEach((timer) => timer.unref());
  return timers;
}

async function main(): Promise<void> {
  const envFile = loadDotEnv();

  const env = loadEnv(process.env, envFile ? dirname(envFile) : process.cwd());
  const config = loadConfig(env.configPath);
  const { server, context } = await buildApp(env, config);

  const timers = startScheduler(context);

  if (config.sync.onStartup && context.drive.connected) {
    // Sans `await` : le serveur doit accepter des requêtes pendant que l'index
    // se remplit, l'ancien index restant servi entre-temps.
    void context.syncer.syncAll(context.albums).catch((error: unknown) => {
      context.log.error({ err: error }, 'Synchronisation de démarrage en échec');
    });
  }

  const shutdown = async (signal: string): Promise<void> => {
    context.log.info(`${signal} reçu, arrêt en cours`);
    timers.forEach((timer) => clearInterval(timer));
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
