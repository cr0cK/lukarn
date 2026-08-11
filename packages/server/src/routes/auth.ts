import { USER_CODE_LENGTH, normalizeUserCode } from '@nonni/shared';
import argon2 from 'argon2';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { classifyDevice } from '../device.js';
import { requireAuth } from '../plugins/auth.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../sessions.js';

/**
 * Hash jetable comparé lorsqu'aucun utilisateur ne correspond au login fourni.
 * Sans lui, un login inexistant répondrait bien plus vite qu'un mot de passe
 * faux, ce qui permettrait d'énumérer les comptes au chronomètre.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$P7YCCBMU6F1LYwExogSfjg$aGZdlIPlbgzTX9FhZKWXQp0G86Yl6A4MuXfFmVgZ868';

/**
 * L'identifiant est replié avant tout : `USERNAME_PATTERN` n'admet aucun espace,
 * donc aucun compte n'en porte, et une espace de bord ne vient que du clavier
 * mobile ou d'un copier-coller. La refuser ferait échouer une saisie juste sans
 * pouvoir le dire — le message doit rester le même que pour un mot de passe
 * faux. Le mot de passe, lui, n'est pas touché : il a le droit d'en contenir.
 */
const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(512),
});

/** Le `deviceCode` fait 43 caractères en base64url ; la borne laisse de la marge. */
const pollSchema = z.object({ deviceCode: z.string().min(1).max(128) });

/** Le code affiché, une fois replié : huit caractères de l'alphabet sans ambiguïté. */
const USER_CODE_PATTERN = new RegExp(`^[A-HJ-NP-Z2-9]{${USER_CODE_LENGTH}}$`);

export function createAuthRoutes(context: AppContext): FastifyPluginAsync {
  const throttle = context.throttle;

  return async (app) => {
    app.post('/login', async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'Username and password required' });
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
          .send({ error: 'invalid_credentials', message: 'Incorrect username or password' });
      }

      throttle.succeed(attempt);
      // La classe d'appareil est lue ici et nulle part ailleurs : le user-agent
      // sert à la déduire puis est jeté, seule la classe est stockée (D260809h).
      const session = context.sessions.create(
        user.username,
        classifyDevice(request.headers['user-agent']),
      );

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
        return reply.code(401).send({ error: 'unauthorized', message: 'Not signed in' });
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

    /* ------------------------------------------------------------------------
     * Appairage d'un écran sans clavier (D260809c)
     *
     * Un téléviseur n'a pas de caméra : c'est lui qui affiche le QR, et un
     * téléphone déjà connecté qui le scanne. L'appairage délègue donc un accès
     * existant, il n'en crée aucun.
     * --------------------------------------------------------------------- */

    /**
     * Ouvre une demande. Publique, et elle doit l'être : c'est le premier geste
     * d'un écran qui n'a pas de session. Elle ne divulgue rien — un code tiré au
     * sort, et un secret que seul son destinataire reçoit.
     */
    app.post('/device/start', async (_request, reply) => {
      const started = context.pairings.start();
      if (!started) {
        // La borne est atteinte : la table est en base, et une rafale de
        // demandes ne doit pas la faire grossir sans fin. Personne n'y gagne un
        // accès, l'appairage devient seulement indisponible le temps que les
        // demandes en cours expirent.
        return reply.code(429).header('Retry-After', '60').send({
          error: 'too_many_pairings',
          message: 'Too many requests in flight. Try again in a minute.',
        });
      }
      return noStore(reply).send(started);
    });

    /**
     * Le sondage de l'écran. POST et non GET : la réponse pose un cookie, et le
     * `deviceCode` n'a rien à faire dans une URL — journaux d'accès, historique
     * et `Referer` la gardent.
     */
    app.post('/device/poll', async (request, reply) => {
      const parsed = pollSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'bad_request', message: "Code d'appareil requis" });
      }

      const { deviceCode } = parsed.data;
      const attempt = { ip: request.ip, username: deviceCode };
      const blocked = blockedReply(reply, throttle.blockedFor(attempt));
      if (blocked) return blocked;

      const claimed = context.pairings.claim(deviceCode);
      if (claimed.status === 'pending') {
        return noStore(reply).code(202).send({ status: 'pending' });
      }
      if (claimed.status === 'unknown') {
        throttle.fail(attempt);
        return noStore(reply).code(404).send(UNKNOWN_CODE);
      }

      // La configuration fait autorité, comme pour toute session : un compte
      // supprimé entre l'approbation et la relève n'ouvre rien. La clé
      // étrangère `ON DELETE CASCADE` couvre déjà le cas ; cette vérification
      // couvre celui d'un compte disparu autrement.
      const user = context.config.user(claimed.username);
      if (!user) {
        throttle.fail(attempt);
        return noStore(reply).code(404).send(UNKNOWN_CODE);
      }

      throttle.succeed(attempt);
      // Le user-agent est celui de l'écran qui sonde, pas du téléphone qui a
      // approuvé : c'est bien le téléviseur qu'on veut compter comme tel.
      const session = context.sessions.create(
        user.username,
        classifyDevice(request.headers['user-agent']),
      );
      request.log.info({ username: user.username }, 'Screen paired');

      return noStore(reply)
        .setCookie(
          SESSION_COOKIE,
          session.id,
          sessionCookieOptions(context.env.publicUrl, context.sessions.ttlMs),
        )
        .send({
          status: 'approved',
          user: {
            username: user.username,
            admin: user.admin,
            // L'écran appairé arrive sans identité, comme après une connexion
            // au mot de passe : elle vaut pour la personne, pas pour la clé
            // d'accès. Sans cette règle, le téléviseur du salon signerait du
            // nom de celui qui a approuvé.
            identity: null,
            commentsEnabled: context.mailer.enabled,
          },
        });
    });

    /** Ce que le téléphone affiche avant d'approuver. */
    app.get<{ Params: { userCode: string } }>(
      '/device/:userCode',
      { preHandler: requireAuth },
      async (request, reply) => {
        const userCode = normalizeUserCode(request.params.userCode);
        const attempt = { ip: request.ip, username: userCode };
        const blocked = blockedReply(reply, throttle.blockedFor(attempt));
        if (blocked) return blocked;

        const pairing = USER_CODE_PATTERN.test(userCode) ? context.pairings.find(userCode) : null;
        if (!pairing) {
          throttle.fail(attempt);
          return noStore(reply).code(404).send(UNKNOWN_CODE);
        }

        return noStore(reply).send({
          userCode: pairing.userCode,
          expiresAt: pairing.expiresAt,
          // Une demande déjà approuvée n'est pas une erreur : c'est ce qui
          // permet de dire « c'est fait » à qui rouvre la page, au lieu de
          // « ce code n'existe pas ».
          approved: pairing.username !== null,
        });
      },
    );

    /**
     * L'approbation. Elle inscrit qui approuve, et rien de plus : c'est le
     * sondage qui crée la session, sinon un écran éteint entre-temps laisserait
     * derrière lui une session d'un an que personne n'a ouverte.
     */
    app.post<{ Params: { userCode: string } }>(
      '/device/:userCode/approve',
      { preHandler: requireAuth },
      async (request, reply) => {
        const userCode = normalizeUserCode(request.params.userCode);
        const attempt = { ip: request.ip, username: userCode };
        const blocked = blockedReply(reply, throttle.blockedFor(attempt));
        if (blocked) return blocked;

        const result = USER_CODE_PATTERN.test(userCode)
          ? context.pairings.approve(userCode, request.user!.username)
          : 'unknown';

        if (result === 'unknown') {
          throttle.fail(attempt);
          return noStore(reply).code(404).send(UNKNOWN_CODE);
        }
        if (result === 'taken') {
          // 409 et non 404 : le refus porte sur l'état de la demande, pas sur
          // l'existence d'une ressource d'autrui qu'il faudrait cacher — celui
          // qui approuve tient le code sous les yeux.
          return noStore(reply).code(409).send({
            error: 'already_paired',
            message: 'This screen has already been paired by another account.',
          });
        }

        throttle.succeed(attempt);
        return noStore(reply).send({ ok: true });
      },
    );
  };
}

/**
 * Réponse commune à un code inconnu, expiré, déjà relevé ou mal formé.
 * Distinguer ces cas dirait à qui essaie des codes au hasard lesquels ont
 * existé.
 */
const UNKNOWN_CODE = {
  error: 'unknown_code',
  message: "Ce code n'est plus valide. Relance la connexion depuis l'écran.",
};

/**
 * Aucune réponse d'appairage ne doit être gardée : elles portent un secret, un
 * état qui change toutes les deux secondes, ou un cookie de session.
 */
function noStore(reply: FastifyReply): FastifyReply {
  return reply.header('Cache-Control', 'no-store');
}

/** Le 429 du throttle, ou `null` si la voie est libre. */
function blockedReply(reply: FastifyReply, retryAfterMs: number): FastifyReply | null {
  if (retryAfterMs <= 0) return null;
  const seconds = Math.ceil(retryAfterMs / 1000);
  return reply
    .code(429)
    .header('Retry-After', String(seconds))
    .send({
      error: 'too_many_attempts',
      message: `Trop de tentatives. Réessaie dans ${seconds} s.`,
    });
}
