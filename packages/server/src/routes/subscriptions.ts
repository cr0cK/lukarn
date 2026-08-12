import { ALBUM_ID_PATTERN, EMAIL_MAX_LENGTH, USERNAME_MAX_LENGTH } from '@nonni/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { verifyAlbumUnsubscribeToken } from '../crypto.js';
import { escapeHtml } from '../mail.js';

const unsubscribeSchema = z.object({
  // The address identifies a person, while the access key may be shared.
  u: z.string().min(1).max(EMAIL_MAX_LENGTH),
  // Same constraint as album creation (`routes/admin.ts`): an ID outside the pattern
  // cannot identify any album in this instance.
  a: z.string().min(1).max(USERNAME_MAX_LENGTH).regex(ALBUM_ID_PATTERN),
  t: z.string().min(1).max(256),
});

/**
 * Subscriptions to an album's new items.
 *
 * Subscription does not happen here: it is a side effect of opening the album on the
 * first page of `GET /api/albums/:albumId/items` (D41). This prefix therefore only
 * carries unsubscribing, which must work without a session — also why it is not mounted
 * under `/api/albums`, whose entire prefix requires `requireAuth`.
 */
export function createSubscriptionRoutes(context: AppContext): FastifyPluginAsync {
  return async (app) => {
    /**
     * No session, as with comment unsubscribing: the link is clicked from an inbox,
     * often on another device, and requiring sign-in to stop being disturbed would
     * fail to honour the request.
     */
    app.get('/unsubscribe', async (request, reply) => {
      const parsed = unsubscribeSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'bad_request', message: 'Incomplete link' });
      }

      const { u: email, a: albumId, t: token } = parsed.data;
      // The token covers the pair: one album's token is not valid for another,
      // otherwise a copied link could disable an unintended subscription.
      if (!verifyAlbumUnsubscribeToken(email, albumId, token, context.env.sessionSecret)) {
        return reply.code(400).send({ error: 'bad_request', message: 'Invalid link' });
      }

      const commenter = context.commenters.byEmail(email);
      const album = context.findAlbum(albumId);
      // The identity or album has disappeared since delivery: unsubscribing is moot,
      // and saying so avoids suggesting a failure.
      if (commenter && album) context.subscriptions.unsubscribe(commenter.id, albumId);

      return reply
        .type('text/html; charset=utf-8')
        .send(unsubscribePage(context.env.publicUrl, album?.title ?? null));
    });
  };
}

/**
 * Confirmation page rendered by the server rather than the front end: users arrive
 * without a session, and loading the React application to display one sentence would
 * redirect to the sign-in screen.
 */
function unsubscribePage(publicUrl: string, albumTitle: string | null): string {
  const message = albumTitle
    ? `You will no longer get an email when new photos arrive in &quot;${escapeHtml(albumTitle)}&quot;.`
    : 'That album or that account no longer exists: there is nothing to unsubscribe from.';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Unsubscribed</title>
  </head>
  <body style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; max-width: 34rem; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.6; color: #1a1a1a;">
    <h1 style="font-size: 1.25rem; margin: 0 0 1rem;">Done</h1>
    <p style="margin: 0 0 1.5rem;">${message}</p>
    <p style="margin: 0; font-size: 0.9rem; color: #666;">
      Replies to your comments keep arriving: those are stopped from the link in
      one of those emails.
      <br>
      <a href="${publicUrl}" style="color: #2563eb;">Back to the gallery</a>
    </p>
  </body>
</html>`;
}

/**
 * An album title is entered from /admin: it passes through this function before
 * entering the page, otherwise a title containing a tag would execute in the browser
 * of the person unsubscribing.
 */
