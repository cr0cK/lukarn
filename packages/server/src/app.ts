import { existsSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply } from 'fastify';
import { AppContext } from './context.js';
import type { Env } from './env.js';
import authPlugin from './plugins/auth.js';
import securityHeaders from './plugins/headers.js';
import { createAdminRoutes, createOAuthCallbackRoute } from './routes/admin.js';
import { createAlbumRoutes } from './routes/albums.js';
import { createAuthRoutes } from './routes/auth.js';
import { createCommentRoutes } from './routes/comments.js';
import { createIdentityRoutes } from './routes/identity.js';
import { createMediaRoutes } from './routes/media.js';
import { createSearchRoutes } from './routes/search.js';
import { createSubscriptionRoutes } from './routes/subscriptions.js';
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
    // Seuls des JSON courts sont postés ; les gros transferts sont sortants.
    bodyLimit: 64 * 1024,
    // Caddy en frontal : sans ça, request.ip serait toujours celui du proxy et
    // le throttle de connexion regrouperait tout le monde sous une seule clé.
    //
    // La liste, plutôt que `true` : `true` fait confiance à n'importe quel
    // `X-Forwarded-For`, y compris celui qu'un client forge lui-même. Le
    // backoff de `throttle.ts` étant indexé sur l'IP, un attaquant changerait
    // d'en-tête à chaque tentative et ne serait jamais ralenti. Ne sont crus
    // que les intermédiaires joignables sur un réseau privé — la boucle locale
    // et le réseau interne de Docker, c'est-à-dire nos propres proxys.
    trustProxy: ['loopback', 'uniquelocal'],
  });

  const context = new AppContext(env, server.log);
  await context.cache.load();
  // Le magasin vidéo a son propre inventaire, et c'est lui qui efface les
  // temporaires d'un transcodage interrompu par un arrêt brutal.
  await context.videoStore.load();
  await context.checkFfmpeg();

  // Avant tout le reste : un en-tête posé sur `onRequest` couvre aussi les
  // réponses que les plugins suivants produisent sans nous consulter.
  await server.register(securityHeaders, { publicUrl: env.publicUrl });
  await server.register(fastifyCookie, { secret: env.sessionSecret });
  await server.register(authPlugin, { context });

  await server.register(
    async (api) => {
      api.get('/health', async () => ({ status: 'ok' }));
      await api.register(createAuthRoutes(context), { prefix: '/auth' });
      await api.register(createAlbumRoutes(context), { prefix: '/albums' });
      await api.register(createSearchRoutes(context), { prefix: '/search' });
      await api.register(createMediaRoutes(context), { prefix: '/media' });
      await api.register(createCommentRoutes(context), { prefix: '/comments' });
      await api.register(createIdentityRoutes(context), { prefix: '/identity' });
      await api.register(createSubscriptionRoutes(context), { prefix: '/subscriptions' });
      await api.register(createAdminRoutes(context), { prefix: '/admin' });
      await api.register(createOAuthCallbackRoute(context), { prefix: '/oauth' });
    },
    { prefix: '/api' },
  );

  await registerFrontend(server, env.webDir, env.appName);

  server.setErrorHandler(async (error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error({ err: error }, 'Unhandled error');
    return reply.code(status).send({
      error: status >= 500 ? 'internal_error' : 'request_error',
      // Le détail d'une 500 peut contenir des chemins ou des identifiants :
      // il reste dans les logs, pas dans la réponse.
      message: status >= 500 ? 'Erreur interne' : error.message,
    });
  });

  return { server, context };
}

async function registerFrontend(
  server: FastifyInstance,
  webDir: string,
  appName: string,
): Promise<void> {
  const hasBuild = existsSync(join(webDir, 'index.html'));

  if (!hasBuild) {
    // Développement : Vite sert le front sur son propre port et proxie /api.
    server.log.warn(`Front end not found in ${webDir} — only the API is served.`);
    server.setNotFoundHandler(async (request, reply) =>
      reply.code(404).send({
        error: 'not_found',
        message: request.url.startsWith('/api/')
          ? 'Route inconnue'
          : 'Front end not built — run `pnpm dev` or `pnpm build`.',
      }),
    );
    return;
  }

  await server.register(fastifyStatic, {
    root: webDir,
    index: false,
    // Route générique plutôt qu'une route par fichier : les noms de bundles
    // changent à chaque build, et une liste figée au démarrage renverrait
    // index.html à la place du JavaScript demandé. Les chemins sans fichier
    // correspondant retombent sur le gestionnaire 404 ci-dessous.
    wildcard: true,
    cacheControl: false,
    setHeaders(response, path) {
      // Les bundles Vite portent un hash dans leur nom : leur contenu ne change
      // jamais à URL constante, ils peuvent être gardés indéfiniment.
      //
      // index.html, lui, garde la même URL et référence les bundles du jour :
      // le mettre en cache long figerait l'application sur une version passée
      // après chaque déploiement.
      const immutable = path.includes(`${sep}assets${sep}`);
      response.setHeader(
        'Cache-Control',
        immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });

  // La coquille et le manifeste portent le nom de l'instance, substitué une
  // fois au démarrage : ces deux fichiers ne changent pas sous les pieds du
  // serveur, et les rendre depuis la mémoire évite une lecture disque par
  // navigation. Un redémarrage suffit à changer APP_NAME, comme pour le reste
  // du `.env`.
  const shell = renderShell(readFileSync(join(webDir, 'index.html'), 'utf8'), appName);

  const sendShell = (reply: FastifyReply): FastifyReply =>
    reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(shell);

  // Cette route exacte passe avant la route générique de @fastify/static, qui
  // servirait sinon le fichier brut — avec son nom par défaut. Elle est de
  // toute façon indispensable : la générique fait correspondre `/` au
  // répertoire racine et refuse de le servir (403).
  server.get('/', async (_request, reply) => sendShell(reply));

  const manifestPath = join(webDir, 'manifest.webmanifest');
  if (existsSync(manifestPath)) {
    const manifest = renderManifest(readFileSync(manifestPath, 'utf8'), appName);
    server.get('/manifest.webmanifest', async (_request, reply) =>
      reply
        .type('application/manifest+json; charset=utf-8')
        .header('Cache-Control', 'no-cache')
        .send(manifest),
    );
  } else {
    // Sans manifeste l'application reste entièrement utilisable, elle ne
    // s'installe simplement plus : un avertissement, pas un refus de démarrer.
    // C'est le même arbitrage que pour un front absent, quelques lignes plus haut.
    server.log.warn(
      `manifest.webmanifest missing from ${webDir} — the application will not be installable.`,
    );
  }

  server.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not_found', message: 'Unknown route' });
    }

    // Un fichier manquant sous /assets/ est un déploiement incomplet. Lui
    // répondre index.html donnerait une erreur de type MIME au lieu du 404 qui
    // désigne le vrai problème.
    if (request.url.startsWith('/assets/')) {
      return reply.code(404).send({ error: 'not_found', message: 'File not found' });
    }
    // Le routage vit dans le front : toute autre URL lui rend index.html, sans
    // quoi un rechargement sur /album/vacances tomberait en 404.
    return sendShell(reply);
  });
}
