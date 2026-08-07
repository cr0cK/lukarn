import {
  COMMENT_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  type AlbumCommentCounts,
  type Comment,
  type CommentsPage,
} from '@gdv/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { EditWindowClosedError, UnknownParentError } from '../comments.js';
import type { AppContext } from '../context.js';
import { verifyUnsubscribeToken } from '../crypto.js';
import { buildCommentMail, type Recipient } from '../mail.js';
import { requireAuth } from '../plugins/auth.js';

const createSchema = z.object({
  // `trim` avant la borne basse : un commentaire de trois espaces est vide.
  body: z.string().trim().min(1).max(COMMENT_MAX_LENGTH),
  parentId: z.number().int().positive().nullable().optional(),
});

// Une correction ne déplace pas le message dans le fil : `parentId` n'est pas
// acceptée ici, sans quoi corriger une faute de frappe permettrait de changer
// de conversation.
const updateSchema = createSchema.pick({ body: true });

const unsubscribeSchema = z.object({
  // L'adresse elle-même : c'est elle qui identifie une personne, le compte
  // d'accès pouvant être partagé par plusieurs.
  u: z.string().min(1).max(EMAIL_MAX_LENGTH),
  t: z.string().min(1).max(256),
});

/**
 * Commentaires : compteurs d'un album, lecture et écriture d'un fil, correction,
 * suppression, désabonnement.
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

      const { u: email, t: token } = parsed.data;
      if (!verifyUnsubscribeToken(email, token, context.env.sessionSecret)) {
        return reply.code(400).send({ error: 'bad_request', message: 'Lien invalide ou expiré' });
      }

      const commenter = context.commenters.byEmail(email);
      // Identité disparue depuis l'envoi : le désabonnement est sans objet, et
      // le dire évite de laisser croire à un échec.
      if (commenter) context.commenters.setNotify(commenter.id, false);

      return reply
        .type('text/html; charset=utf-8')
        .send(unsubscribePage(context.env.publicUrl, Boolean(commenter)));
    });

    await app.register(async (scoped) => {
      scoped.addHook('preHandler', requireAuth);

      /**
       * Compteurs de l'album entier, pour la pastille de la visionneuse.
       *
       * Un appel par album, et non un par photo : la pastille doit être là dès
       * qu'on atteint une photo, or parcourir un album à la flèche traverse des
       * centaines de vues. Le fil lui-même reste chargé à l'ouverture du
       * panneau.
       *
       * Cette route paramétrique ne masque pas `/unsubscribe`, déclaré hors du
       * scope authentifié : la table de routage de Fastify fait toujours passer
       * un segment littéral avant un paramètre. C'est vérifié par un test —
       * l'inverse rendrait le lien de désabonnement des emails déjà envoyés
       * impossible à honorer.
       */
      scoped.get('/:albumId', async (request, reply) => {
        const { albumId } = request.params as { albumId: string };
        const account = request.user!;
        if (!context.findAlbum(albumId) || !context.canSee(account.username, albumId)) {
          return reply.code(404).send({ error: 'not_found', message: 'Album introuvable' });
        }

        const counts: AlbumCommentCounts = { counts: context.comments.countsByAlbum(albumId) };
        return reply.send(counts);
      });

      scoped.get('/:albumId/:mediaId', async (request, reply) => {
        const { albumId, mediaId } = request.params as { albumId: string; mediaId: string };
        const account = request.user!;
        if (!context.findAlbum(albumId) || !context.canSee(account.username, albumId)) {
          return reply.code(404).send({ error: 'not_found', message: 'Album introuvable' });
        }

        const page: CommentsPage = context.comments.thread(albumId, mediaId, {
          commenterId: request.commenterId,
          admin: account.admin,
        });
        return reply.send(page);
      });

      scoped.post('/:albumId/:mediaId', async (request, reply) => {
        const { albumId, mediaId } = request.params as { albumId: string; mediaId: string };
        const account = request.user!;
        const album = context.findAlbum(albumId);
        if (!album || !context.canSee(account.username, albumId)) {
          return reply.code(404).send({ error: 'not_found', message: 'Album introuvable' });
        }

        // Commenter suppose une identité vérifiée. Ce 403 est la seconde
        // exception assumée au « 404 et jamais 403 » de D12 : il ne porte pas
        // sur une ressource d'autrui dont il faudrait cacher l'existence, mais
        // sur l'état de son propre compte — il ne révèle donc rien.
        const commenterId = request.commenterId;
        if (commenterId === null) {
          return reply.code(403).send({
            error: 'identity_required',
            message: 'Renseigne et vérifie ton adresse email pour pouvoir commenter.',
          });
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
            commenterId,
            account: account.username,
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
          commenterId,
          albumId,
          albumTitle: album.title,
          mediaId,
          mediaName: detail.name,
        });

        return reply.code(201).send(comment);
      });

      /**
       * Correction par son auteur, dans la fenêtre qui suit la publication.
       *
       * La fenêtre est contrôlée **ici** et pas seulement dans l'interface :
       * une règle que seul le front applique n'est pas une règle. Un délai
       * dépassé rend 409 et non 403 — le refus porte sur l'état du message, pas
       * sur un droit d'accès, et le doctrine du 404 (D12) ne s'y applique donc
       * pas : l'auteur voit déjà son propre commentaire.
       */
      scoped.patch('/:commentId', async (request, reply) => {
        const { commentId } = request.params as { commentId: string };
        const id = Number(commentId);
        if (!Number.isInteger(id) || id <= 0) {
          return reply.code(400).send({ error: 'bad_request', message: 'Identifiant invalide' });
        }

        const parsed = updateSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({
            error: 'bad_request',
            message: `Le commentaire doit contenir entre 1 et ${COMMENT_MAX_LENGTH} caractères.`,
          });
        }

        // Même garde que la suppression : un accès retiré ne doit pas laisser
        // subsister un droit d'écriture sur un album qu'on ne voit plus.
        const account = request.user!;
        const location = context.comments.locate(id);
        if (!location || !context.canSee(account.username, location.albumId)) {
          return reply.code(404).send({ error: 'not_found', message: 'Commentaire introuvable' });
        }

        let comment: Comment | null;
        try {
          comment = context.comments.edit(
            id,
            { commenterId: request.commenterId, admin: account.admin },
            parsed.data.body,
          );
        } catch (error) {
          if (error instanceof EditWindowClosedError) {
            return reply.code(409).send({ error: 'edit_window_closed', message: error.message });
          }
          throw error;
        }

        if (!comment) {
          return reply.code(404).send({ error: 'not_found', message: 'Commentaire introuvable' });
        }
        return reply.send(comment);
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

        const account = request.user!;
        // On ne peut supprimer que dans un album qu'on voit encore : sans ce
        // contrôle, un accès retiré laisserait subsister un droit d'écriture.
        const location = context.comments.locate(id);
        if (!location || (!account.admin && !context.canSee(account.username, location.albumId))) {
          return reply.code(404).send({ error: 'not_found', message: 'Commentaire introuvable' });
        }

        if (
          !context.comments.remove(id, { commenterId: request.commenterId, admin: account.admin })
        ) {
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
    commenterId: number;
    albumId: string;
    albumTitle: string;
    mediaId: string;
    mediaName: string;
  },
): void {
  if (!context.mailer.enabled) return;

  const recipients: Recipient[] = [];

  // L'adresse de modération est un réglage d'instance : un compte administrateur
  // est une clé d'accès, pas quelqu'un de joignable.
  const moderation = context.settings.moderationEmail;
  if (moderation) recipients.push({ email: moderation, reason: 'moderation' });

  // Réponse : l'auteur de la racine du fil, jamais celui qui vient d'écrire.
  if (input.comment.parentId !== null) {
    const author = context.commenters.recipientForReply(input.comment.parentId, input.commenterId);
    if (author) recipients.push({ email: author.email, reason: 'reply' });
  }

  for (const recipient of recipients) {
    context.mailer.queue(
      buildCommentMail(
        {
          albumId: input.albumId,
          albumTitle: input.albumTitle,
          mediaId: input.mediaId,
          mediaName: input.mediaName,
          authorDisplayName: input.comment.author.displayName,
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
