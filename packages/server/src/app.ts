import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { AppContext } from './context.js';
import type { Env } from './env.js';
import authPlugin from './plugins/auth.js';
import { createAdminRoutes, createOAuthCallbackRoute } from './routes/admin.js';
import { createAlbumRoutes } from './routes/albums.js';
import { createAuthRoutes } from './routes/auth.js';
import { createCommentRoutes } from './routes/comments.js';
import { createIdentityRoutes } from './routes/identity.js';
import { createMediaRoutes } from './routes/media.js';
import { createSubscriptionRoutes } from './routes/subscriptions.js';

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
    // Nginx/Caddy en frontal : sans ça, request.ip serait toujours celui du proxy
    // et le throttle de connexion regrouperait tout le monde sous une seule clé.
    trustProxy: true,
  });

  const context = new AppContext(env, server.log);
  await context.cache.load();

  await server.register(fastifyCookie, { secret: env.sessionSecret });
  await server.register(authPlugin, { context });

  await server.register(
    async (api) => {
      api.get('/health', async () => ({ status: 'ok' }));
      await api.register(createAuthRoutes(context), { prefix: '/auth' });
      await api.register(createAlbumRoutes(context), { prefix: '/albums' });
      await api.register(createMediaRoutes(context), { prefix: '/media' });
      await api.register(createCommentRoutes(context), { prefix: '/comments' });
      await api.register(createIdentityRoutes(context), { prefix: '/identity' });
      await api.register(createSubscriptionRoutes(context), { prefix: '/subscriptions' });
      await api.register(createAdminRoutes(context), { prefix: '/admin' });
      await api.register(createOAuthCallbackRoute(context), { prefix: '/oauth' });
    },
    { prefix: '/api' },
  );

  await registerFrontend(server, env.webDir);

  server.setErrorHandler(async (error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error({ err: error }, 'Erreur non gérée');
    return reply.code(status).send({
      error: status >= 500 ? 'internal_error' : 'request_error',
      // Le détail d'une 500 peut contenir des chemins ou des identifiants :
      // il reste dans les logs, pas dans la réponse.
      message: status >= 500 ? 'Erreur interne' : error.message,
    });
  });

  return { server, context };
}

async function registerFrontend(server: FastifyInstance, webDir: string): Promise<void> {
  const hasBuild = existsSync(join(webDir, 'index.html'));

  if (!hasBuild) {
    // Développement : Vite sert le front sur son propre port et proxie /api.
    server.log.warn(`Front non trouvé dans ${webDir} — seule l'API est servie.`);
    server.setNotFoundHandler(async (request, reply) =>
      reply.code(404).send({
        error: 'not_found',
        message: request.url.startsWith('/api/')
          ? 'Route inconnue'
          : 'Front non buildé — lance `pnpm dev` ou `pnpm build`.',
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

  // La route générique de @fastify/static fait correspondre `/` au répertoire
  // racine et refuse de le servir (403). Une route exacte, prioritaire sur la
  // générique, rend l'application.
  server.get('/', async (_request, reply) => reply.sendFile('index.html'));

  server.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not_found', message: 'Route inconnue' });
    }

    // Un fichier manquant sous /assets/ est un déploiement incomplet. Lui
    // répondre index.html donnerait une erreur de type MIME au lieu du 404 qui
    // désigne le vrai problème.
    if (request.url.startsWith('/assets/')) {
      return reply.code(404).send({ error: 'not_found', message: 'Fichier introuvable' });
    }
    // Le routage vit dans le front : toute autre URL lui rend index.html, sans
    // quoi un rechargement sur /album/vacances tomberait en 404.
    return reply.sendFile('index.html');
  });
}
