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
  LOCALES,
  MEDIA_DESCRIPTION_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SHARE_LABEL_MAX_LENGTH,
  slugifyAlbumId,
  USERNAME_MAX_LENGTH,
  USERNAME_PATTERN,
  VISIT_WINDOW_DEFAULT,
  VISIT_WINDOW_MAX,
  type AdminAlbum,
  type AdminStatus,
  type AdminUser,
  type AppSettings,
  type StorageAuthorization,
  type StorageConnectionStatus,
  type StorageKind,
  type StorageProbeResult,
  type VisitsOverview,
} from '@lukarn/shared';
import argon2 from 'argon2';
import type { FastifyBaseLogger, FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { StoredAlbum, StoredUser } from '../config-repo.js';
import { toAdminUser } from '../config-repo.js';
import type { AppContext } from '../context.js';
import type { Translate } from '../i18n/index.js';
import { buildInvitationMail } from '../mail.js';
import { requireAdmin } from '../plugins/auth.js';
import { buildAlbum } from '../repo.js';
import type { StorageConnection } from '../storage/connections.js';
import { SUPPORTED_KINDS } from '../storage/registry.js';

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

/** Address an invitation goes to. Same bound as everywhere else an address is read. */
const invitedEmail = z.string().trim().email('invalid address').max(EMAIL_MAX_LENGTH);

/**
 * Language an invitation is written in, chosen by whoever sends it.
 *
 * Refused rather than folded back to the default when it names an unsupported
 * language: this is a choice somebody made on a form, so a silent substitution would
 * send the message in a language the sender did not pick and report success. The
 * header `plugins/locale.ts` reads is the opposite case, and degrades on purpose.
 */
const invitationLocale = z.enum(LOCALES);

const createUserSchema = z
  .object({
    username: identifier,
    password: password.optional(),
    email: invitedEmail.optional(),
    locale: invitationLocale.optional(),
    admin: z.boolean().default(false),
    albums: albumList.default([]),
  })
  // Exactly one, as `CreateUserRequest` says in the type system. A password creates
  // the shared key of 1.2 and nothing about it changes; an address creates an account
  // with no password and invites it. Both at once would be a key pretending to be a
  // person, and neither would be an account nobody can enter.
  .refine((input) => (input.password === undefined) !== (input.email === undefined), {
    message: 'exactly one of password and email',
  });

/** Inviting an existing account. Without an address, the pending invitation is remade. */
const inviteUserSchema = z.object({
  email: invitedEmail.optional(),
  locale: invitationLocale.optional(),
});

const updateUserSchema = z
  .object({
    password: password.optional(),
    admin: z.boolean().optional(),
    albums: albumList.optional(),
    unbind: z.literal(true).optional(),
  })
  // Unbinding without a password would leave an account with no identity and a hash
  // nobody can enter, the administrator included.
  .refine((input) => input.unbind === undefined || input.password !== undefined, {
    message: 'unbinding requires the password the account is entered with afterwards',
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

/** A connection slug, bounded and shaped like an album id — both appear in logs. */
const connectionId = z
  .string()
  .min(1)
  .max(USERNAME_MAX_LENGTH)
  .regex(ALBUM_ID_PATTERN, 'letters, digits, dot, hyphen and underscore only');

/**
 * Settings are a flat map of strings: an endpoint, a bucket, a prefix. Bounded
 * because they are written to the database and read back into a form, and nothing a
 * backend needs is a paragraph.
 */
const storageSettings = z.record(z.string(), z.string().max(1024));

/** A secret bounded well above a service-account key, the longest one in practice. */
const storageSecret = z.string().min(1).max(8192);

const createStorageSchema = z.object({
  /**
   * Optional: /admin stopped asking for one, and the route derives it from the
   * label instead (D260816h). Still accepted, because a caller that has an
   * identifier to preserve — a restored instance, a script — must be able to say so.
   */
  id: connectionId.optional(),
  kind: z.enum(['drive', 'local', 's3', 'webdav']),
  label: z.string().trim().min(1).max(100),
  settings: storageSettings.optional(),
  secret: storageSecret.optional(),
});

/** What a connection is called when its own label slugifies to nothing — "📷" is a label. */
const FALLBACK_CONNECTION_ID = 'storage';

/**
 * A connection identifier derived from its label, free among those already stored.
 *
 * A taken slug is suffixed — `archives`, then `archives-2` — rather than answered
 * with a 409: the form has no identifier field left for an administrator to correct
 * one in, so the refusal would be a dead end (D260816h).
 */
function deriveConnectionId(label: string, taken: (id: string) => boolean): string {
  const base = slugifyAlbumId(label) || FALLBACK_CONNECTION_ID;

  let candidate = base;
  let suffix = 1;
  while (taken(candidate)) {
    suffix += 1;
    const tail = `-${suffix}`;
    // An album may only name a connection whose identifier fits `connectionId`, so
    // the suffix eats into the slug rather than pushing it past that bound.
    candidate = base.slice(0, USERNAME_MAX_LENGTH - tail.length) + tail;
  }
  return candidate;
}

/**
 * Whether this kind refuses an album with no container of its own.
 *
 * Every path-addressed backend accepts one: it reads the root its connection already
 * declares — the whole bucket, the whole folder — and `local`, `s3` and `webdav` all
 * resolve an empty reference to exactly that. Drive is the exception because its
 * references are opaque identifiers rather than paths: there is no empty one, and the
 * nearest thing to "everything" would be the entire Drive on a read-only scope that
 * covers it (D260816j).
 */
function emptyFolderRefused(kind: StorageKind, folderId: string | undefined): boolean {
  return kind === 'drive' && !folderId?.trim();
}

const updateStorageSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  settings: storageSettings.optional(),
  secret: storageSecret.nullable().optional(),
});

const createAlbumSchema = z.object({
  id: albumId,
  title: z.string().min(1).max(200),
  description: z.string().max(ALBUM_DESCRIPTION_MAX_LENGTH).optional(),
  connectionId: connectionId.optional(),
  // Empty is allowed here and refused below for Drive alone: a path-addressed backend
  // reads the root its connection declares, an opaque identifier has no such value.
  folderId: z.string().max(256),
  recursive: z.boolean().default(true),
  groupBy: groupBy.default(DEFAULT_GROUP_BY),
  sortOrder: sortOrder.default(DEFAULT_SORT_ORDER),
});

const updateAlbumSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(ALBUM_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  connectionId: connectionId.optional(),
  folderId: z.string().max(256).optional(),
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
/**
 * The one-a-minute delivery delay, as an HTTP answer.
 *
 * The delay is per address across every purpose, so an administrator inviting two
 * accounts at the same inbox in the same minute meets it — which is the mail-bombing
 * rule doing its job rather than a fault of this route.
 */
function tooSoon(reply: FastifyReply, retryAfterMs: number, t: Translate): FastifyReply {
  const seconds = Math.ceil(retryAfterMs / 1000);
  return reply
    .code(429)
    .header('Retry-After', String(seconds))
    .send({ error: 'too_soon', message: t('error.codeJustSent', seconds) });
}

function badRequest(reply: FastifyReply, error: z.ZodError, t: Translate): FastifyReply {
  const details = error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join(' ; ');
  return reply.code(400).send({ error: 'bad_request', message: t('error.validation', details) });
}

/**
 * Making a share link. `mediaId` present covers that photograph, absent covers the
 * whole album — one field rather than a `kind` beside it, because the two would then
 * be able to disagree.
 */
const shareSchema = z.object({
  albumId: z.string().min(1).max(USERNAME_MAX_LENGTH),
  mediaId: z.string().min(1).max(256).nullish(),
  label: z.string().trim().max(SHARE_LABEL_MAX_LENGTH).nullish(),
  // An instant rather than a day: the row is compared against `Date.now()`, and a
  // bare date would expire at whatever hour the string happened to parse to.
  expiresAt: z.string().datetime().nullish(),
});

export function createAdminRoutes(context: AppContext): FastifyPluginAsync {
  const secureCookies = context.env.publicUrl.startsWith('https://');

  /** Administration album view: configuration, index and sync state. */
  function toAdminAlbum(album: StoredAlbum): AdminAlbum {
    const state = context.syncState.get(album.id);
    return {
      id: album.id,
      title: album.title,
      description: album.description,
      connectionId: album.connectionId,
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

  /**
   * How this connection is authorised, which decides the controls /admin offers.
   *
   * A service account is the one case where a Drive connection has no button: its key
   * is in the environment, and what the administrator needs instead is the address to
   * share the folder with (D46).
   */
  function authorizationOf(connection: StorageConnection): StorageAuthorization {
    if (connection.kind !== 'drive') return 'settings';
    return context.env.serviceAccount ? 'key' : 'consent';
  }

  /** A connection as /admin reads it. Never carries the secret, under any key. */
  function toStorageStatus(connection: StorageConnection): StorageConnectionStatus {
    const drive = context.storage.drive(connection.id);
    return {
      id: connection.id,
      kind: connection.kind,
      label: connection.label,
      // The Drive service answers for both modes: with a service account the address
      // comes from the key rather than from a stored consent.
      account: drive ? (drive.connection?.account ?? null) : connection.account,
      connected: context.storage.isConnected(connection.id),
      revokedAt: connection.revokedAt,
      authorization: authorizationOf(connection),
      // The column is JSON, so what comes back out is typed `unknown`, while the
      // route only ever writes strings into it. Coerce rather than cast: a value
      // that somehow is not one still reaches the form as something readable.
      settings: Object.fromEntries(
        Object.entries(connection.settings).map(([key, value]) => [key, String(value)]),
      ),
      albumCount: context.config.albumsOn(connection.id).length,
      createdAt: connection.createdAt,
    };
  }

  /**
   * The account list's view of an account. The identity and the pending invitation
   * live outside the configuration snapshot, so the projection is given the two
   * repositories that hold them rather than reading them itself.
   */
  const adminUser = (user: StoredUser): AdminUser =>
    toAdminUser(user, context.codes, context.commenters);

  return async (app) => {
    app.addHook('preHandler', requireAdmin);

    app.get('/status', async (_request, reply) => {
      const status: AdminStatus = {
        storage: context.connections.list().map(toStorageStatus),
        storageKinds: SUPPORTED_KINDS,
        storageLocalRoot: context.env.storageLocalRoot,
        oauthConfigured: context.env.serviceAccount !== null || context.env.google !== null,
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

    app.get('/users', async (_request, reply) => reply.send(context.config.users().map(adminUser)));

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

      // Created by address: the reserved hash and the invitation, together. No binding
      // is written here and no existing `commenters` row is touched — a verified
      // address proves that somebody controls an inbox, not that they accepted this
      // account, and consuming the code is what proves the second. Adopting an
      // identity that already signs comments is the good case, and it happens there.
      if (input.email !== undefined) {
        if (!context.mailer.enabled) {
          // Refused rather than creating an account nobody can enter: with no relay
          // the invitation is never sent, and the account would sit in the list with
          // no password and no way to acquire one.
          return reply.code(503).send({
            error: 'mail_not_configured',
            message: request.t('error.mailNotConfigured'),
          });
        }

        // Bound rows only. A pending invitation holds nothing: one invitation per
        // address at a time, so a second one replaces the first and the account it
        // named loses it — which the account list shows.
        const holder = context.config.userForEmail(input.email);
        if (holder) {
          return reply.code(409).send({
            error: 'identity_taken',
            message: request.t('error.identityTaken', holder.username),
          });
        }

        const created = context.config.createInvitedUser(
          {
            username: input.username,
            admin: input.admin,
            albums: input.albums,
            email: input.email,
            locale: input.locale,
          },
          context.codes,
        );
        if ('failure' in created) return tooSoon(reply, created.retryAfterMs, request.t);

        context.mailer.queue(
          buildInvitationMail(
            input.email,
            created.code,
            // The sender's choice, and the instance default when they made none. The
            // recipient has never made a request here, so there is nothing recorded
            // to consult (D260812d) and nobody but the sender knows what they read.
            input.locale ?? context.env.defaultLocale,
            context.settings.instanceName,
            context.env,
          ),
        );
        request.log.info(`Account "${created.user.username}" created and invited`);
        return reply.code(201).send(adminUser(created.user));
      }

      const user = context.config.createUser({
        username: input.username,
        // Guaranteed by the schema: exactly one of the two is present.
        passwordHash: await argon2.hash(input.password!, { type: argon2.argon2id }),
        admin: input.admin,
        albums: input.albums,
      });

      request.log.info(`Account "${user.username}" created`);
      return reply.code(201).send(adminUser(user));
    });

    /**
     * Invites an account that already exists, and sends its invitation again.
     *
     * With an address it invites that account. Without one it mints a fresh code for
     * the invitation already pending, which is what somebody presses when the first
     * message went unread. An account that keeps its password stays enterable
     * throughout: an invitation to convert that nobody takes up leaves a working
     * shared key exactly as it was.
     */
    app.post('/users/:username/invite', async (request, reply) => {
      const { username } = request.params as { username: string };
      const stored = context.config.user(username);
      if (!stored) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.accountNotFound') });
      }

      const parsed = inviteUserSchema.safeParse(request.body ?? {});
      if (!parsed.success) return badRequest(reply, parsed.error, request.t);

      // Refused on a bound account: that would be changing somebody's address, which
      // is out of scope for this release, and it is the shape of the impersonation
      // this design exists to prevent — an administrator pointing an account at an
      // inbox they read.
      if (stored.commenterId !== null) {
        return reply.code(409).send({
          error: 'already_bound',
          message: request.t('error.accountAlreadyBound', stored.username),
        });
      }

      if (!context.mailer.enabled) {
        return reply.code(503).send({
          error: 'mail_not_configured',
          message: request.t('error.mailNotConfigured'),
        });
      }

      // An invitation that expired left no row behind, so nothing here still knows
      // where it was sent: the address has to be given again.
      const pending = context.codes.pendingInvite(stored.username);
      const email = parsed.data.email ?? pending?.target;
      if (!email) {
        return reply.code(409).send({
          error: 'no_invitation',
          message: request.t('error.noInvitationPending', stored.username),
        });
      }

      const holder = context.config.userForEmail(email);
      if (holder) {
        return reply.code(409).send({
          error: 'identity_taken',
          message: request.t('error.identityTaken', holder.username),
        });
      }

      // Sending the invitation again repeats the language of the one already
      // pending, so a second message never arrives in another language than the
      // first — the recipient has read nothing yet, and a switch mid-conversation
      // reads as a different message rather than the same one twice. A locale in the
      // request overrides it: that is the sender changing their mind, which is the
      // one thing allowed to.
      const locale = parsed.data.locale ?? pending?.locale ?? null;

      const minted = context.codes.mint(email, 'invite', { username: stored.username, locale });
      if ('failure' in minted) return tooSoon(reply, minted.retryAfterMs, request.t);

      context.mailer.queue(
        buildInvitationMail(
          email,
          minted.code,
          locale ?? context.env.defaultLocale,
          context.settings.instanceName,
          context.env,
        ),
      );
      request.log.info(`Account "${stored.username}" invited`);
      return reply.send(adminUser(stored));
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
      //
      // The count excludes administrators nobody can sign in as, so the predicate has
      // to move with it: refusing to demote a *pending* administrator while the working
      // one remains is the new wrong answer. It guards when the target is itself usable
      // and taking it away would leave none behind.
      if (
        patch.admin === false &&
        stored.admin &&
        context.config.isUsable(stored.username) &&
        context.config.adminCount() <= 1
      ) {
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

      if (patch.unbind) {
        // `{ unbind: true, password }` is the single way a bound account is given a
        // password: in one transaction it clears the binding, writes the password,
        // closes the sessions and forgets the paired screens. It is the administrator
        // taking the account back and handing it over as the shared key it has become,
        // and the answer to somebody losing access to their address.
        context.config.unbindUser(
          stored.username,
          await argon2.hash(patch.password!, { type: argon2.argon2id }),
        );
        request.log.info(
          `Account "${stored.username}" unbound and given a password, its sessions are closed`,
        );
      }

      let user: StoredUser;
      try {
        user = context.config.updateUser(stored.username, {
          // The unbind above already wrote it, inside the transaction that closed the
          // sessions: hashing it again would only rewrite the same column.
          passwordHash:
            patch.password && !patch.unbind
              ? await argon2.hash(patch.password, { type: argon2.argon2id })
              : undefined,
          admin: patch.admin,
          albums: patch.albums,
        });
      } catch (error) {
        // The refusal belongs to `ConfigRepo` rather than here, because
        // `pnpm reset-password` writes through it without passing any route. This asks
        // and translates rather than restating the condition: a bound account being
        // given a password is the only reason a well-formed patch is refused, so
        // anything else is a fault and keeps travelling.
        if (patch.password !== undefined && stored.commenterId !== null) {
          return reply.code(409).send({
            error: 'password_on_bound_account',
            message: request.t('error.passwordOnBoundAccount', stored.username),
          });
        }
        throw error;
      }

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
      if (patch.password && !patch.unbind) {
        context.sessions.destroyForUser(stored.username);
        request.log.info(`Sessions of "${stored.username}" closed after password change`);
      }

      return reply.send(adminUser(user));
    });

    app.delete('/users/:username', async (request, reply) => {
      const { username } = request.params as { username: string };
      const stored = context.config.user(username);
      if (!stored) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.accountNotFound') });
      }

      // As above: the last administrator who can actually sign in, not the last row.
      if (
        stored.admin &&
        context.config.isUsable(stored.username) &&
        context.config.adminCount() <= 1
      ) {
        return reply.code(409).send({
          error: 'last_admin',
          message: request.t('error.lastAdminDelete'),
        });
      }

      context.config.deleteUser(stored.username);
      // A deleted account must not continue navigating with its session. Its pending
      // invitation leaves with it through `verification_codes.username`, which
      // references this row `ON DELETE CASCADE`: without that, recreating the same
      // username would let the original recipient bind an account that may by then be
      // an administrator.
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
      if (!context.comments.hide(id, request.user!.username!)) {
        const existing = context.comments.byId(id, { commenterId: null, admin: true });
        if (!existing) {
          return reply
            .code(404)
            .send({ error: 'not_found', message: request.t('error.commentNotFound') });
        }
      }

      request.log.info(`Commentaire ${id} hidden by "${request.user!.username!}"`);
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

      request.log.info(`Commentaire ${id} rendu visible par "${request.user!.username!}"`);
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

      const affected = context.comments.hideAllFrom(id, request.user!.username!);
      request.log.info(
        `${affected} comment(s) from identity ${id} hidden by "${request.user!.username!}"`,
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
          `"${request.user!.username!}"`,
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

      const connection = input.connectionId ?? context.connections.list()[0]?.id;
      const resolved = connection ? context.connections.get(connection) : undefined;
      if (!connection || !resolved) {
        return reply.code(400).send({
          error: 'unknown_storage',
          message: request.t('error.storageNotFound'),
        });
      }

      if (emptyFolderRefused(resolved.kind, input.folderId)) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.folderRequired') });
      }

      const album = context.config.createAlbum({
        id: input.id,
        title: input.title,
        description: input.description ?? null,
        connectionId: connection,
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

      if (patch.connectionId && !context.connections.get(patch.connectionId)) {
        return reply.code(400).send({
          error: 'unknown_storage',
          message: request.t('error.storageNotFound'),
        });
      }

      // The kind that will apply once this patch lands, which is not necessarily the
      // one stored: moving an album onto a Drive and clearing its folder in the same
      // request has to be refused on the destination's terms.
      const kind = context.connections.get(patch.connectionId ?? stored.connectionId)?.kind;
      if (patch.folderId !== undefined && kind && emptyFolderRefused(kind, patch.folderId)) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.folderRequired') });
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
       * on an instance with automatic sync disabled. So does `connectionId`: the same
       * container path on another storage is another album's worth of files, and the
       * identifiers of the old one address nothing there.
       */
      const perimetreChange =
        (patch.connectionId !== undefined && patch.connectionId !== stored.connectionId) ||
        (patch.folderId !== undefined && patch.folderId !== stored.folderId) ||
        (patch.recursive !== undefined && patch.recursive !== stored.recursive);

      if (perimetreChange) {
        const removed = context.media.clearAlbum(id);
        context.syncState.set(id, { lastSyncAt: null, status: 'never', error: null });
        request.log.info(`Album "${id}": scope changed, ${removed} media removed from the index`);
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

    /* ------------------------------------------------------------- storage */

    app.get('/storage', async (_request, reply) =>
      reply.send(context.connections.list().map(toStorageStatus)),
    );

    app.post('/storage', async (request, reply) => {
      const parsed = createStorageSchema.safeParse(request.body ?? {});
      if (!parsed.success) return badRequest(reply, parsed.error, request.t);
      const input = parsed.data;

      // Only a caller that chose the identifier can be told it is taken; a derived
      // one is made free below instead.
      if (input.id && context.connections.get(input.id)) {
        return reply.code(409).send({
          error: 'conflict',
          message: request.t('error.storageExists', input.id),
        });
      }

      // A kind this build cannot read would produce a connection nothing can serve
      // from, discovered only when an album on it stays empty.
      if (!SUPPORTED_KINDS.includes(input.kind)) {
        return reply.code(400).send({
          error: 'unsupported_kind',
          message: request.t('error.storageKindUnsupported', input.kind),
        });
      }

      const id =
        input.id ??
        deriveConnectionId(
          input.label,
          (candidate) => context.connections.get(candidate) !== undefined,
        );
      const connection = context.connections.create({ ...input, id });
      context.storage.invalidate();
      request.log.info(`Storage "${connection.id}" (${connection.kind}) created`);

      return reply.code(201).send(toStorageStatus(connection));
    });

    app.patch('/storage/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!context.connections.get(id)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.storageNotFound') });
      }

      const parsed = updateStorageSchema.safeParse(request.body ?? {});
      if (!parsed.success) return badRequest(reply, parsed.error, request.t);

      const connection = context.connections.update(id, parsed.data);
      // The cached provider was built from the previous settings: without this, a
      // corrected endpoint would keep reaching the old one until restart.
      context.storage.invalidate();

      return reply.send(toStorageStatus(connection));
    });

    /**
     * Deleting a connection is refused while an album reads it.
     *
     * The album would otherwise point at nothing: its media would stay indexed and
     * every thumbnail would fail with a message about a connection nobody can see any
     * more. Saying which albums is the point of the refusal — that is the list the
     * administrator has to move or delete first.
     */
    app.delete('/storage/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!context.connections.get(id)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.storageNotFound') });
      }

      const albums = context.config.albumsOn(id);
      if (albums.length > 0) {
        return reply.code(409).send({
          error: 'storage_in_use',
          message: request.t('error.storageInUse', albums.map((album) => album.title).join(', ')),
        });
      }

      context.connections.delete(id);
      context.storage.invalidate();
      request.log.info(`Storage "${id}" deleted`);

      return reply.send({ ok: true });
    });

    /**
     * Does this connection work, in the backend's own words?
     *
     * The one control that turns "the album is empty" into a sentence: a wrong key, an
     * unreachable host or a withdrawn authorisation each answer differently, and none
     * of them is visible from a listing that simply returned nothing.
     */
    app.post('/storage/:id/test', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!context.connections.get(id)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.storageNotFound') });
      }

      try {
        const probe = await context.storage.get(id).probe();
        const result: StorageProbeResult = probe;
        return reply.send(result);
      } catch (error) {
        // A probe reports rather than throws: "it does not work, here is why" is the
        // answer to the question asked, and a 500 would only say the button failed.
        const result: StorageProbeResult = {
          ok: false,
          account: null,
          error: (error as Error).message,
        };
        return reply.send(result);
      }
    });

    /**
     * Starts Google consent for one connection. `state` is generated randomly, stored
     * in a signed cookie and compared again on return: without this, a third party
     * could complete a callback with a code obtained elsewhere and connect someone
     * else's Drive to this instance.
     *
     * The cookie also carries **which connection** the consent belongs to. Google's
     * callback URL is fixed in its console and cannot name it, and with several Drive
     * connections the returned token would otherwise land on whichever one the server
     * guessed.
     *
     * Consent is meaningless with a service account: authorisation comes from sharing
     * the folder in Drive. Refusing it here rather than allowing completion avoids
     * recording a token nothing would use and suggesting that consent is required.
     */
    app.get('/storage/:id/oauth/start', async (request, reply) => {
      const { id } = request.params as { id: string };
      const drive = context.storage.drive(id);
      if (!drive) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.storageNotFound') });
      }

      if (drive.mode === 'service_account') {
        return reply.code(409).send({
          error: 'service_account_mode',
          message: request.t('error.serviceAccountConsent'),
        });
      }
      if (!drive.configured) {
        return reply.code(400).send({
          error: 'oauth_not_configured',
          message: request.t('error.oauthNotConfigured'),
        });
      }

      const state = randomBytes(24).toString('base64url');
      return reply
        .setCookie(OAUTH_STATE_COOKIE, `${id}:${state}`, {
          path: '/api',
          httpOnly: true,
          sameSite: 'lax',
          secure: secureCookies,
          maxAge: OAUTH_STATE_TTL_S,
          signed: true,
        })
        .send({ url: drive.authUrl(state) });
    });

    app.post('/storage/:id/disconnect', async (request, reply) => {
      const { id } = request.params as { id: string };
      const drive = context.storage.drive(id);
      if (!drive) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.storageNotFound') });
      }

      // Nothing to disconnect: the key comes from configuration and access from Drive
      // sharing. Responding "done" would suggest the instance is disconnected while
      // it continues to read everything.
      if (drive.mode === 'service_account') {
        return reply.code(409).send({
          error: 'service_account_mode',
          message: request.t('error.serviceAccountDisconnect'),
        });
      }

      drive.disconnect();
      context.storage.invalidate();
      return reply.send({ ok: true });
    });

    app.post('/resync', async (request, reply) => {
      const parsed = resyncSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: request.t('error.invalidParameters') });
      }

      if (!context.storage.anyConnected()) {
        return reply.code(503).send({
          error: 'storage_disconnected',
          message: request.t('error.storageNotConnected'),
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

    /* --------------------------------------------------------------------------
     * Share links
     *
     * Every mutation on a link lives here, under the one prefix that answers 403
     * (D12, D50): issuing, revoking and deleting are administration, and the
     * recipient's own surface at `/api/share` reads and writes nothing about the
     * link itself.
     * ----------------------------------------------------------------------- */

    /** Every link this instance has issued, newest first, with its record of use. */
    app.get('/shares', async (_request, reply) => reply.send(context.shares.list()));

    app.post('/shares', async (request, reply) => {
      const parsed = shareSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'bad_request',
          message: parsed.error.issues[0]?.message ?? request.t('error.invalidParameters'),
        });
      }

      const { albumId, mediaId, label, expiresAt } = parsed.data;
      if (!context.findAlbum(albumId)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.albumNotFound') });
      }

      // A link to a photograph that is not in that album would answer 410 to its
      // recipient the moment it was opened, and the person issuing it would learn
      // that from them. Checked here instead.
      if (mediaId && !context.media.getDetail(albumId, mediaId)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.mediaNotFound') });
      }

      const link = context.shares.create({
        albumId,
        mediaId: mediaId ?? null,
        label: label ?? null,
        createdBy: request.user!.username!,
        expiresAt: expiresAt ?? null,
      });
      request.log.info({ album: albumId }, 'Share link issued');
      // The full listing rather than the row: the caller displays a list, and
      // building one row's shape twice is how the two stop agreeing.
      const created = context.shares.list().find((row) => row.token === link.token)!;
      return reply.code(201).send(created);
    });

    /**
     * Revoking. The row stays, and its record of use with it: with the row gone,
     * revoked and never-existed become the same state (D260825b), and the history is
     * what the person deciding to cut a link off was reading.
     */
    app.post('/shares/:token/revoke', async (request, reply) => {
      const { token } = request.params as { token: string };
      if (!context.shares.revoke(token)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.shareUnknown') });
      }
      request.log.info('Share link revoked');
      return reply.send({ ok: true });
    });

    /** Deleting outright — the one gesture that also erases the openings. */
    app.delete('/shares/:token', async (request, reply) => {
      const { token } = request.params as { token: string };
      if (!context.shares.remove(token)) {
        return reply
          .code(404)
          .send({ error: 'not_found', message: request.t('error.shareUnknown') });
      }
      request.log.info('Share link deleted');
      return reply.send({ ok: true });
    });
  };

  /** Background indexing, silent until this album's storage is connected. */
  function startSync(album: StoredAlbum, log: FastifyBaseLogger): void {
    if (!context.storage.isConnected(album.connectionId)) return;
    void context.syncThenPrewarm([album]).catch((error: unknown) => {
      log.error({ err: error }, `Sync of album "${album.id}" failed`);
    });
  }
}

/**
 * OAuth callback. Mounted outside the `/admin` prefix because its URL is fixed in the
 * Google console — but it requires the same administrator session.
 *
 * Returns target `/admin/storage`, the section containing the connect button: that
 * is where the flow started, and the message responds there to an action still fresh
 * in mind (D66, D260816g).
 */
export function createOAuthCallbackRoute(context: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.get('/callback', { preHandler: requireAdmin }, async (request, reply) => {
      const query = request.query as { code?: string; state?: string; error?: string };

      if (query.error) {
        return reply.redirect(`/admin/storage?oauth=denied`);
      }
      if (!query.code || !query.state) {
        return reply.redirect(`/admin/storage?oauth=invalid`);
      }

      const cookie = request.cookies[OAUTH_STATE_COOKIE];
      const unsigned = cookie ? request.unsignCookie(cookie) : null;
      // The cookie is `<connectionId>:<state>`: Google's callback URL is fixed in its
      // console and says nothing about which connection consent was started for.
      const separator = unsigned?.value?.lastIndexOf(':') ?? -1;
      const connectionId = separator > 0 ? unsigned!.value!.slice(0, separator) : null;
      const state = separator > 0 ? unsigned!.value!.slice(separator + 1) : null;

      if (!unsigned?.valid || connectionId === null || state !== query.state) {
        request.log.warn('Invalid OAuth state, callback rejected');
        return reply.redirect(`/admin/storage?oauth=state_mismatch`);
      }

      reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/api' });

      const drive = context.storage.drive(connectionId);
      if (!drive) {
        request.log.warn(`OAuth callback for unknown storage "${connectionId}"`);
        return reply.redirect(`/admin/storage?oauth=invalid`);
      }

      try {
        await drive.completeAuth(query.code);
        context.storage.invalidate();
      } catch (error) {
        request.log.error({ err: error }, 'Connecting Drive failed');
        return reply.redirect(`/admin/storage?oauth=error`);
      }

      // First connection: the index is empty for the albums on this storage, so fill
      // them without waiting for the administrator to click "resynchronise". Albums on
      // another connection are left alone — nothing about them just changed.
      const albums = context.config.albumsOn(connectionId);
      void context.syncThenPrewarm(albums).catch((error: unknown) => {
        request.log.error({ err: error }, 'Initial sync failed');
      });

      return reply.redirect(`/admin/storage?oauth=connected`);
    });
  };
}
