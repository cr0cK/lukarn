import type { SessionUser } from '@gdv/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AppContext } from '../context.js';
import { SESSION_COOKIE } from '../sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Utilisateur authentifié, ou `null` si la requête est anonyme. */
    user: SessionUser | null;
    sessionId: string | null;
  }
}

/**
 * Résout la session à chaque requête. Ne rejette rien : ce sont les
 * `preHandler` ci-dessous qui décident si une route tolère l'anonymat.
 */
const authPlugin: FastifyPluginAsync<{ context: AppContext }> = async (app, { context }) => {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.addHook('onRequest', async (request) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;

    // Cookie signé : une valeur trafiquée est écartée avant même de toucher la base.
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;

    const session = context.sessions.get(unsigned.value);
    if (!session) return;

    // La configuration en base fait autorité : un compte supprimé depuis
    // /admin perd l'accès immédiatement, même si sa session n'a pas expiré.
    // La lecture passe par le cache mémoire du dépôt, pas par SQLite.
    const configured = context.config.user(session.username);
    if (!configured) {
      context.sessions.destroy(session.id);
      return;
    }

    request.sessionId = session.id;
    request.user = {
      username: configured.username,
      admin: configured.admin,
      // Résolu ici plutôt qu'à l'affichage : le nom qui signe un commentaire
      // ne doit pas dépendre de l'écran qui le rend.
      displayName: configured.displayName?.trim() || configured.username,
    };
  });
};

export default fp(authPlugin, { name: 'auth', dependencies: ['@fastify/cookie'] });

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    await reply.code(401).send({ error: 'unauthorized', message: 'Authentification requise' });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    await reply.code(401).send({ error: 'unauthorized', message: 'Authentification requise' });
    return;
  }
  if (!request.user.admin) {
    await reply.code(403).send({ error: 'forbidden', message: 'Réservé aux administrateurs' });
  }
}
