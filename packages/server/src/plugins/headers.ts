import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Six months. Long enough to protect, short enough for an instance that loses its
 * certificate to become reachable within a human timescale — a two-year `max-age`
 * turns a TLS configuration error into a failure visitors cannot bypass in a browser.
 */
const HSTS_MAX_AGE = 15_552_000;

/**
 * Content Security Policy.
 *
 * `script-src 'self'` is the key directive: it makes a `<script>` inserted into an
 * album title or comment unusable. The others close adjacent paths and lock down
 * browser defaults that must not change underneath the application later.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // React writes styles through the DOM `style` property, which CSP does not filter,
  // but Vite may inline a small stylesheet during build. A CSP that breaks layout on
  // the first tooling update ends up disabled. Inline styles cannot execute code.
  "style-src 'self' 'unsafe-inline'",
  // Vite inlines images below 4 KB as `data:`.
  "img-src 'self' data:",
  // Videos are relayed through `/api/media/:id/original` on the same origin.
  "media-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  // Replaces `X-Frame-Options`, retained alongside it for older browsers.
  "frame-ancestors 'none'",
].join('; ');

export interface SecurityHeadersOptions {
  /** `PUBLIC_URL`: its scheme decides whether `Strict-Transport-Security` is set. */
  publicUrl: string;
}

/**
 * Sets security headers on **every** response — API, front end, media, 404s and errors.
 *
 * The hook is `onRequest` rather than `onSend`: no route has responded at this point,
 * so none can omit the headers, including those `@fastify/static` serves without one
 * of our handlers.
 */
const securityHeaders: FastifyPluginAsync<SecurityHeadersOptions> = async (app, { publicUrl }) => {
  // Setting HSTS on an HTTP instance would force the browser to request HTTPS from an
  // origin that does not serve it — `localhost` in development — for the full `max-age`
  // with no simple reversal.
  const https = publicUrl.startsWith('https://');

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    // A media URL carries a Drive identifier that must not enter logs of a third-party
    // site reached through a click.
    reply.header('Referrer-Policy', 'no-referrer');
    if (https) reply.header('Strict-Transport-Security', `max-age=${HSTS_MAX_AGE}`);
  });
};

export default fp(securityHeaders, { name: 'security-headers' });
