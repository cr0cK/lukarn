import argon2 from 'argon2';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { SESSION_COOKIE } from '../sessions.js';
import { LoginThrottle } from '../throttle.js';

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
  const throttle = new LoginThrottle();

  return async (app) => {
    app.post('/login', async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'Identifiant et mot de passe requis' });
      }

      const { username, password } = parsed.data;
      const throttleKey = `${request.ip}:${username.toLowerCase()}`;

      const retryAfter = throttle.blockedFor(throttleKey);
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
        throttle.fail(throttleKey);
        request.log.warn({ username, ip: request.ip }, 'Échec de connexion');
        return reply
          .code(401)
          .send({ error: 'invalid_credentials', message: 'Identifiant ou mot de passe incorrect' });
      }

      throttle.succeed(throttleKey);
      const session = context.sessions.create(user.username);

      return reply
        .setCookie(SESSION_COOKIE, session.id, {
          path: '/',
          httpOnly: true,
          // `lax` laisse passer la navigation entrante (retour du callback
          // OAuth) tout en bloquant les requêtes cross-site déclenchées par un
          // tiers.
          sameSite: 'lax',
          // En HTTP local le cookie `secure` ne serait jamais renvoyé.
          secure: context.env.publicUrl.startsWith('https://'),
          maxAge: Math.floor(context.sessions.ttlMs / 1000),
          signed: true,
        })
        .send({ username: user.username, admin: user.admin });
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
  };
}
