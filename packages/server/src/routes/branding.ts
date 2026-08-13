import { LOGO_MAX_BYTES, isIconName } from '@lukarn/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { BrandingAsset } from '../branding/store.js';
import type { AppContext } from '../context.js';
import { requireAdmin } from '../plugins/auth.js';

/**
 * The instance's logo and the icons derived from it.
 *
 * **Public, unlike everything else that reads instance state.** The sign-in screen
 * carries the mark, the favicon is requested before any session exists, and a home
 * screen fetches manifest icons without cookies. Nothing here reveals more than the
 * name already printed in the page title.
 *
 * `no-cache` rather than an `immutable` lifetime, unlike media: these URLs never
 * change while their content does, so the browser must ask. It asks with the `ETag`,
 * so the usual answer is a 304 carrying no bytes.
 */

/** Revalidated on every use: the content behind these URLs changes, the URLs do not. */
const REVALIDATE = 'public, no-cache';

/** Answers with the asset, or 304 when the client already holds it. */
function sendAsset(
  request: FastifyRequest,
  reply: FastifyReply,
  asset: BrandingAsset,
): FastifyReply {
  if (request.headers['if-none-match'] === asset.etag) {
    return reply.code(304).header('Cache-Control', REVALIDATE).header('ETag', asset.etag).send();
  }
  return reply
    .header('Content-Type', asset.contentType)
    .header('Cache-Control', REVALIDATE)
    .header('ETag', asset.etag)
    .send(asset.body);
}

export function createBrandingRoutes(context: AppContext): FastifyPluginAsync {
  return async (app) => {
    /**
     * The logo, whatever form it takes: the built-in mark as SVG, or an operator's
     * upload as PNG. One URL for both, so no caller has to know which is in force.
     */
    app.get('/logo', async (request, reply) =>
      sendAsset(request, reply, await context.branding.logo(context.settings.primaryColor)),
    );

    /**
     * A generated icon: the manifest's three, plus the one iOS reads from a `<link>`.
     *
     * The name carries the size and the purpose — `192.png`, `maskable-512.png` —
     * because a maskable icon is not a 512 px icon at another size: it is inset, on
     * an opaque background.
     */
    app.get('/icon-:name', async (request, reply) => {
      const { name } = request.params as { name: string };
      if (!isIconName(name)) {
        return reply.code(404).send({ error: 'not_found', message: request.t('error.noIcon') });
      }
      return sendAsset(
        request,
        reply,
        await context.branding.icon(name, context.settings.primaryColor),
      );
    });
  };
}

/**
 * Replacing and removing the logo.
 *
 * Its own plugin rather than a block inside `routes/admin.ts` for one reason: the
 * body is raw image bytes. The content-type parser that accepts them, and the
 * larger limit that lets them through, are scoped to this plugin — everywhere else
 * keeps the 64 KB JSON limit set in `app.ts`.
 */
export function createAdminBrandingRoutes(context: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', requireAdmin);

    // The upload arrives as it left the file input: whatever type the browser
    // reported. Nothing here trusts that value — `BrandingStore.replace` decides
    // what the bytes are by decoding them.
    app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });

    // The limit is raised **on this route alone**; everywhere else keeps the 64 KB
    // that fits a JSON payload. Its value is shared so the browser refuses the same
    // file this route would (`LOGO_MAX_BYTES`).
    app.put('/logo', { bodyLimit: LOGO_MAX_BYTES }, async (request, reply) => {
      const body = request.body;
      if (!Buffer.isBuffer(body) || body.byteLength === 0) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.logoEmpty') });
      }

      try {
        await context.branding.replace(body);
      } catch (error) {
        // sharp refuses what it cannot decode: a PDF, a truncated file, an SVG with
        // no root element. Report it as the caller's error rather than a 500 — the
        // instance is fine, the file is not.
        request.log.warn(`Rejected logo upload: ${(error as Error).message}`);
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.logoUnreadable') });
      }

      return reply.send({ custom: true });
    });

    /** Back to the built-in mark. Idempotent: removing nothing is still a success. */
    app.delete('/logo', async (_request, reply) => {
      await context.branding.reset();
      return reply.send({ custom: false });
    });
  };
}
