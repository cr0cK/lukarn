import { randomBytes } from 'node:crypto';
import {
  ALBUM_ID_PATTERN,
  ALL_ALBUMS,
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_PATTERN,
  type AdminAlbum,
  type AdminStatus,
  type AppSettings,
} from '@gdv/shared';
import argon2 from 'argon2';
import type { FastifyBaseLogger, FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { StoredAlbum } from '../config-repo.js';
import { toAdminUser } from '../config-repo.js';
import type { AppContext } from '../context.js';
import { DriveNotConfiguredError } from '../drive/service.js';
import { requireAdmin } from '../plugins/auth.js';
import { buildAlbum } from '../repo.js';

const OAUTH_STATE_COOKIE = 'gdv_oauth_state';
const OAUTH_STATE_TTL_S = 600;

const resyncSchema = z.object({ albumId: z.string().min(1).optional() });

const identifier = z
  .string()
  .min(1)
  .max(USERNAME_MAX_LENGTH)
  .regex(USERNAME_PATTERN, 'lettres, chiffres, point, tiret et underscore uniquement');

const albumId = z
  .string()
  .min(1)
  .max(USERNAME_MAX_LENGTH)
  .regex(ALBUM_ID_PATTERN, 'lettres, chiffres, point, tiret et underscore uniquement');

const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `au moins ${PASSWORD_MIN_LENGTH} caractères`)
  // Argon2 accepte des mots de passe bien plus longs ; la borne protège
  // simplement le CPU d'un hachage démesuré demandé par mégarde.
  .max(512);

/** `['*']` ou une liste d'ids. Le contenu est confronté aux albums existants. */
const albumList = z.array(z.union([z.literal(ALL_ALBUMS), albumId])).max(500);

const displayName = z.string().trim().max(DISPLAY_NAME_MAX_LENGTH).nullable().optional();

/**
 * La chaîne vide est acceptée à côté d'une adresse valide : c'est ce qu'envoie
 * un champ de formulaire qu'on vient de vider, et le refuser obligerait le
 * front à traduire « vide » en `null` avant chaque envoi. `ConfigRepo` ramène
 * les deux au même `NULL`.
 */
const email = z
  .union([z.string().trim().email('adresse invalide').max(EMAIL_MAX_LENGTH), z.literal('')])
  .nullable()
  .optional();

const createUserSchema = z.object({
  username: identifier,
  password,
  admin: z.boolean().default(false),
  albums: albumList.default([]),
  displayName,
  email,
});

const updateUserSchema = z.object({
  password: password.optional(),
  admin: z.boolean().optional(),
  albums: albumList.optional(),
  displayName,
  email,
  notify: z.boolean().optional(),
});

const moderationQuerySchema = z.object({
  filter: z.enum(['all', 'hidden']).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.coerce.number().int().positive().optional(),
});

const createAlbumSchema = z.object({
  id: albumId,
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  folderId: z.string().min(1).max(256),
  recursive: z.boolean().default(true),
});

const updateAlbumSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  folderId: z.string().min(1).max(256).optional(),
  recursive: z.boolean().optional(),
});

const updateSettingsSchema = z.object({
  // Une semaine de plafond : au-delà, `setInterval` n'est plus un réglage mais
  // une désactivation, qui s'écrit `0`.
  syncIntervalMinutes: z.number().int().min(0).max(10080).optional(),
  syncOnStartup: z.boolean().optional(),
  cacheMaxSizeGB: z.number().positive().max(10000).optional(),
});

/** Message d'erreur lisible : le chemin du champ fautif, puis la raison. */
function badRequest(reply: FastifyReply, error: z.ZodError): FastifyReply {
  const details = error.issues
    .map((issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`)
    .join(' ; ');
  return reply.code(400).send({ error: 'bad_request', message: `Requête invalide — ${details}` });
}

export function createAdminRoutes(context: AppContext): FastifyPluginAsync {
  const secureCookies = context.env.publicUrl.startsWith('https://');

  /** Vue album de l'administration : la config, l'index et l'état de sync. */
  function toAdminAlbum(album: StoredAlbum): AdminAlbum {
    const state = context.syncState.get(album.id);
    return {
      id: album.id,
      title: album.title,
      description: album.description,
      folderId: album.folderId,
      recursive: album.recursive,
      itemCount: context.media.stats(album.id).itemCount,
      lastSyncAt: state.lastSyncAt,
      syncStatus: state.status,
      syncError: state.error,
      members: context.config.members(album.id),
      createdAt: album.createdAt,
      updatedAt: album.updatedAt,
    };
  }

  /**
   * Une référence à un album inexistant est presque toujours une faute de
   * frappe qui priverait silencieusement quelqu'un de son accès — la même
   * vérification que faisait le chargement du YAML.
   */
  function unknownAlbum(albums: string[]): string | null {
    return albums.find((id) => id !== ALL_ALBUMS && !context.findAlbum(id)) ?? null;
  }

  return async (app) => {
    app.addHook('preHandler', requireAdmin);

    app.get('/status', async (_request, reply) => {
      const connection = context.drive.connection;
      const status: AdminStatus = {
        driveConnected: context.drive.connected,
        driveAccount: connection?.account ?? null,
        driveRevokedAt: connection?.revokedAt ?? null,
        oauthConfigured: context.drive.configured,
        albums: context.albums.map((album) => buildAlbum(album, context.media, context.syncState)),
        cache: context.cache.stats(),
        hiddenComments: context.comments.hiddenCount(),
        mailConfigured: context.mailer.enabled,
      };
      return reply.send(status);
    });

    /* ------------------------------------------------------------- comptes */

    app.get('/users', async (_request, reply) =>
      reply.send(context.config.users().map(toAdminUser)),
    );

    app.post('/users', async (request, reply) => {
      const parsed = createUserSchema.safeParse(request.body ?? {});
      if (!parsed.success) return badRequest(reply, parsed.error);
      const input = parsed.data;

      // Écraser un compte existant reviendrait à changer son mot de passe et
      // ses droits sans que personne ne l'ait demandé.
      if (context.config.user(input.username)) {
        return reply.code(409).send({
          error: 'conflict',
          message: `L'identifiant "${input.username}" est déjà pris.`,
        });
      }

      const missing = unknownAlbum(input.albums);
      if (missing) {
        return reply
          .code(400)
          .send({ error: 'unknown_album', message: `Album inconnu : "${missing}"` });
      }

      const user = context.config.createUser({
        username: input.username,
        passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
        admin: input.admin,
        albums: input.albums,
        displayName: input.displayName,
        email: input.email,
      });

      request.log.info(`Compte "${user.username}" créé`);
      return reply.code(201).send(toAdminUser(user));
    });

    app.patch('/users/:username', async (request, reply) => {
      const { username } = request.params as { username: string };
      const stored = context.config.user(username);
      if (!stored) {
        return reply.code(404).send({ error: 'not_found', message: 'Compte introuvable' });
      }

      const parsed = updateUserSchema.safeParse(request.body ?? {});
      if (!parsed.success) return badRequest(reply, parsed.error);
      const patch = parsed.data;

      // Retirer le rôle du dernier administrateur rendrait l'instance
      // inadministrable : plus personne ne pourrait connecter Drive, créer un
      // compte, ni même rendre le rôle à quiconque.
      if (patch.admin === false && stored.admin && context.config.adminCount() <= 1) {
        return reply.code(409).send({
          error: 'last_admin',
          message:
            "Impossible de retirer le rôle du dernier administrateur : l'instance " +
            "deviendrait inadministrable. Nomme un autre administrateur d'abord.",
        });
      }

      if (patch.albums) {
        const missing = unknownAlbum(patch.albums);
        if (missing) {
          return reply
            .code(400)
            .send({ error: 'unknown_album', message: `Album inconnu : "${missing}"` });
        }
      }

      const user = context.config.updateUser(stored.username, {
        passwordHash: patch.password
          ? await argon2.hash(patch.password, { type: argon2.argon2id })
          : undefined,
        admin: patch.admin,
        albums: patch.albums,
        displayName: patch.displayName,
        email: patch.email,
        notify: patch.notify,
      });

      /**
       * Changer un mot de passe ferme les sessions ouvertes : sinon le
       * navigateur déjà connecté continuerait de naviguer avec l'ancien, ce
       * qui est précisément ce qu'on cherche à couper.
       *
       * Retirer le rôle d'administrateur ne déconnecte pas : le compte reste
       * légitime, et `plugins/auth.ts` relit `admin` à chaque requête, donc
       * l'accès à /api/admin tombe dès la requête suivante. Modifier la liste
       * d'albums ne déconnecte pas non plus, pour la même raison.
       */
      if (patch.password) {
        context.sessions.destroyForUser(stored.username);
        request.log.info(
          `Sessions de "${stored.username}" fermées après changement de mot de passe`,
        );
      }

      return reply.send(toAdminUser(user));
    });

    app.delete('/users/:username', async (request, reply) => {
      const { username } = request.params as { username: string };
      const stored = context.config.user(username);
      if (!stored) {
        return reply.code(404).send({ error: 'not_found', message: 'Compte introuvable' });
      }

      if (stored.admin && context.config.adminCount() <= 1) {
        return reply.code(409).send({
          error: 'last_admin',
          message:
            "Impossible de supprimer le dernier administrateur : l'instance deviendrait " +
            'inadministrable.',
        });
      }

      context.config.deleteUser(stored.username);
      // Un compte supprimé ne doit pas continuer à naviguer avec sa session.
      context.sessions.destroyForUser(stored.username);
      request.log.info(`Compte "${stored.username}" supprimé, ses sessions sont fermées`);

      return reply.send({ ok: true });
    });

    /* ---------------------------------------------------------- modération */

    /**
     * File de modération, tous albums confondus — y compris ceux que cet
     * administrateur ne verrait pas dans la galerie. Modérer suppose de tout
     * lire : restreindre la file au périmètre de lecture laisserait des
     * commentaires que personne ne pourrait traiter.
     */
    app.get('/comments', async (request, reply) => {
      const parsed = moderationQuerySchema.safeParse(request.query);
      if (!parsed.success) return badRequest(reply, parsed.error);
      const { filter, limit, cursor } = parsed.data;

      return reply.send(context.comments.listForModeration(filter, limit, cursor ?? null));
    });

    app.post('/comments/:commentId/hide', async (request, reply) => {
      const id = Number((request.params as { commentId: string }).commentId);
      if (!Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ error: 'bad_request', message: 'Identifiant invalide' });
      }

      // Masquer deux fois n'est pas une erreur, mais ne doit pas réécrire la
      // date : c'est celle de la décision d'origine qui intéresse.
      if (!context.comments.hide(id, request.user!.username)) {
        const existing = context.comments.byId(id, request.user!);
        if (!existing) {
          return reply.code(404).send({ error: 'not_found', message: 'Commentaire introuvable' });
        }
      }

      request.log.info(`Commentaire ${id} masqué par "${request.user!.username}"`);
      return reply.send({ ok: true });
    });

    app.post('/comments/:commentId/show', async (request, reply) => {
      const id = Number((request.params as { commentId: string }).commentId);
      if (!Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ error: 'bad_request', message: 'Identifiant invalide' });
      }

      if (!context.comments.show(id)) {
        return reply.code(404).send({ error: 'not_found', message: 'Commentaire introuvable' });
      }

      request.log.info(`Commentaire ${id} rendu visible par "${request.user!.username}"`);
      return reply.send({ ok: true });
    });

    /* -------------------------------------------------------------- albums */

    app.get('/albums', async (_request, reply) =>
      reply.send(context.albums.map((album) => toAdminAlbum(album))),
    );

    app.post('/albums', async (request, reply) => {
      const parsed = createAlbumSchema.safeParse(request.body ?? {});
      if (!parsed.success) return badRequest(reply, parsed.error);
      const input = parsed.data;

      if (context.findAlbum(input.id)) {
        return reply
          .code(409)
          .send({ error: 'conflict', message: `L'album "${input.id}" existe déjà.` });
      }

      const album = context.config.createAlbum({
        id: input.id,
        title: input.title,
        description: input.description ?? null,
        folderId: input.folderId,
        recursive: input.recursive,
      });

      request.log.info(`Album "${album.id}" créé`);
      startSync(album, request.log);

      return reply.code(201).send(toAdminAlbum(album));
    });

    app.patch('/albums/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const stored = context.findAlbum(id);
      if (!stored) {
        return reply.code(404).send({ error: 'not_found', message: 'Album introuvable' });
      }

      const parsed = updateAlbumSchema.safeParse(request.body ?? {});
      if (!parsed.success) return badRequest(reply, parsed.error);
      const patch = parsed.data;

      const album = context.config.updateAlbum(id, patch);

      /**
       * Changer le dossier Drive change le contenu de l'album : les médias
       * indexés désignent l'ancien dossier et resteraient visibles — donc
       * consultables par les comptes qui ont cet album — jusqu'à la prochaine
       * synchronisation. Purge immédiate plutôt que d'attendre `deleteStale` :
       * la fenêtre entre les deux est exactement celle où l'album montre ce que
       * le propriétaire vient de vouloir retirer. La resynchronisation qui suit
       * le remplit à nouveau, sans qu'il ait à la déclencher lui-même.
       */
      if (patch.folderId !== undefined && patch.folderId !== stored.folderId) {
        const removed = context.media.clearAlbum(id);
        context.syncState.set(id, { lastSyncAt: null, status: 'never', error: null });
        request.log.info(
          `Album "${id}" : dossier Drive changé, ${removed} médias retirés de l'index`,
        );
        startSync(album, request.log);
      }

      return reply.send(toAdminAlbum(album));
    });

    app.delete('/albums/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!context.findAlbum(id)) {
        return reply.code(404).send({ error: 'not_found', message: 'Album introuvable' });
      }

      context.config.deleteAlbum(id);

      /**
       * L'index suit l'album : `pruneAlbums` retire ses médias et son état de
       * synchronisation. Un fichier présent dans un autre album y garde sa
       * ligne — la clé primaire est `(album_id, id)` — donc il reste
       * consultable par ce chemin-là, ce qui est le comportement voulu.
       *
       * Les dérivés en cache disque, eux, sont laissés en place : ils sont
       * indexés par id de fichier seul et sont donc partagés entre albums ;
       * les supprimer priverait les autres albums de leurs vignettes. Ceux qui
       * deviennent orphelins partiront par éviction LRU, ou tout de suite via
       * « vider le cache ». Ils sont régénérables, contrairement à l'index.
       */
      const removed = context.media.pruneAlbums(context.albums.map((album) => album.id));
      request.log.info(`Album "${id}" supprimé, ${removed} médias retirés de l'index`);

      return reply.send({ ok: true });
    });

    /* ------------------------------------------------------------ réglages */

    app.get('/settings', async (_request, reply) => reply.send(context.settings));

    app.patch('/settings', async (request, reply) => {
      const parsed = updateSettingsSchema.safeParse(request.body ?? {});
      if (!parsed.success) return badRequest(reply, parsed.error);

      // `updateSettings` applique aussi : limite du cache disque et
      // reprogrammation du minuteur de synchronisation, sans redémarrage.
      const settings: AppSettings = context.updateSettings(parsed.data);
      return reply.send(settings);
    });

    /* --------------------------------------------------------------- Drive */

    /**
     * Démarre le consentement Google. Le `state` est tiré au hasard, déposé
     * dans un cookie signé et recomparé au retour : sans ça, un tiers pourrait
     * faire aboutir un callback avec un code obtenu ailleurs et connecter le
     * Drive de quelqu'un d'autre à cette instance.
     */
    app.get('/oauth/start', async (_request, reply) => {
      if (!context.drive.configured) {
        return reply.code(400).send({
          error: 'oauth_not_configured',
          message: new DriveNotConfiguredError().message,
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

    app.post('/drive/disconnect', async (_request, reply) => {
      context.drive.disconnect();
      return reply.send({ ok: true });
    });

    app.post('/resync', async (request, reply) => {
      const parsed = resyncSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'bad_request', message: 'Paramètres invalides' });
      }

      if (!context.drive.connected) {
        return reply.code(503).send({
          error: 'drive_disconnected',
          message: 'Connecte Google Drive avant de lancer une synchronisation.',
        });
      }

      const targets = parsed.data.albumId
        ? context.albums.filter((album) => album.id === parsed.data.albumId)
        : context.albums;

      if (targets.length === 0) {
        return reply.code(404).send({ error: 'not_found', message: 'Album introuvable' });
      }

      // La sync tourne en tâche de fond : sur un gros album elle dépasse
      // largement le timeout d'une requête HTTP. L'avancement se suit via
      // `syncStatus` dans /status.
      void context.syncer.syncAll(targets).catch((error: unknown) => {
        request.log.error({ err: error }, 'Synchronisation en échec');
      });

      return reply.code(202).send({ started: targets.map((album) => album.id) });
    });

    app.post('/cache/clear', async (_request, reply) => {
      await context.cache.clear();
      return reply.send({ ok: true });
    });
  };

  /** Indexation en tâche de fond, silencieuse tant que Drive n'est pas connecté. */
  function startSync(album: StoredAlbum, log: FastifyBaseLogger): void {
    if (!context.drive.connected) return;
    void context.syncer.syncAll([album]).catch((error: unknown) => {
      log.error({ err: error }, `Synchronisation de l'album "${album.id}" en échec`);
    });
  }
}

/**
 * Callback OAuth. Monté hors du préfixe `/admin` parce que son URL est figée
 * dans la console Google — mais il exige la même session administrateur.
 */
export function createOAuthCallbackRoute(context: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.get('/callback', { preHandler: requireAdmin }, async (request, reply) => {
      const query = request.query as { code?: string; state?: string; error?: string };

      if (query.error) {
        return reply.redirect(`/admin?oauth=denied`);
      }
      if (!query.code || !query.state) {
        return reply.redirect(`/admin?oauth=invalid`);
      }

      const cookie = request.cookies[OAUTH_STATE_COOKIE];
      const unsigned = cookie ? request.unsignCookie(cookie) : null;
      if (!unsigned?.valid || unsigned.value !== query.state) {
        request.log.warn('State OAuth invalide, callback rejeté');
        return reply.redirect(`/admin?oauth=state_mismatch`);
      }

      reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/api' });

      try {
        await context.drive.completeAuth(query.code);
      } catch (error) {
        request.log.error({ err: error }, 'Connexion Drive en échec');
        return reply.redirect(`/admin?oauth=error`);
      }

      // Première connexion : l'index est vide, autant le remplir sans attendre
      // que l'administrateur clique sur « resynchroniser ».
      void context.syncer.syncAll(context.albums).catch((error: unknown) => {
        request.log.error({ err: error }, 'Synchronisation initiale en échec');
      });

      return reply.redirect(`/admin?oauth=connected`);
    });
  };
}
