import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Six mois. Assez long pour que la protection serve, assez court pour qu'une
 * instance qui perdrait son certificat redevienne joignable dans un délai
 * humain — un `max-age` de deux ans transforme une erreur de configuration TLS
 * en panne que le visiteur ne peut pas contourner depuis son navigateur.
 */
const HSTS_MAX_AGE = 15_552_000;

/**
 * Politique de sécurité du contenu.
 *
 * `script-src 'self'` est la directive qui compte : c'est elle qui rend
 * inexploitable un `<script>` glissé dans un titre d'album ou un commentaire.
 * Les autres ferment les portes voisines, et surtout elles verrouillent un
 * comportement par défaut du navigateur qu'on ne veut pas hériter demain.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // React écrit ses styles par la propriété `style` du DOM, que la CSP ne
  // filtre pas — mais Vite peut inliner une petite feuille au build, et une
  // CSP qui casse la mise en page à la première mise à jour de l'outillage
  // finit désactivée. Le style en ligne ne permet pas d'exécuter du code.
  "style-src 'self' 'unsafe-inline'",
  // Vite inline en `data:` les images de moins de 4 ko.
  "img-src 'self' data:",
  // Les vidéos sont relayées par `/api/media/:id/original`, même origine.
  "media-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  // Remplace `X-Frame-Options`, conservé à côté pour les navigateurs anciens.
  "frame-ancestors 'none'",
].join('; ');

export interface SecurityHeadersOptions {
  /** `PUBLIC_URL` : son schéma décide si `Strict-Transport-Security` est posé. */
  publicUrl: string;
}

/**
 * Pose les en-têtes de sécurité sur **toutes** les réponses — API, front,
 * médias, 404 et erreurs comprises.
 *
 * Le hook est `onRequest` plutôt qu'`onSend` : à ce stade aucune route n'a
 * encore répondu, donc aucune ne peut oublier les en-têtes, pas même celles que
 * `@fastify/static` sert sans passer par un gestionnaire à nous.
 */
const securityHeaders: FastifyPluginAsync<SecurityHeadersOptions> = async (app, { publicUrl }) => {
  // Poser HSTS sur une instance en HTTP condamnerait le navigateur à réclamer
  // du HTTPS à une origine qui n'en sert pas — `localhost` en développement,
  // le temps du `max-age` et sans moyen simple de revenir en arrière.
  const https = publicUrl.startsWith('https://');

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    // Une URL de média porte un identifiant Drive : il n'a rien à faire dans
    // les journaux d'un site tiers vers lequel on cliquerait.
    reply.header('Referrer-Policy', 'no-referrer');
    if (https) reply.header('Strict-Transport-Security', `max-age=${HSTS_MAX_AGE}`);
  });
};

export default fp(securityHeaders, { name: 'security-headers' });
