import { ALBUM_ID_PATTERN, EMAIL_MAX_LENGTH, USERNAME_MAX_LENGTH } from '@gdv/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { verifyAlbumUnsubscribeToken } from '../crypto.js';
import { escapeHtml } from '../mail.js';

const unsubscribeSchema = z.object({
  // L'adresse : c'est elle qui identifie une personne, la clé d'accès pouvant
  // être partagée par plusieurs.
  u: z.string().min(1).max(EMAIL_MAX_LENGTH),
  // Même contrainte qu'à la création d'un album (`routes/admin.ts`) : un id
  // hors motif ne peut désigner aucun album de cette instance.
  a: z.string().min(1).max(USERNAME_MAX_LENGTH).regex(ALBUM_ID_PATTERN),
  t: z.string().min(1).max(256),
});

/**
 * Abonnements aux nouveautés d'un album.
 *
 * On ne s'abonne pas ici : l'abonnement est un effet de bord de l'ouverture de
 * l'album, sur la première page de `GET /api/albums/:albumId/items` (D41). Ce
 * préfixe ne porte donc que le désabonnement, qui a besoin d'exister sans
 * session — et c'est aussi la raison de ne pas le monter sous `/api/albums`,
 * dont tout le préfixe exige `requireAuth`.
 */
export function createSubscriptionRoutes(context: AppContext): FastifyPluginAsync {
  return async (app) => {
    /**
     * Sans session, comme le désabonnement des commentaires : on clique ce lien
     * depuis sa boîte aux lettres, souvent sur un autre appareil, et exiger une
     * connexion pour cesser d'être dérangé serait une façon de ne pas répondre
     * à la demande.
     */
    app.get('/unsubscribe', async (request, reply) => {
      const parsed = unsubscribeSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'bad_request', message: 'Lien incomplet' });
      }

      const { u: email, a: albumId, t: token } = parsed.data;
      // Le jeton couvre le couple : celui d'un album ne vaut pas pour un autre,
      // sinon un lien recopié couperait un abonnement qu'on n'a pas visé.
      if (!verifyAlbumUnsubscribeToken(email, albumId, token, context.env.sessionSecret)) {
        return reply.code(400).send({ error: 'bad_request', message: 'Lien invalide' });
      }

      const commenter = context.commenters.byEmail(email);
      const album = context.findAlbum(albumId);
      // Identité ou album disparus depuis l'envoi : le désabonnement est sans
      // objet, et le dire évite de laisser croire à un échec.
      if (commenter && album) context.subscriptions.unsubscribe(commenter.id, albumId);

      return reply
        .type('text/html; charset=utf-8')
        .send(unsubscribePage(context.env.publicUrl, album?.title ?? null));
    });
  };
}

/**
 * Page de confirmation, rendue par le serveur plutôt que par le front : on
 * arrive ici sans session, et charger l'application React pour afficher une
 * phrase renverrait vers l'écran de connexion.
 */
function unsubscribePage(publicUrl: string, albumTitle: string | null): string {
  const message = albumTitle
    ? `Tu ne recevras plus d’email quand de nouvelles photos arriveront dans «&nbsp;${escapeHtml(albumTitle)}&nbsp;».`
    : 'Cet album ou ce compte n’existe plus : il n’y a rien à désabonner.';

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
      Les réponses à tes commentaires, elles, continuent d’arriver : elles se
      coupent depuis le lien d’un de ces emails.
      <br>
      <a href="${publicUrl}" style="color: #2563eb;">Retour à la galerie</a>
    </p>
  </body>
</html>`;
}

/**
 * Le titre d'un album est saisi depuis /admin : il traverse cette fonction
 * avant d'entrer dans la page, sinon un titre contenant une balise
 * s'exécuterait dans le navigateur de celui qui se désabonne.
 */
