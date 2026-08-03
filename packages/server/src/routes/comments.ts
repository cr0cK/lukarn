import { COMMENT_MAX_LENGTH, type Comment, type CommentsPage } from '@gdv/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { UnknownParentError } from '../comments.js';
import type { AppContext } from '../context.js';
import { verifyUnsubscribeToken } from '../crypto.js';
import { buildCommentMail } from '../mail.js';
import { requireAuth } from '../plugins/auth.js';

const createSchema = z.object({
  // `trim` avant la borne basse : un commentaire de trois espaces est vide.
  body: z.string().trim().min(1).max(COMMENT_MAX_LENGTH),
  parentId: z.number().int().positive().nullable().optional(),
});

const unsubscribeSchema = z.object({
  u: z.string().min(1).max(64),
  t: z.string().min(1).max(256),
});

/**
 * Commentaires : lecture et écriture d'un fil, suppression, désabonnement.
 *
 * L'accès suit exactement celui des albums : un album qu'on n'a pas le droit de
 * voir répond 404, jamais 403 — sans quoi sonder des identifiants apprendrait
 * l'existence des albums d'autrui (D12). Le contrôle est refait à chaque route
 * plutôt que délégué à un `preHandler` de préfixe : ici l'album n'est pas dans
 * un segment fixe de l'URL comme il l'est pour les médias.
 */
export function createCommentRoutes(context: AppContext): FastifyPluginAsync {
  return async (app) => {
    /**
     * Le désabonnement est volontairement hors du scope authentifié ci-dessous :
     * on clique ce lien depuis sa boîte aux lettres, souvent sur un autre
     * appareil, et exiger une connexion pour cesser d'être dérangé serait une
     * façon de ne pas répondre à la demande.
     */
    app.get('/unsubscribe', async (request, reply) => {
      const parsed = unsubscribeSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'bad_request', message: 'Lien incomplet' });
      }

      const { u: username, t: token } = parsed.data;
      if (!verifyUnsubscribeToken(username, token, context.env.sessionSecret)) {
        return reply.code(400).send({ error: 'bad_request', message: 'Lien invalide ou expiré' });
      }

      const user = context.config.user(username);
      // Compte supprimé depuis l'envoi : le désabonnement est sans objet, et le
      // dire évite de laisser croire à un échec.
      if (user) context.config.updateUser(user.username, { notify: false });

      return reply
        .type('text/html; charset=utf-8')
        .send(unsubscribePage(context.env.publicUrl, Boolean(user)));
    });

    await app.register(async (scoped) => {
      scoped.addHook('preHandler', requireAuth);

      scoped.get('/:albumId/:mediaId', async (request, reply) => {
        const { albumId, mediaId } = request.params as { albumId: string; mediaId: string };
        const viewer = request.user!;
        if (!context.findAlbum(albumId) || !context.canSee(viewer.username, albumId)) {
          return reply.code(404).send({ error: 'not_found', message: 'Album introuvable' });
        }

        const page: CommentsPage = context.comments.thread(albumId, mediaId, viewer);
        return reply.send(page);
      });

      scoped.post('/:albumId/:mediaId', async (request, reply) => {
        const { albumId, mediaId } = request.params as { albumId: string; mediaId: string };
        const viewer = request.user!;
        const album = context.findAlbum(albumId);
        if (!album || !context.canSee(viewer.username, albumId)) {
          return reply.code(404).send({ error: 'not_found', message: 'Album introuvable' });
        }

        // Commenter une photo absente de l'index n'aurait pas de sens, et
        // laisserait des fils que la modération afficherait sans nom de fichier.
        const detail = context.media.getDetail(albumId, mediaId);
        if (!detail) {
          return reply.code(404).send({ error: 'not_found', message: 'Média introuvable' });
        }

        const parsed = createSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({
            error: 'bad_request',
            message: `Le commentaire doit contenir entre 1 et ${COMMENT_MAX_LENGTH} caractères.`,
          });
        }

        let comment: Comment;
        try {
          comment = context.comments.create({
            albumId,
            mediaId,
            username: viewer.username,
            body: parsed.data.body,
            parentId: parsed.data.parentId ?? null,
          });
        } catch (error) {
          if (error instanceof UnknownParentError) {
            return reply.code(404).send({ error: 'not_found', message: error.message });
          }
          throw error;
        }

        notify(context, {
          comment,
          albumId,
          albumTitle: album.title,
          mediaId,
          mediaName: detail.name,
          authorDisplayName: comment.author.displayName,
        });

        return reply.code(201).send(comment);
      });

      /**
       * Suppression par l'auteur, ou par un administrateur depuis la file de
       * modération. Le dépôt tranche ; un refus est indistinguable d'un
       * identifiant inexistant, pour la raison qui vaut partout ailleurs.
       */
      scoped.delete('/:commentId', async (request, reply) => {
        const { commentId } = request.params as { commentId: string };
        const id = Number(commentId);
        if (!Number.isInteger(id) || id <= 0) {
          return reply.code(400).send({ error: 'bad_request', message: 'Identifiant invalide' });
        }

        const viewer = request.user!;
        // Un visiteur ne peut supprimer que dans un album qu'il voit : sans ce
        // contrôle, il pourrait effacer ses propres commentaires dans un album
        // dont l'accès vient de lui être retiré.
        const location = context.comments.locate(id);
        if (!location || (!viewer.admin && !context.canSee(viewer.username, location.albumId))) {
          return reply.code(404).send({ error: 'not_found', message: 'Commentaire introuvable' });
        }

        if (!context.comments.remove(id, viewer)) {
          return reply.code(404).send({ error: 'not_found', message: 'Commentaire introuvable' });
        }
        return reply.code(204).send();
      });
    });
  };
}

/**
 * Met en file les notifications d'un nouveau commentaire. Hors du chemin de la
 * réponse : l'auteur voit son message publié sans attendre le serveur SMTP.
 */
function notify(
  context: AppContext,
  input: {
    comment: Comment;
    albumId: string;
    albumTitle: string;
    mediaId: string;
    mediaName: string;
    authorDisplayName: string;
  },
): void {
  if (!context.mailer.enabled) return;

  const recipients = context.comments.recipientsFor({
    id: input.comment.id,
    parentId: input.comment.parentId,
    username: input.comment.author.username,
  });

  for (const recipient of recipients) {
    context.mailer.queue(
      buildCommentMail(
        {
          albumId: input.albumId,
          albumTitle: input.albumTitle,
          mediaId: input.mediaId,
          mediaName: input.mediaName,
          authorDisplayName: input.authorDisplayName,
          body: input.comment.body,
        },
        recipient,
        context.env,
      ),
    );
  }
}

/**
 * Page de confirmation du désabonnement, rendue par le serveur plutôt que par
 * le front : on arrive ici sans session, et charger l'application React pour
 * afficher une phrase renverrait vers l'écran de connexion.
 */
function unsubscribePage(publicUrl: string, found: boolean): string {
  const message = found
    ? 'Tu ne recevras plus d’email lors d’un nouveau commentaire.'
    : 'Ce compte n’existe plus : il n’y a rien à désabonner.';

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Désabonnement</title>
  </head>
  <body style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; max-width: 34rem; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.6; color: #1a1a1a;">
    <h1 style="font-size: 1.25rem; margin: 0 0 1rem;">C’est fait</h1>
    <p style="margin: 0 0 1.5rem;">${message}</p>
    <p style="margin: 0; font-size: 0.9rem; color: #666;">
      Pour les réactiver, demande-le à l’administrateur de l’instance.
      <br>
      <a href="${publicUrl}" style="color: #2563eb;">Retour à la galerie</a>
    </p>
  </body>
</html>`;
}
