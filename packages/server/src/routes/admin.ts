import { randomBytes } from 'node:crypto';
import type { AdminStatus } from '@gdv/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { DriveNotConfiguredError } from '../drive/service.js';
import { requireAdmin } from '../plugins/auth.js';
import { buildAlbum } from '../repo.js';

const OAUTH_STATE_COOKIE = 'gdv_oauth_state';
const OAUTH_STATE_TTL_S = 600;

const resyncSchema = z.object({ albumId: z.string().min(1).optional() });

export function createAdminRoutes(context: AppContext): FastifyPluginAsync {
  const secureCookies = context.env.publicUrl.startsWith('https://');

  return async (app) => {
    app.addHook('preHandler', requireAdmin);

    app.get('/status', async (_request, reply) => {
      const connection = context.drive.connection;
      const status: AdminStatus = {
        driveConnected: context.drive.connected,
        driveAccount: connection?.account ?? null,
        driveRevokedAt: connection?.revokedAt ?? null,
        oauthConfigured: context.drive.configured,
        albums: context.albums.map((album) => buildAlbum(album, context.media, context.syncState)),
        cache: context.cache.stats(),
      };
      return reply.send(status);
    });

    /**
     * Démarre le consentement Google. Le `state` est tiré au hasard, déposé
     * dans un cookie signé et recomparé au retour : sans ça, un tiers pourrait
     * faire aboutir un callback avec un code obtenu ailleurs et connecter le
     * Drive de quelqu'un d'autre à cette instance.
     */
    app.get('/oauth/start', async (_request, reply) => {
      if (!context.drive.configured) {
        return reply.code(400).send({
          error: 'oauth_not_configured',
          message: new DriveNotConfiguredError().message,
        });
      }

      const state = randomBytes(24).toString('base64url');
      return reply
        .setCookie(OAUTH_STATE_COOKIE, state, {
          path: '/api',
          httpOnly: true,
          sameSite: 'lax',
          secure: secureCookies,
          maxAge: OAUTH_STATE_TTL_S,
          signed: true,
        })
        .send({ url: context.drive.authUrl(state) });
    });

    app.post('/drive/disconnect', async (_request, reply) => {
      context.drive.disconnect();
      return reply.send({ ok: true });
    });

    app.post('/resync', async (request, reply) => {
      const parsed = resyncSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'bad_request', message: 'Paramètres invalides' });
      }

      if (!context.drive.connected) {
        return reply.code(503).send({
          error: 'drive_disconnected',
          message: 'Connecte Google Drive avant de lancer une synchronisation.',
        });
      }

      const targets = parsed.data.albumId
        ? context.albums.filter((album) => album.id === parsed.data.albumId)
        : context.albums;

      if (targets.length === 0) {
        return reply.code(404).send({ error: 'not_found', message: 'Album introuvable' });
      }

      // La sync tourne en tâche de fond : sur un gros album elle dépasse
      // largement le timeout d'une requête HTTP. L'avancement se suit via
      // `syncStatus` dans /status.
      void context.syncer.syncAll(targets).catch((error: unknown) => {
        request.log.error({ err: error }, 'Synchronisation en échec');
      });

      return reply.code(202).send({ started: targets.map((album) => album.id) });
    });

    app.post('/reload', async (_request, reply) => {
      try {
        const config = context.reloadConfig();
        return reply.send({
          ok: true,
          users: config.users.length,
          albums: config.albums.length,
        });
      } catch (error) {
        // La config précédente reste active : on renvoie l'erreur de parsing
        // telle quelle, c'est exactement ce qu'il faut corriger dans le YAML.
        return reply.code(400).send({ error: 'invalid_config', message: (error as Error).message });
      }
    });

    app.post('/cache/clear', async (_request, reply) => {
      await context.cache.clear();
      return reply.send({ ok: true });
    });
  };
}

/**
 * Callback OAuth. Monté hors du préfixe `/admin` parce que son URL est figée
 * dans la console Google — mais il exige la même session administrateur.
 */
export function createOAuthCallbackRoute(context: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.get('/callback', { preHandler: requireAdmin }, async (request, reply) => {
      const query = request.query as { code?: string; state?: string; error?: string };

      if (query.error) {
        return reply.redirect(`/admin?oauth=denied`);
      }
      if (!query.code || !query.state) {
        return reply.redirect(`/admin?oauth=invalid`);
      }

      const cookie = request.cookies[OAUTH_STATE_COOKIE];
      const unsigned = cookie ? request.unsignCookie(cookie) : null;
      if (!unsigned?.valid || unsigned.value !== query.state) {
        request.log.warn('State OAuth invalide, callback rejeté');
        return reply.redirect(`/admin?oauth=state_mismatch`);
      }

      reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/api' });

      try {
        await context.drive.completeAuth(query.code);
      } catch (error) {
        request.log.error({ err: error }, 'Connexion Drive en échec');
        return reply.redirect(`/admin?oauth=error`);
      }

      // Première connexion : l'index est vide, autant le remplir sans attendre
      // que l'administrateur clique sur « resynchroniser ».
      void context.syncer.syncAll(context.albums).catch((error: unknown) => {
        request.log.error({ err: error }, 'Synchronisation initiale en échec');
      });

      return reply.redirect(`/admin?oauth=connected`);
    });
  };
}
