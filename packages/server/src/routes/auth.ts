import argon2 from 'argon2';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../sessions.js';

/**
 * Hash jetable comparé lorsqu'aucun utilisateur ne correspond au login fourni.
 * Sans lui, un login inexistant répondrait bien plus vite qu'un mot de passe
 * faux, ce qui permettrait d'énumérer les comptes au chronomètre.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$P7YCCBMU6F1LYwExogSfjg$aGZdlIPlbgzTX9FhZKWXQp0G86Yl6A4MuXfFmVgZ868';

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(512),
});

export function createAuthRoutes(context: AppContext): FastifyPluginAsync {
  const throttle = context.throttle;

  return async (app) => {
    app.post('/login', async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'Identifiant et mot de passe requis' });
      }

      const { username, password } = parsed.data;
      const attempt = { ip: request.ip, username };

      const retryAfter = throttle.blockedFor(attempt);
      if (retryAfter > 0) {
        return reply
          .code(429)
          .header('Retry-After', String(Math.ceil(retryAfter / 1000)))
          .send({
            error: 'too_many_attempts',
            message: `Trop de tentatives. Réessaie dans ${Math.ceil(retryAfter / 1000)} s.`,
          });
      }

      const user = context.config.user(username);
      let valid = false;
      try {
        valid = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, password);
      } catch {
        // Empreinte illisible en base : traitée comme un échec, pas comme un 500.
        valid = false;
      }

      if (!user || !valid) {
        throttle.fail(attempt);
        request.log.warn({ username, ip: request.ip }, 'Échec de connexion');
        return reply
          .code(401)
          .send({ error: 'invalid_credentials', message: 'Identifiant ou mot de passe incorrect' });
      }

      throttle.succeed(attempt);
      const session = context.sessions.create(user.username);

      return reply
        .setCookie(
          SESSION_COOKIE,
          session.id,
          sessionCookieOptions(context.env.publicUrl, context.sessions.ttlMs),
        )
        .send({
          username: user.username,
          admin: user.admin,
          // Une connexion fraîche ne porte aucune identité : elle se déclare
          // ensuite, et vaut pour la personne, pas pour la clé d'accès.
          identity: null,
          commentsEnabled: context.mailer.enabled,
        });
    });

    app.post('/logout', async (request, reply) => {
      if (request.sessionId) context.sessions.destroy(request.sessionId);
      return reply.clearCookie(SESSION_COOKIE, { path: '/' }).send({ ok: true });
    });

    app.get('/me', async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'unauthorized', message: 'Non connecté' });
      }
      return reply.send(request.user);
    });

    /**
     * Une installation dont la base ne contient aucun compte accepte les
     * requêtes mais refuse toute connexion : l'application paraît cassée alors
     * qu'il manque seulement `pnpm create-admin`. Le seul indice était une
     * ligne dans les journaux, que personne ne lit avant d'avoir un problème.
     *
     * Route publique : sur une instance sans aucun compte, il n'y a rien à
     * protéger, et l'écran de connexion doit pouvoir le dire avant qu'on ait
     * saisi quoi que ce soit.
     */
    app.get('/setup-state', async (_request, reply) =>
      reply.send({ needsSetup: context.config.users().length === 0 }),
    );
  };
}
