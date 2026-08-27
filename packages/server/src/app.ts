import { existsSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply } from 'fastify';
import { AppContext } from './context.js';
import type { Env } from './env.js';
import authPlugin from './plugins/auth.js';
import localePlugin from './plugins/locale.js';
import securityHeaders from './plugins/headers.js';
import { createAdminRoutes, createOAuthCallbackRoute } from './routes/admin.js';
import { createAlbumRoutes } from './routes/albums.js';
import { createAuthRoutes } from './routes/auth.js';
import { createAdminBrandingRoutes, createBrandingRoutes } from './routes/branding.js';
import { createCommentRoutes } from './routes/comments.js';
import { createIdentityRoutes } from './routes/identity.js';
import { createMediaRoutes } from './routes/media.js';
import { createSearchRoutes } from './routes/search.js';
import { createShareRoutes } from './routes/share.js';
import { createSubscriptionRoutes } from './routes/subscriptions.js';
import { createVersionRoutes } from './routes/version.js';
import { renderManifest, renderShell } from './shell.js';

export interface BuiltApp {
  server: FastifyInstance;
  context: AppContext;
}

export async function buildApp(env: Env): Promise<BuiltApp> {
  const server = Fastify({
    logger: {
      level: env.logLevel,
      transport:
        env.nodeEnv === 'development'
          ? {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            }
          : undefined,
    },
    // Only short JSON payloads are posted; large transfers are outbound.
    bodyLimit: 64 * 1024,
    // With Caddy in front, request.ip would otherwise always be the proxy's and
    // the sign-in throttle would group everyone under a single key.
    //
    // A list rather than `true`: `true` trusts any `X-Forwarded-For`, including
    // one forged by the client. Since the backoff in `throttle.ts` is keyed by IP,
    // an attacker could change the header on every attempt and never be slowed down.
    // Only intermediaries reachable on a private network are trusted — loopback and
    // Docker's internal network, meaning our own proxies.
    trustProxy: ['loopback', 'uniquelocal'],
  });

  const context = new AppContext(env, server.log);
  await context.branding.load();
  await context.cache.load();
  // The video store has its own inventory, which removes temporary files left by
  // transcoding interrupted by an abrupt shutdown.
  await context.videoStore.load();
  await context.checkFfmpeg();

  // Before everything else: a header set on `onRequest` also covers responses
  // produced independently by subsequent plugins.
  await server.register(securityHeaders, { publicUrl: env.publicUrl });
  await server.register(fastifyCookie, { secret: env.sessionSecret });
  // Before authentication: `requireAuth` refuses in the language of the request,
  // so `request.t` must already exist when its `preHandler` runs.
  await server.register(localePlugin, { env });
  await server.register(authPlugin, { context });

  await server.register(
    async (api) => {
      api.get('/health', async () => ({ status: 'ok' }));
      // No prefix: it is a single route, and `/api/version/` would suggest a family
      // of them that does not exist.
      await api.register(createVersionRoutes(context));
      await api.register(createAuthRoutes(context), { prefix: '/auth' });
      await api.register(createAlbumRoutes(context), { prefix: '/albums' });
      await api.register(createSearchRoutes(context), { prefix: '/search' });
      await api.register(createMediaRoutes(context), { prefix: '/media' });
      await api.register(createCommentRoutes(context), { prefix: '/comments' });
      await api.register(createIdentityRoutes(context), { prefix: '/identity' });
      await api.register(createSubscriptionRoutes(context), { prefix: '/subscriptions' });
      // Public, like the unsubscribe pages: its caller holds a link and no session,
      // and this is the route that opens one for them (D260825).
      await api.register(createShareRoutes(context), { prefix: '/share' });
      await api.register(createBrandingRoutes(context), { prefix: '/branding' });
      await api.register(createAdminRoutes(context), { prefix: '/admin' });
      // A sibling of `/admin` rather than a block inside it: its body is raw image
      // bytes, and the content-type parser and larger limit that accept them stay
      // scoped to it.
      await api.register(createAdminBrandingRoutes(context), { prefix: '/admin/branding' });
      await api.register(createOAuthCallbackRoute(context), { prefix: '/oauth' });
    },
    { prefix: '/api' },
  );

  await registerFrontend(server, context);

  server.setErrorHandler(async (error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error({ err: error }, 'Unhandled error');
    return reply.code(status).send({
      error: status >= 500 ? 'internal_error' : 'request_error',
      // Details of a 500 may contain paths or identifiers, so they remain in the
      // logs rather than the response.
      message: status >= 500 ? 'Internal error' : error.message,
    });
  });

  return { server, context };
}

async function registerFrontend(server: FastifyInstance, context: AppContext): Promise<void> {
  const webDir = context.env.webDir;
  const hasBuild = existsSync(join(webDir, 'index.html'));

  if (!hasBuild) {
    // In development, Vite serves the front end on its own port and proxies /api.
    server.log.warn(`Front end not found in ${webDir} — only the API is served.`);
    server.setNotFoundHandler(async (request, reply) =>
      reply.code(404).send({
        error: 'not_found',
        message: request.url.startsWith('/api/')
          ? 'Unknown route'
          : 'Front end not built — run `pnpm dev` or `pnpm build`.',
      }),
    );
    return;
  }

  await server.register(fastifyStatic, {
    root: webDir,
    index: false,
    // A generic route rather than one route per file: bundle names change with every
    // build, and a list fixed at startup would return index.html instead of the
    // requested JavaScript. Paths without a matching file fall through to the 404
    // handler below.
    wildcard: true,
    cacheControl: false,
    setHeaders(response, path) {
      // Vite bundles carry a hash in their name: their content never changes at a
      // constant URL, so they can be retained indefinitely.
      //
      // index.html keeps the same URL and references the current bundles, so caching
      // it for a long time would freeze the application on an old version after each
      // deployment.
      const immutable = path.includes(`${sep}assets${sep}`);
      response.setHeader(
        'Cache-Control',
        immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });

  /**
   * The shell and manifest carry the instance name and its palette, both of which
   * are now settings rather than environment variables (D260813c). They can
   * therefore no longer be rendered once at startup — but they must not be rendered
   * per navigation either, since every URL of the application returns the shell.
   *
   * Hence a cache of one, dropped when settings change. The listener already exists
   * for exactly this: `main.ts` uses it to reschedule the synchronisation timer.
   */
  const template = readFileSync(join(webDir, 'index.html'), 'utf8');
  let shell: string | null = null;
  let manifest: string | null = null;
  context.onSettingsChanged(() => {
    shell = null;
    manifest = null;
  });

  const sendShell = (reply: FastifyReply): FastifyReply =>
    reply
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send((shell ??= renderShell(template, context.settings)));

  // This exact route precedes the generic @fastify/static route, which would
  // otherwise serve the raw file with its default name. It is required anyway:
  // the generic route maps `/` to the root directory and refuses to serve it (403).
  server.get('/', async (_request, reply) => sendShell(reply));

  const manifestPath = join(webDir, 'manifest.webmanifest');
  if (existsSync(manifestPath)) {
    const manifestTemplate = readFileSync(manifestPath, 'utf8');
    server.get('/manifest.webmanifest', async (_request, reply) =>
      reply
        .type('application/manifest+json; charset=utf-8')
        .header('Cache-Control', 'no-cache')
        .send((manifest ??= renderManifest(manifestTemplate, context.settings))),
    );
  } else {
    // Without a manifest the application remains fully usable but is no longer
    // installable: warn rather than prevent startup. This is the same tradeoff as
    // for a missing front end a few lines above.
    server.log.warn(
      `manifest.webmanifest missing from ${webDir} — the application will not be installable.`,
    );
  }

  server.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not_found', message: 'Unknown route' });
    }

    // A missing file under /assets/ means the deployment is incomplete. Responding
    // with index.html would cause a MIME-type error instead of the 404 that identifies
    // the real problem.
    if (request.url.startsWith('/assets/')) {
      return reply.code(404).send({ error: 'not_found', message: 'File not found' });
    }
    // Routing lives in the front end, so every other URL receives index.html;
    // otherwise reloading /album/vacances would return a 404.
    return sendShell(reply);
  });
}
