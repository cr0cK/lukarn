import type { Locale } from '@lukarn/shared';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../env.js';
import { localeFromHeader, translator, type Translate } from '../i18n/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Language this request is answered in. */
    locale: Locale;
    /** Translation function for that language: `request.t('error.albumNotFound')`. */
    t: Translate;
  }
}

/**
 * Resolves the language of every request from `Accept-Language`.
 *
 * Registered **before** authentication, so `requireAuth` and every route already
 * have `request.t` when they refuse something. The header is authoritative and
 * nothing else is consulted: the front end overrides it with the language chosen
 * in the account menu, and a link opened straight from an inbox carries the
 * browser's own preferences — both are what their reader actually reads.
 */
const localePlugin: FastifyPluginAsync<{ env: Env }> = async (app, { env }) => {
  app.decorateRequest('locale', env.defaultLocale);
  // A default value, replaced on every request below. Fastify refuses `null` for a
  // function-valued decorator — it would read as a getter.
  app.decorateRequest('t', translator(env.defaultLocale));

  app.addHook('onRequest', async (request) => {
    const locale = localeFromHeader(request.headers['accept-language'], env.defaultLocale);
    request.locale = locale;
    request.t = translator(locale);
  });
};

export default fp(localePlugin, { name: 'locale' });
