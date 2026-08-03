import { EMAIL_MAX_LENGTH, VERIFICATION_CODE_LENGTH, type SessionUser } from '@gdv/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { toIdentity } from '../commenters.js';
import type { AppContext } from '../context.js';
import { buildVerificationMail } from '../mail.js';
import { requireAuth } from '../plugins/auth.js';

const requestSchema = z.object({
  email: z.string().trim().email('adresse invalide').max(EMAIL_MAX_LENGTH),
  displayName: z.string().trim().min(1, 'nom requis').max(64),
});

const verifySchema = z.object({
  email: z.string().trim().email().max(EMAIL_MAX_LENGTH),
  code: z.string().trim().length(VERIFICATION_CODE_LENGTH),
});

/**
 * Identité de commentateur : la déclarer, la vérifier, l'oublier.
 *
 * Ces routes séparent ce que l'application confondait : `users` est une clé
 * d'accès, potentiellement partagée par toute une famille, tandis qu'un
 * commentaire doit être signé par quelqu'un. L'adresse email joue ce rôle
 * d'identité, et elle est vérifiée par un code — sans quoi n'importe qui
 * derrière la clé partagée pourrait signer du nom d'un autre, ou faire arriver
 * les notifications dans la boîte d'un tiers.
 */
export function createIdentityRoutes(context: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAuth);

    /** Recompose la session telle que `/auth/me` la rend, après changement. */
    const sessionUser = (
      username: string,
      admin: boolean,
      commenterId: number | null,
    ): SessionUser => {
      const commenter = commenterId === null ? null : context.commenters.byId(commenterId);
      return {
        username,
        admin,
        identity: commenter ? toIdentity(commenter) : null,
        commentsEnabled: context.mailer.enabled,
      };
    };

    /**
     * Déclare une adresse et envoie le code. Répond toujours `202`, que
     * l'adresse soit déjà connue ou non : distinguer les deux dirait à qui veut
     * l'essayer quelles adresses ont déjà commenté sur cette instance.
     */
    app.post('/request-code', async (request, reply) => {
      if (!context.mailer.enabled) {
        return reply.code(503).send({
          error: 'mail_not_configured',
          message:
            "Cette galerie n'a pas de serveur d'envoi configuré : les commentaires sont " +
            'indisponibles.',
        });
      }

      const parsed = requestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'bad_request',
          message: parsed.error.issues[0]?.message ?? 'Adresse ou nom invalide',
        });
      }

      const { email, displayName } = parsed.data;
      const result = context.commenters.requestCode(email, displayName);

      if ('failure' in result) {
        const seconds = Math.ceil(result.retryAfterMs / 1000);
        return reply
          .code(429)
          .header('Retry-After', String(seconds))
          .send({
            error: 'too_soon',
            message: `Un code vient d'être envoyé. Réessaie dans ${seconds} s.`,
          });
      }

      context.mailer.queue(buildVerificationMail(email, displayName, result.code, context.env));
      request.log.info(
        `Code de vérification envoyé à une adresse depuis "${request.user!.username}"`,
      );

      return reply.code(202).send({ ok: true });
    });

    /**
     * Valide le code et rattache l'identité à la session. C'est le seul endroit
     * qui lie les deux : une identité non vérifiée n'est rattachée à rien.
     */
    app.post('/verify', async (request, reply) => {
      const parsed = verifySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'Code invalide — six chiffres attendus.' });
      }

      const result = context.commenters.verify(parsed.data.email, parsed.data.code);
      if ('failure' in result) {
        // Un code faux, expiré ou épuisé rendent le même message : détailler
        // lequel aide surtout celui qui essaie des codes au hasard.
        const message =
          result.failure === 'too_many_attempts'
            ? 'Trop de tentatives. Demande un nouveau code.'
            : 'Code incorrect ou expiré. Demande un nouveau code si besoin.';
        return reply.code(400).send({ error: result.failure, message });
      }

      context.sessions.attachCommenter(request.sessionId!, result.commenter.id);
      return reply.send(
        sessionUser(request.user!.username, request.user!.admin, result.commenter.id),
      );
    });

    /**
     * Oublie l'identité sur cette session. Les commentaires déjà écrits restent
     * en place, signés du nom sous lequel ils l'ont été : ils appartiennent à la
     * conversation, pas à l'appareil. Se ré-identifier avec la même adresse les
     * retrouve — et le droit de les supprimer avec.
     */
    app.post('/forget', async (request, reply) => {
      context.sessions.attachCommenter(request.sessionId!, null);
      return reply.send(sessionUser(request.user!.username, request.user!.admin, null));
    });
  };
}
