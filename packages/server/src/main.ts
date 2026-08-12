// First of all: the thread-pool size is fixed when this module loads and must be
// set before any I/O. See `threadpool.ts` for the measurement behind this setting.
import { threadPoolSize } from './threadpool.js';
import { dirname } from 'node:path';
import { buildApp } from './app.js';
import type { AppContext } from './context.js';
import { loadDotEnv } from './dotenv.js';
import { loadEnv } from './env.js';

/**
 * Purges expired sessions and throttle counters, announces new photos to
 * subscribers, aggregates places and prewarms the cache.
 */
const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Background timers. The synchronisation timer is rescheduled whenever its setting
 * changes: if armed only once, changing the interval from the administration page
 * would have no effect until the next restart.
 */
function startScheduler(context: AppContext): () => void {
  const housekeeping = setInterval(() => {
    const purged = context.sessions.purgeExpired();
    if (purged > 0) context.log.debug(`${purged} expired sessions purged`);

    // Sign-in counters live in memory: without this purge, a burst of invented
    // identifiers would leave its entries until restart, even after the penalty expired.
    const forgotten = context.throttle.purge();
    if (forgotten > 0) context.log.debug(`${forgotten} sign-in counters forgotten`);

    // Pairing requests live for five minutes; those nobody claims do not remove
    // themselves, and the table is bounded.
    const abandoned = context.pairings.purgeExpired();
    if (abandoned > 0) context.log.debug(`${abandoned} expired pairing requests purged`);

    // Keep four hundred days of visits so year-on-year comparison remains possible.
    // Since the table is aggregated on write, there is never much to remove (D260809h).
    const forgottenVisits = context.visits.purgeOld(400);
    if (forgottenVisits > 0) context.log.debug(`${forgottenVisits} visit days forgotten`);

    // New photos are announced here rather than at the end of a sync: with a sync
    // every half hour writing in batches, adding two hundred photos would send around
    // ten emails during the day. The notifier only announces albums quiet for an hour.
    try {
      context.notifier.run();
    } catch (error) {
      // Hourly housekeeping must not stop for this: the purges above have already
      // run, but the next pass must still happen — the same rule as in D37, where a
      // missed notification is an inconvenience.
      context.log.error({ err: error }, 'Announcing new photos failed');
    }

    // Places are handled here for the same reason as announcements: geocoding is
    // capped at one request per second and belongs neither in a synchronisation path
    // nor a request path. No `await`: a first pass over a large library takes minutes.
    void context.places.run().catch((error: unknown) => {
      context.log.error({ err: error }, 'Places pass failed');
    });

    // Prewarming happens here rather than at the end of a synchronisation: automatic
    // sync may be disabled — the default on an instance whose Drive rarely changes —
    // and the cache would then require a click to fill, exactly what this avoids.
    // No `await`: the pass takes minutes, and housekeeping need not wait for it to return.
    void context.prewarmer
      .run()
      .then(
        // Chained rather than run in parallel: both passes fetch originals from Drive,
        // and transcoding would occupy a core while prewarming waits for one.
        () => context.transcoder.run(),
      )
      .catch((error: unknown) => {
        context.log.error({ err: error }, 'Background media preparation failed');
      });
  }, HOUSEKEEPING_INTERVAL_MS);
  housekeeping.unref();

  let periodic: NodeJS.Timeout | null = null;
  let armedMinutes = -1;

  const arm = (minutes: number): void => {
    // Rearming an unchanged timer would restart the countdown: a setting saved every
    // five minutes would postpone synchronisation indefinitely.
    if (minutes === armedMinutes) return;
    armedMinutes = minutes;

    if (periodic) {
      clearInterval(periodic);
      periodic = null;
    }
    if (minutes <= 0) {
      context.log.info('Automatic sync disabled');
      return;
    }

    periodic = setInterval(
      () => {
        if (!context.drive.connected) return;
        void context.syncThenPrewarm(context.albums).catch((error: unknown) => {
          context.log.error({ err: error }, 'Periodic sync failed');
        });
      },
      minutes * 60 * 1000,
    );
    // `unref`: this timer must not keep the process alive on its own.
    periodic.unref();
    context.log.info(`Automatic synchronisation every ${minutes} min`);
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

  // Without this initial pass, the cache would wait for hourly housekeeping before
  // it starts filling: an hour during which every first opening pays the full cost,
  // just after a restart.
  //
  // The two branches are mutually exclusive by design: launched together, prewarming
  // would start from the old index while the sync fills it, and the pass meant to
  // follow the sync would be rejected as concurrent — the newly arrived photos,
  // precisely those about to be opened, would wait for hourly housekeeping.
  //
  // No `await`: the server must accept requests while the index fills, with the old
  // index continuing to be served in the meantime.
  if (context.settings.syncOnStartup && context.drive.connected) {
    void context.syncThenPrewarm(context.albums).catch((error: unknown) => {
      context.log.error({ err: error }, 'Startup sync failed');
    });
  } else {
    void context.prewarmer
      .run()
      .then(() => context.transcoder.run())
      .catch((error: unknown) => {
        context.log.error({ err: error }, 'Background media preparation failed');
      });

    // The same reason and exclusion apply to places: a newly upgraded instance has
    // days to aggregate, and nobody will wait an hour to see them. When startup sync
    // runs, it triggers them (D91) — also launching them here would cause the pass
    // meant to follow it to be rejected as concurrent, making newly arrived photos
    // wait for the very hourly housekeeping this avoids.
    void context.places.run().catch((error: unknown) => {
      context.log.error({ err: error }, 'Places pass failed');
    });
  }

  const shutdown = async (signal: string): Promise<void> => {
    context.log.info(`${signal} received, shutting down`);
    stopScheduler();
    // An active pass would hold shutdown for minutes for renders that restart on
    // their own after the next launch. Transcoding also kills its ffmpeg process:
    // otherwise a ten-minute encode would outlive the container that started it.
    context.prewarmer.stop();
    context.transcoder.stop();
    try {
      await server.close();
      // Notifications are sent outside the request path: without this wait, a comment
      // posted just before a redeployment would be recorded without notifying anyone.
      await context.mailer.drain();
      context.close();
    } catch (error) {
      context.log.error({ err: error }, 'Error during shutdown');
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await server.listen({ port: env.port, host: env.host });

  server.log.info(
    `Thread pool: ${threadPoolSize} · concurrent renders: ${context.renderer.load.limit}`,
  );

  if (!context.drive.configured) {
    server.log.warn(
      'Google OAuth not configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env',
    );
  } else if (!context.drive.connected) {
    server.log.warn(`Google Drive not connected: open ${env.publicUrl}/admin to authorise`);
  }
}

main().catch((error: unknown) => {
  // Before `listen`, the Fastify logger may not exist, so write the raw error message,
  // which is already phrased for readability.
  console.error(`\nCannot start:\n${(error as Error).message}\n`);
  process.exit(1);
});
