import { randomBytes } from 'node:crypto';
import {
  ALBUM_DAY_DESCRIPTION_MAX_LENGTH,
  ALBUM_DAY_PLACE_MAX_LENGTH,
  ALBUM_DESCRIPTION_MAX_LENGTH,
  ALBUM_ID_PATTERN,
  ALL_ALBUMS,
  DEFAULT_GROUP_BY,
  DEFAULT_SORT_ORDER,
  EMAIL_MAX_LENGTH,
  HEX_COLOR_PATTERN,
  INSTANCE_NAME_MAX_LENGTH,
  MEDIA_DESCRIPTION_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_PATTERN,
  VISIT_WINDOW_DEFAULT,
  VISIT_WINDOW_MAX,
  type AdminAlbum,
  type AdminStatus,
  type AppSettings,
  type VisitsOverview,
} from '@lukarn/shared';
import argon2 from 'argon2';
import type { FastifyBaseLogger, FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { StoredAlbum } from '../config-repo.js';
import { toAdminUser } from '../config-repo.js';
import type { AppContext } from '../context.js';
import type { Translate } from '../i18n/index.js';
import { requireAdmin } from '../plugins/auth.js';
import { buildAlbum } from '../repo.js';

const OAUTH_STATE_COOKIE = 'lukarn_oauth_state';
const OAUTH_STATE_TTL_S = 600;

const resyncSchema = z.object({ albumId: z.string().min(1).optional() });

const identifier = z
  .string()
  .min(1)
  .max(USERNAME_MAX_LENGTH)
  .regex(USERNAME_PATTERN, 'letters, digits, dot, hyphen and underscore only');

const albumId = z
  .string()
  .min(1)
  .max(USERNAME_MAX_LENGTH)
  .regex(ALBUM_ID_PATTERN, 'letters, digits, dot, hyphen and underscore only');

const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `at least ${PASSWORD_MIN_LENGTH} characters`)
  // Argon2 accepts much longer passwords; the limit merely protects CPU time from an
  // accidentally requested, excessively large hash.
  .max(512);

/** `['*']` or a list of IDs. The contents are checked against existing albums. */
const albumList = z.array(z.union([z.literal(ALL_ALBUMS), albumId])).max(500);

/**
 * Address notified of every comment. An empty string is accepted alongside a valid
 * address because that is what a newly cleared form field sends; refusing it would
 * force the front end to translate "empty" into `null` before every request.
 * `ConfigRepo` reduces both to the same `NULL`.
 */
const moderationEmail = z
  .union([z.string().trim().email('invalid address').max(EMAIL_MAX_LENGTH), z.literal('')])
  .nullable()
  .optional();

const createUserSchema = z.object({
  username: identifier,
  password,
  admin: z.boolean().default(false),
  albums: albumList.default([]),
});

const updateUserSchema = z.object({
  password: password.optional(),
  admin: z.boolean().optional(),
  albums: albumList.optional(),
});

const moderationQuerySchema = z.object({
  filter: z.enum(['all', 'visible', 'hidden']).default('all'),
  albumId: albumId.optional(),
  // Limited to 200 characters like other free-form input: beyond that, it is no longer
  // a search but a pasted comment body.
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.coerce.number().int().positive().optional(),
});

/**
 * Visit-telemetry window. Limited to one year: beyond that, hourly cleanup has already
 * forgotten the days, and the request would return a window the database cannot fill.
 */
const visitsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(VISIT_WINDOW_MAX).default(VISIT_WINDOW_DEFAULT),
});

const groupBy = z.enum(['month', 'day']);
const sortOrder = z.enum(['desc', 'asc']);

const createAlbumSchema = z.object({
  id: albumId,
  title: z.string().min(1).max(200),
  description: z.string().max(ALBUM_DESCRIPTION_MAX_LENGTH).optional(),
  folderId: z.string().min(1).max(256),
  recursive: z.boolean().default(true),
  groupBy: groupBy.default(DEFAULT_GROUP_BY),
  sortOrder: sortOrder.default(DEFAULT_SORT_ORDER),
});

const updateAlbumSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(ALBUM_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  folderId: z.string().min(1).max(256).optional(),
  recursive: z.boolean().optional(),
  groupBy: groupBy.optional(),
  sortOrder: sortOrder.optional(),
  // A Drive file identifier, bounded like a folder identifier. `null` returns the
  // cover to automatic selection — the most recent photo.
  coverId: z.string().min(1).max(256).nullable().optional(),
});

/** `YYYY-MM-DD`, the day key used by day grouping. */
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected: YYYY-MM-DD');

/**
 * Day note. An empty string is accepted alongside text for the same reason as
 * `moderationEmail`: it is what a newly cleared field sends, and refusing it would
 * force the front end to translate "empty" into `null` before every request.
 * `AlbumDayRepo` reduces both to the same `NULL`.
 */
const updateAlbumDaySchema = z.object({
  description: z.string().max(ALBUM_DAY_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  place: z.string().max(ALBUM_DAY_PLACE_MAX_LENGTH).nullable().optional(),
});

/** Photo caption. An empty string is accepted and reduced to `null`, as above. */
const updateMediaSchema = z.object({
  description: z.string().max(MEDIA_DESCRIPTION_MAX_LENGTH).nullable().optional(),
});

const updateSettingsSchema = z.object({
  instanceName: z.string().trim().min(1).max(INSTANCE_NAME_MAX_LENGTH).optional(),
  // Six digits and nothing else. A three-digit form would have to be expanded
  // before every mix, and an alpha channel means nothing for a value painted as an
  // opaque surface — see `derivePalette`.
  primaryColor: z.string().regex(HEX_COLOR_PATTERN, 'a colour written as #rrggbb').optional(),
  // One-week maximum: beyond that, `setInterval` is no longer a setting but a
  // disabled state, represented by `0`.
  syncIntervalMinutes: z.number().int().min(0).max(10080).optional(),
  syncOnStartup: z.boolean().optional(),
  cacheMaxSizeGB: z.number().positive().max(10000).optional(),
  prewarmCache: z.boolean().optional(),
  transcodeVideos: z.boolean().optional(),
  videoCacheMaxSizeGB: z.number().positive().max(10000).optional(),
  moderationEmail,
});

/** Identity targeted by bulk moderation, or `null` if the segment is not one. */
function commenterIdOf(params: unknown): number | null {
  const id = Number((params as { commenterId: string }).commenterId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Readable error message: the invalid field's path followed by the reason.
 *
 * The reason itself comes from Zod and stays in English — it names the schema,
 * not the interface, and translating a library's vocabulary would mean
 * maintaining a copy of it.
 */
function badRequest(reply: FastifyReply, error: z.ZodError, t: Translate): FastifyReply {
  const details = error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join(' ; ');
  return reply.code(400).send({ error: 'bad_request', message: t('error.validation', details) });
}

export function createAdminRoutes(context: AppContext): FastifyPluginAsync {
  const secureCookies = context.env.publicUrl.startsWith('https://');

  /** Administration album view: configuration, index and sync state. */
  function toAdminAlbum(album: StoredAlbum): AdminAlbum {
    const state = context.syncState.get(album.id);
    return {
      id: album.id,
      title: album.title,
      description: album.description,
      folderId: album.folderId,
      recursive: album.recursive,
      groupBy: album.groupBy,
      sortOrder: album.sortOrder,
      itemCount: context.media.stats(album.id).itemCount,
      lastSyncAt: state.lastSyncAt,
      syncStatus: state.status,
      syncError: state.error,
      members: context.config.members(album.id),
      coverId: album.coverMediaId,
      createdAt: album.createdAt,
      updatedAt: album.updatedAt,
    };
  }

  /**
   * A reference to a non-existent album is almost always a typo that would silently
   * deprive someone of access — the same check previously performed when loading YAML.
   */
  function unknownAlbum(albums: string[]): string | null {
    return albums.find((id) => id !== ALL_ALBUMS && !context.findAlbum(id)) ?? null;
  }

  return async (app) => {
    app.addHook('preHandler', requireAdmin);

    app.get('/status', async (_request, reply) => {
      const connection = context.drive.connection;
      const status: AdminStatus = {
        driveMode: context.drive.mode,
        driveConnected: context.drive.connected,
        driveAccount: connection?.account ?? null,
        driveRevokedAt: connection?.revokedAt ?? null,
        oauthConfigured: context.drive.configured,
        albums: context.albums.map((album) => buildAlbum(album, context.media, context.syncState)),
        cache: context.cache.stats(),
        hiddenComments: context.comments.hiddenCount(),
        mailConfigured: context.mailer.enabled,
        logoCustom: context.branding.custom,
      };
      return reply.send(status);
    });

    /**
     * Who visited and what was viewed. Two aggregations bounded to a window of days,
     * read from a table already aggregated on write (D260809h).
     *
     * Visits by the administration key are **shown, not excluded**: removing them
     * would make totals inaccurate, and the "admin" column is enough to interpret
     * them correctly.
     */
    app.get('/visits', async (request, reply) => {
      const parsed = visitsQuerySchema.safeParse(request.query);
      if (!parsed.success) return badRequest(reply, parsed.error, request.t);

      const overview: VisitsOverview = context.visits.overview(parsed.data.days);
      return reply.send(overview);
    });

    /* ------------------------------------------------------------- accounts */

    app.get('/users', async (_request, reply) =>
      reply.send(context.config.users().map(toAdminUser)),
    );

    app.post('/users', async (request, reply) => {
      const parsed = createUserSchema.safeParse(request.body ?? {});
      if (!parsed.success) return badRequest(reply, parsed.error, request.t);
      const input = parsed.data;

      // Overwriting an existing account would change its password and permissions
      // without anyone requesting it.
      if (context.config.user(input.username)) {
        return reply.code(409).send({
          error: 'conflict',
          message: request.t('error.usernameTaken', input.username),
        });
      }

      const missing = unknownAlbum(input.albums);
      if (missing) {
        return reply
          .code(400)
          .send({ error: 'unknown_album', message: request.t('error.unknownAlbum', missing) });
      }

      const user = context.config.createUser({
        username: input.username,
        passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
        admin: input.admin,
        albums: input.albums,
      });

      request.log.info(`Account "${user.username}" created`);
      return reply.code(201).send(toAdminUser(user));
    });

    app.patch('/users/:username', async (request, reply) => {
      const { username } = request.params as { username: string };
      const stored = context.config.user(username);
      if (!stored) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.accountNotFound') });
      }

      const parsed = updateUserSchema.safeParse(request.body ?? {});
      if (!parsed.success) return badRequest(reply, parsed.error, request.t);
      const patch = parsed.data;

      // Removing the last administrator's role would make the instance impossible to
      // administer: nobody could connect Drive, create an account or restore the role.
      if (patch.admin === false && stored.admin && context.config.adminCount() <= 1) {
        return reply.code(409).send({
          error: 'last_admin',
          message: request.t('error.lastAdminRole'),
        });
      }

      if (patch.albums) {
        const missing = unknownAlbum(patch.albums);
        if (missing) {
          return reply
            .code(400)
            .send({ error: 'unknown_album', message: request.t('error.unknownAlbum', missing) });
        }
      }

      const user = context.config.updateUser(stored.username, {
        passwordHash: patch.password
          ? await argon2.hash(patch.password, { type: argon2.argon2id })
          : undefined,
        admin: patch.admin,
        albums: patch.albums,
      });

      /**
       * Changing a password closes open sessions: otherwise an already signed-in
       * browser would continue navigating with the old password, precisely the access
       * being revoked.
       *
       * Removing the administrator role does not sign out: the account remains valid,
       * and `plugins/auth.ts` rereads `admin` on every request, so /api/admin access
       * disappears on the next request. Changing the album list does not sign out for
       * the same reason.
       */
      if (patch.password) {
        context.sessions.destroyForUser(stored.username);
        request.log.info(`Sessions of "${stored.username}" closed after password change`);
      }

      return reply.send(toAdminUser(user));
    });

    app.delete('/users/:username', async (request, reply) => {
      const { username } = request.params as { username: string };
      const stored = context.config.user(username);
      if (!stored) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.accountNotFound') });
      }

      if (stored.admin && context.config.adminCount() <= 1) {
        return reply.code(409).send({
          error: 'last_admin',
          message: request.t('error.lastAdminDelete'),
        });
      }

      context.config.deleteUser(stored.username);
      // A deleted account must not continue navigating with its session.
      context.sessions.destroyForUser(stored.username);
      request.log.info(`Account "${stored.username}" deleted, its sessions are closed`);

      return reply.send({ ok: true });
    });

    /* --------------------------------------------------------- moderation */

    /**
     * Moderation queue across all albums — including those this administrator would
     * not see in the gallery. Moderating requires reading everything: limiting the
     * queue to viewing scope would leave comments nobody could handle.
     */
    app.get('/comments', async (request, reply) => {
      const parsed = moderationQuerySchema.safeParse(request.query);
      if (!parsed.success) return badRequest(reply, parsed.error, request.t);
      const { filter, albumId: album, q, limit, cursor } = parsed.data;

      return reply.send(
        context.comments.listForModeration({
          filter,
          albumId: album ?? null,
          q: q ?? null,
          limit,
          cursor: cursor ?? null,
        }),
      );
    });

    app.post('/comments/:commentId/hide', async (request, reply) => {
      const id = Number((request.params as { commentId: string }).commentId);
      if (!Number.isInteger(id) || id <= 0) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.invalidUsername') });
      }

      // Hiding twice is not an error but must not rewrite the date: the original
      // decision date is what matters.
      if (!context.comments.hide(id, request.user!.username)) {
        const existing = context.comments.byId(id, { commenterId: null, admin: true });
        if (!existing) {
          return reply
            .code(404)
            .send({ error: 'not_found', message: request.t('error.commentNotFound') });
        }
      }

      request.log.info(`Commentaire ${id} hidden by "${request.user!.username}"`);
      return reply.send({ ok: true });
    });

    app.post('/comments/:commentId/show', async (request, reply) => {
      const id = Number((request.params as { commentId: string }).commentId);
      if (!Number.isInteger(id) || id <= 0) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.invalidUsername') });
      }

      if (!context.comments.show(id)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.commentNotFound') });
      }

      request.log.info(`Commentaire ${id} rendu visible par "${request.user!.username}"`);
      return reply.send({ ok: true });
    });

    /**
     * Bulk moderation: every message from one identity at once.
     *
     * The action taken after an access key has circulated too widely or a commenter
     * has become persistent. Nobody removes fifteen messages one by one — leaving
     * that work undone is the real risk.
     *
     * The identity rather than the access key: moderation targets the person. The key
     * remains displayed beside each message because it is what gets changed afterwards.
     */
    app.post('/commenters/:commenterId/hide', async (request, reply) => {
      const id = commenterIdOf(request.params);
      if (id === null) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.invalidUsername') });
      }
      // Without this check, an invented identifier would return "0 messages affected" —
      // indistinguishable from an identity that wrote nothing.
      if (!context.commenters.byId(id)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.identityNotFound') });
      }

      const affected = context.comments.hideAllFrom(id, request.user!.username);
      request.log.info(
        `${affected} comment(s) from identity ${id} hidden by "${request.user!.username}"`,
      );
      return reply.send({ affected });
    });

    app.post('/commenters/:commenterId/show', async (request, reply) => {
      const id = commenterIdOf(request.params);
      if (id === null) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.invalidUsername') });
      }
      if (!context.commenters.byId(id)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.identityNotFound') });
      }

      const affected = context.comments.showAllFrom(id);
      request.log.info(
        `${affected} comment(s) from identity ${id} made visible again by ` +
          `"${request.user!.username}"`,
      );
      return reply.send({ affected });
    });

    /* -------------------------------------------------------------- albums */

    app.get('/albums', async (_request, reply) =>
      reply.send(context.albums.map((album) => toAdminAlbum(album))),
    );

    app.post('/albums', async (request, reply) => {
      const parsed = createAlbumSchema.safeParse(request.body ?? {});
      if (!parsed.success) return badRequest(reply, parsed.error, request.t);
      const input = parsed.data;

      if (context.findAlbum(input.id)) {
        return reply
          .code(409)
          .send({ error: 'conflict', message: request.t('error.albumExists', input.id) });
      }

      const album = context.config.createAlbum({
        id: input.id,
        title: input.title,
        description: input.description ?? null,
        folderId: input.folderId,
        recursive: input.recursive,
        groupBy: input.groupBy,
        sortOrder: input.sortOrder,
      });

      request.log.info(`Album "${album.id}" created`);
      startSync(album, request.log);

      return reply.code(201).send(toAdminAlbum(album));
    });

    app.patch('/albums/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const stored = context.findAlbum(id);
      if (!stored) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.albumNotFound') });
      }

      const parsed = updateAlbumSchema.safeParse(request.body ?? {});
      if (!parsed.success) return badRequest(reply, parsed.error, request.t);
      const { coverId, ...patch } = parsed.data;

      /**
       * A cover selected outside this album or set to a video would never appear:
       * `stats` rejects it and the album silently falls back to its most recent photo.
       * Refusing immediately explains what silence would only reveal on the home page.
       */
      if (coverId) {
        const chosen = context.media.getDetail(id, coverId);
        if (!chosen || chosen.kind !== 'photo') {
          return reply.code(400).send({
            error: 'unknown_cover',
            message: request.t('error.coverNotInAlbum'),
          });
        }
      }

      const album = context.config.updateAlbum(id, { ...patch, coverMediaId: coverId });

      /**
       * Changing scope changes album content: indexed media refers to the old scope
       * and would remain visible — and therefore accessible to accounts with this
       * album — until the next synchronisation. Purge immediately rather than waiting
       * for `deleteStale`: the gap is exactly when the album would show what the owner
       * just chose to remove. The following resynchronisation fills it again without
       * requiring a manual trigger.
       *
       * `recursive` matters as much as `folderId`: setting it back to `false` must
       * remove subfolders immediately, not at the next periodic sync — which is never
       * on an instance with automatic sync disabled.
       */
      const perimetreChange =
        (patch.folderId !== undefined && patch.folderId !== stored.folderId) ||
        (patch.recursive !== undefined && patch.recursive !== stored.recursive);

      if (perimetreChange) {
        const removed = context.media.clearAlbum(id);
        context.syncState.set(id, { lastSyncAt: null, status: 'never', error: null });
        request.log.info(
          `Album "${id}": Drive scope changed, ${removed} media removed from the index`,
        );
        startSync(album, request.log);
      }

      return reply.send(toAdminAlbum(album));
    });

    app.delete('/albums/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!context.findAlbum(id)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.albumNotFound') });
      }

      context.config.deleteAlbum(id);

      /**
       * The index follows the album: `pruneAlbums` removes its media and synchronisation
       * state. A file also present in another album retains its row there — the primary
       * key is `(album_id, id)` — so it remains accessible through that path, as intended.
       *
       * Derivatives in the disk cache remain: they are indexed by file ID alone and
       * therefore shared between albums; deleting them would deprive other albums of
       * their thumbnails. Orphans leave through LRU eviction or immediately through
       * "clear cache". Unlike the index, they can be regenerated.
       */
      const removed = context.media.pruneAlbums(context.albums.map((album) => album.id));
      request.log.info(`Album "${id}" deleted, ${removed} media removed from the index`);

      return reply.send({ ok: true });
    });

    /**
     * Annotates a day. **Input** lives in the album beside the photos being described;
     * the **mutation** remains here under `/api/admin`. This preserves the "403 nowhere
     * else" invariant: everywhere else, denied access returns 404 to avoid revealing
     * what exists (D50).
     */
    app.patch('/albums/:id/days/:day', async (request, reply) => {
      const params = request.params as { id: string; day: string };
      if (!context.findAlbum(params.id)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.albumNotFound') });
      }

      const day = dayKey.safeParse(params.day);
      if (!day.success) return badRequest(reply, day.error, request.t);

      const parsed = updateAlbumDaySchema.safeParse(request.body ?? {});
      if (!parsed.success) return badRequest(reply, parsed.error, request.t);

      return reply.send(context.days.upsertNote(params.id, day.data, parsed.data));
    });

    /**
     * Describes a photo. Same split as the day above: the caption is written from the
     * gallery while viewing the image and its neighbours, but the mutation remains
     * under `/api/admin` — the only prefix that returns 403, while the "denied access
     * = 404" invariant holds everywhere else (D50).
     */
    app.patch('/albums/:id/items/:mediaId', async (request, reply) => {
      const params = request.params as { id: string; mediaId: string };
      if (!context.findAlbum(params.id)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.albumNotFound') });
      }

      const parsed = updateMediaSchema.safeParse(request.body ?? {});
      if (!parsed.success) return badRequest(reply, parsed.error, request.t);

      // Describing a photo absent from the index would leave text that is never
      // displayed, attached to a possibly invented identifier.
      const item = context.media.setDescription(params.id, params.mediaId, parsed.data);
      if (!item) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }

      return reply.send(item);
    });

    /* ------------------------------------------------------------- settings */

    app.get('/settings', async (_request, reply) => reply.send(context.settings));

    app.patch('/settings', async (request, reply) => {
      const parsed = updateSettingsSchema.safeParse(request.body ?? {});
      if (!parsed.success) return badRequest(reply, parsed.error, request.t);

      // `updateSettings` also applies changes: disk-cache limit and synchronisation
      // timer rescheduling, without a restart.
      const settings: AppSettings = context.updateSettings(parsed.data);
      return reply.send(settings);
    });

    /* --------------------------------------------------------------- Drive */

    /**
     * Starts Google consent. `state` is generated randomly, stored in a signed cookie
     * and compared again on return: without this, a third party could complete a
     * callback with a code obtained elsewhere and connect someone else's Drive to
     * this instance.
     */
    /**
     * Consent is meaningless with a service account: authorisation comes from sharing
     * the folder in Drive. Refusing it here rather than allowing completion avoids
     * recording a token nothing would use and suggesting that consent is required.
     */
    app.get('/oauth/start', async (request, reply) => {
      if (context.drive.mode === 'service_account') {
        return reply.code(409).send({
          error: 'service_account_mode',
          message: request.t('error.serviceAccountConsent'),
        });
      }
      if (!context.drive.configured) {
        return reply.code(400).send({
          error: 'oauth_not_configured',
          message: request.t('error.oauthNotConfigured'),
        });
      }

      const state = randomBytes(24).toString('base64url');
      return reply
        .setCookie(OAUTH_STATE_COOKIE, state, {
          path: '/api',
          httpOnly: true,
          sameSite: 'lax',
          secure: secureCookies,
          maxAge: OAUTH_STATE_TTL_S,
          signed: true,
        })
        .send({ url: context.drive.authUrl(state) });
    });

    app.post('/drive/disconnect', async (request, reply) => {
      // Nothing to disconnect: the key comes from configuration and access from Drive
      // sharing. Responding "done" would suggest the instance is disconnected while
      // it continues to read everything.
      if (context.drive.mode === 'service_account') {
        return reply.code(409).send({
          error: 'service_account_mode',
          message: request.t('error.serviceAccountDisconnect'),
        });
      }
      context.drive.disconnect();
      return reply.send({ ok: true });
    });

    app.post('/resync', async (request, reply) => {
      const parsed = resyncSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.invalidParameters') });
      }

      if (!context.drive.connected) {
        return reply.code(503).send({
          error: 'drive_disconnected',
          message: request.t('error.driveNotConnected'),
        });
      }

      const targets = parsed.data.albumId
        ? context.albums.filter((album) => album.id === parsed.data.albumId)
        : context.albums;

      if (targets.length === 0) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.albumNotFound') });
      }

      // Sync runs in the background: on a large album it greatly exceeds an HTTP
      // request timeout. Progress is tracked through `syncStatus` in /status.
      void context.syncThenPrewarm(targets).catch((error: unknown) => {
        request.log.error({ err: error }, 'Sync failed');
      });

      return reply.code(202).send({ started: targets.map((album) => album.id) });
    });

    app.post('/cache/clear', async (_request, reply) => {
      await context.cache.clear();
      return reply.send({ ok: true });
    });
  };

  /** Background indexing, silent until Drive is connected. */
  function startSync(album: StoredAlbum, log: FastifyBaseLogger): void {
    if (!context.drive.connected) return;
    void context.syncThenPrewarm([album]).catch((error: unknown) => {
      log.error({ err: error }, `Sync of album "${album.id}" failed`);
    });
  }
}

/**
 * OAuth callback. Mounted outside the `/admin` prefix because its URL is fixed in the
 * Google console — but it requires the same administrator session.
 *
 * Returns target `/admin/server`, the section containing the connect button: that
 * is where the flow started, and the message responds there to an action still fresh
 * in mind (D66).
 */
export function createOAuthCallbackRoute(context: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.get('/callback', { preHandler: requireAdmin }, async (request, reply) => {
      const query = request.query as { code?: string; state?: string; error?: string };

      if (query.error) {
        return reply.redirect(`/admin/server?oauth=denied`);
      }
      if (!query.code || !query.state) {
        return reply.redirect(`/admin/server?oauth=invalid`);
      }

      const cookie = request.cookies[OAUTH_STATE_COOKIE];
      const unsigned = cookie ? request.unsignCookie(cookie) : null;
      if (!unsigned?.valid || unsigned.value !== query.state) {
        request.log.warn('Invalid OAuth state, callback rejected');
        return reply.redirect(`/admin/server?oauth=state_mismatch`);
      }

      reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/api' });

      try {
        await context.drive.completeAuth(query.code);
      } catch (error) {
        request.log.error({ err: error }, 'Connecting Drive failed');
        return reply.redirect(`/admin/server?oauth=error`);
      }

      // First connection: the index is empty, so fill it without waiting for the
      // administrator to click "resynchronise".
      void context.syncThenPrewarm(context.albums).catch((error: unknown) => {
        request.log.error({ err: error }, 'Initial sync failed');
      });

      return reply.redirect(`/admin/server?oauth=connected`);
    });
  };
}
