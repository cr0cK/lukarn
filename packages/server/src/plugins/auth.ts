import type { SessionUser } from '@gdv/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { toIdentity } from '../commenters.js';
import type { AppContext } from '../context.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Clé d'accès authentifiée, ou `null` si la requête est anonyme. */
    user: SessionUser | null;
    sessionId: string | null;
    /**
     * Identité de commentateur portée par la session, `null` si personne ne
     * s'est déclaré. Distincte de `user` : le même identifiant peut être
     * partagé, chaque personne signe de son nom.
     */
    commenterId: number | null;
  }
}

/**
 * Résout la session à chaque requête. Ne rejette rien : ce sont les
 * `preHandler` ci-dessous qui décident si une route tolère l'anonymat.
 */
const authPlugin: FastifyPluginAsync<{ context: AppContext }> = async (app, { context }) => {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);
  app.decorateRequest('commenterId', null);

  app.addHook('onRequest', async (request, reply) => {
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

    // L'identité est relue à chaque requête plutôt que figée à la connexion :
    // une adresse effacée depuis un autre appareil doit retirer le droit de
    // commenter sans attendre une reconnexion — la session dure un an.
    const commenter =
      session.commenterId === null ? null : context.commenters.byId(session.commenterId);
    // Identité supprimée entre-temps : on délie plutôt que de garder un
    // identifiant qui ne désigne plus rien.
    if (session.commenterId !== null && !commenter) {
      context.sessions.attachCommenter(session.id, null);
    }

    // La base vient de repousser l'échéance : le cookie doit suivre. Il porte
    // sa propre date d'expiration, que le navigateur applique sans rien savoir
    // de la base — sans cette réémission, un visiteur assidu se retrouverait
    // déconnecté un an après sa connexion, et la prolongation ne servirait à
    // rien qu'à faire grossir `sessions`.
    if (session.renewed) {
      void reply.setCookie(
        SESSION_COOKIE,
        session.id,
        sessionCookieOptions(context.env.publicUrl, context.sessions.ttlMs),
      );
    }

    request.sessionId = session.id;
    request.commenterId = commenter?.id ?? null;
    request.user = {
      username: configured.username,
      admin: configured.admin,
      identity: commenter ? toIdentity(commenter) : null,
      commentsEnabled: context.mailer.enabled,
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
