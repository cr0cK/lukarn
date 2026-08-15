import type { VersionInfo } from '@lukarn/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context.js';
import { requireAuth } from '../plugins/auth.js';
import { CHANGELOG_URL } from '../updates.js';

/**
 * What this instance runs, and — for an administrator — what it could run instead.
 *
 * **Signed in, not public.** The version an instance runs is the kind of detail a
 * scanner collects, and there is nothing here a visitor at the sign-in screen has
 * any use for. Everyone who has signed in sees it, because "powered by" naming the
 * software and its version is what an AGPL interface should say (D260815).
 *
 * Only an administrator's request can trigger a call to the release feed, and only
 * their response carries `update`: an access key cannot move the instance from one
 * image to another, so telling it about a release would be an interruption with no
 * available action behind it.
 */
export function createVersionRoutes(context: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.get('/version', { preHandler: requireAuth }, async (request, reply) => {
      const info: VersionInfo = {
        version: context.env.appVersion,
        changelogUrl: CHANGELOG_URL,
        update: request.user!.admin ? await context.updates.available() : null,
      };
      return reply.send(info);
    });
  };
}
