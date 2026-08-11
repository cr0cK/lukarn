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
} from '@nonni/shared';
import argon2 from 'argon2';
import type { FastifyBaseLogger, FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { StoredAlbum } from '../config-repo.js';
import { toAdminUser } from '../config-repo.js';
import type { AppContext } from '../context.js';
import { DriveNotConfiguredError } from '../drive/service.js';
import { requireAdmin } from '../plugins/auth.js';
import { buildAlbum } from '../repo.js';

const OAUTH_STATE_COOKIE = 'nonni_oauth_state';
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

/**
 * Adresse prévenue de chaque commentaire. La chaîne vide est acceptée à côté
 * d'une adresse valide : c'est ce qu'envoie un champ de formulaire qu'on vient
 * de vider, et la refuser obligerait le front à traduire « vide » en `null`
 * avant chaque envoi. `ConfigRepo` ramène les deux au même `NULL`.
 */
const moderationEmail = z
  .union([z.string().trim().email('adresse invalide').max(EMAIL_MAX_LENGTH), z.literal('')])
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
  // Borné à 200 caractères comme le reste des saisies libres : au-delà, ce
  // n'est plus une recherche mais un corps de commentaire recollé.
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.coerce.number().int().positive().optional(),
});

/**
 * Fenêtre de la télémétrie de visite. Bornée à un an : au-delà, la purge
 * horaire a déjà oublié les journées, et la requête rendrait une fenêtre que la
 * base ne peut plus remplir.
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
  // Un identifiant de fichier Drive, borné comme celui d'un dossier. `null`
  // rend la couverture au choix automatique — la photo la plus récente.
  coverId: z.string().min(1).max(256).nullable().optional(),
});

/** `YYYY-MM-DD`, la clé de journée du découpage par jour. */
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'attendu : AAAA-MM-JJ');

/**
 * Note d'une journée. La chaîne vide est acceptée à côté d'un texte, pour la
 * même raison que `moderationEmail` : c'est ce qu'envoie un champ qu'on vient
 * de vider, et la refuser obligerait le front à traduire « vide » en `null`
 * avant chaque envoi. `AlbumDayRepo` ramène les deux au même `NULL`.
 */
const updateAlbumDaySchema = z.object({
  description: z.string().max(ALBUM_DAY_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  place: z.string().max(ALBUM_DAY_PLACE_MAX_LENGTH).nullable().optional(),
});

/** Légende d'une photo. Chaîne vide acceptée et ramenée à `null`, comme ci-dessus. */
const updateMediaSchema = z.object({
  description: z.string().max(MEDIA_DESCRIPTION_MAX_LENGTH).nullable().optional(),
});

const updateSettingsSchema = z.object({
  // Une semaine de plafond : au-delà, `setInterval` n'est plus un réglage mais
  // une désactivation, qui s'écrit `0`.
  syncIntervalMinutes: z.number().int().min(0).max(10080).optional(),
  syncOnStartup: z.boolean().optional(),
  cacheMaxSizeGB: z.number().positive().max(10000).optional(),
  prewarmCache: z.boolean().optional(),
  transcodeVideos: z.boolean().optional(),
  videoCacheMaxSizeGB: z.number().positive().max(10000).optional(),
  moderationEmail,
});

/** Identité visée par une modération groupée, ou `null` si le segment n'en est pas une. */
function commenterIdOf(params: unknown): number | null {
  const id = Number((params as { commenterId: string }).commenterId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

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
        driveMode: context.drive.mode,
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

    /**
     * Qui est venu, et ce qui a été regardé. Deux agrégations bornées à une
     * fenêtre de jours, lues d'une table déjà agrégée à l'écriture (D260809h).
     *
     * Les visites de la clé d'administration sont **montrées, pas exclues** :
     * les retirer ferait mentir les totaux, et la colonne « admin » suffit à
     * les lire pour ce qu'elles sont.
     */
    app.get('/visits', async (request, reply) => {
      const parsed = visitsQuerySchema.safeParse(request.query);
      if (!parsed.success) return badRequest(reply, parsed.error);

      const overview: VisitsOverview = context.visits.overview(parsed.data.days);
      return reply.send(overview);
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
        return reply.code(400).send({ error: 'bad_request', message: 'Identifiant invalide' });
      }

      // Masquer deux fois n'est pas une erreur, mais ne doit pas réécrire la
      // date : c'est celle de la décision d'origine qui intéresse.
      if (!context.comments.hide(id, request.user!.username)) {
        const existing = context.comments.byId(id, { commenterId: null, admin: true });
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

    /**
     * Modération groupée : tous les messages d'une même identité, d'un coup.
     *
     * Le geste d'après une clé d'accès qui a trop circulé, ou d'un commentateur
     * devenu insistant. Retirer quinze messages un par un est un travail que
     * personne ne fait — et laisser ce travail non fait est le vrai risque.
     *
     * L'identité et non la clé d'accès : c'est la personne qu'on modère. La clé
     * reste affichée à côté de chaque message, parce que c'est elle qu'on change
     * ensuite.
     */
    app.post('/commenters/:commenterId/hide', async (request, reply) => {
      const id = commenterIdOf(request.params);
      if (id === null) {
        return reply.code(400).send({ error: 'bad_request', message: 'Identifiant invalide' });
      }
      // Sans cette vérification, un identifiant inventé rendrait
      // « 0 message touché » — indiscernable d'une identité qui n'a rien écrit.
      if (!context.commenters.byId(id)) {
        return reply.code(404).send({ error: 'not_found', message: 'Identité introuvable' });
      }

      const affected = context.comments.hideAllFrom(id, request.user!.username);
      request.log.info(
        `${affected} commentaire(s) de l'identité ${id} masqués par "${request.user!.username}"`,
      );
      return reply.send({ affected });
    });

    app.post('/commenters/:commenterId/show', async (request, reply) => {
      const id = commenterIdOf(request.params);
      if (id === null) {
        return reply.code(400).send({ error: 'bad_request', message: 'Identifiant invalide' });
      }
      if (!context.commenters.byId(id)) {
        return reply.code(404).send({ error: 'not_found', message: 'Identité introuvable' });
      }

      const affected = context.comments.showAllFrom(id);
      request.log.info(
        `${affected} commentaire(s) de l'identité ${id} rendus visibles par ` +
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
        groupBy: input.groupBy,
        sortOrder: input.sortOrder,
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
      const { coverId, ...patch } = parsed.data;

      /**
       * Une couverture prise hors de cet album, ou posée sur une vidéo, ne
       * s'afficherait jamais : `stats` la refuse et l'album retomberait
       * silencieusement sur sa photo la plus récente. Le refus dit tout de
       * suite ce que ce silence ferait découvrir depuis la page d'accueil.
       */
      if (coverId) {
        const chosen = context.media.getDetail(id, coverId);
        if (!chosen || chosen.kind !== 'photo') {
          return reply.code(400).send({
            error: 'unknown_cover',
            message: "Cette couverture n'est pas une photo indexée dans cet album.",
          });
        }
      }

      const album = context.config.updateAlbum(id, { ...patch, coverMediaId: coverId });

      /**
       * Changer le périmètre change le contenu de l'album : les médias indexés
       * désignent l'ancien et resteraient visibles — donc consultables par les
       * comptes qui ont cet album — jusqu'à la prochaine synchronisation. Purge
       * immédiate plutôt que d'attendre `deleteStale` : la fenêtre entre les
       * deux est exactement celle où l'album montre ce que le propriétaire vient
       * de vouloir retirer. La resynchronisation qui suit le remplit à nouveau,
       * sans qu'il ait à la déclencher lui-même.
       *
       * `recursive` compte autant que `folderId` : le repasser à `false` doit
       * retirer les sous-dossiers tout de suite, et non à la prochaine sync
       * périodique — jamais, sur une instance où la sync automatique est
       * coupée.
       */
      const perimetreChange =
        (patch.folderId !== undefined && patch.folderId !== stored.folderId) ||
        (patch.recursive !== undefined && patch.recursive !== stored.recursive);

      if (perimetreChange) {
        const removed = context.media.clearAlbum(id);
        context.syncState.set(id, { lastSyncAt: null, status: 'never', error: null });
        request.log.info(
          `Album "${id}" : périmètre Drive changé, ${removed} médias retirés de l'index`,
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

    /**
     * Annote une journée. La **saisie** vit dans l'album, en face des photos
     * qu'on décrit ; la **mutation** reste ici, sous `/api/admin`. C'est ce qui
     * garde l'invariant « 403 nulle part ailleurs » : partout ailleurs, un
     * refus d'accès répond 404 pour ne pas révéler ce qui existe (D50).
     */
    app.patch('/albums/:id/days/:day', async (request, reply) => {
      const params = request.params as { id: string; day: string };
      if (!context.findAlbum(params.id)) {
        return reply.code(404).send({ error: 'not_found', message: 'Album introuvable' });
      }

      const day = dayKey.safeParse(params.day);
      if (!day.success) return badRequest(reply, day.error);

      const parsed = updateAlbumDaySchema.safeParse(request.body ?? {});
      if (!parsed.success) return badRequest(reply, parsed.error);

      return reply.send(context.days.upsertNote(params.id, day.data, parsed.data));
    });

    /**
     * Décrit une photo. Même partage que la journée ci-dessus : on écrit la
     * légende depuis la galerie, en voyant l'image et ses voisines, mais la
     * mutation reste sous `/api/admin` — le seul préfixe qui réponde 403,
     * l'invariant « refus d'accès = 404 » tenant partout ailleurs (D50).
     */
    app.patch('/albums/:id/items/:mediaId', async (request, reply) => {
      const params = request.params as { id: string; mediaId: string };
      if (!context.findAlbum(params.id)) {
        return reply.code(404).send({ error: 'not_found', message: 'Album introuvable' });
      }

      const parsed = updateMediaSchema.safeParse(request.body ?? {});
      if (!parsed.success) return badRequest(reply, parsed.error);

      // Décrire une photo absente de l'index laisserait un texte que rien
      // n'affiche jamais, sur un identifiant peut-être inventé.
      const item = context.media.setDescription(params.id, params.mediaId, parsed.data);
      if (!item) {
        return reply.code(404).send({ error: 'not_found', message: 'Média introuvable' });
      }

      return reply.send(item);
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
    /**
     * Le consentement n'a pas de sens en compte de service : l'autorisation
     * vient du partage du dossier côté Drive. Le refuser ici plutôt que de le
     * laisser aboutir évite d'enregistrer un jeton que rien n'utiliserait, et
     * de laisser croire qu'il faut le faire.
     */
    app.get('/oauth/start', async (_request, reply) => {
      if (context.drive.mode === 'service_account') {
        return reply.code(409).send({
          error: 'service_account_mode',
          message:
            "Cette instance s'authentifie avec un compte de service : il n'y a pas de " +
            'consentement à donner. Partage le dossier avec son adresse depuis Google Drive.',
        });
      }
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
      // Rien à déconnecter : la clé vient de la configuration, et l'accès du
      // partage Drive. Répondre « fait » laisserait croire que l'instance est
      // coupée alors qu'elle continue de tout lire.
      if (context.drive.mode === 'service_account') {
        return reply.code(409).send({
          error: 'service_account_mode',
          message:
            "Cette instance s'authentifie avec un compte de service : retire " +
            'GOOGLE_SERVICE_ACCOUNT_FILE, ou le partage du dossier côté Drive.',
        });
      }
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
      void context.syncThenPrewarm(targets).catch((error: unknown) => {
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
    void context.syncThenPrewarm([album]).catch((error: unknown) => {
      log.error({ err: error }, `Synchronisation de l'album "${album.id}" en échec`);
    });
  }
}

/**
 * Callback OAuth. Monté hors du préfixe `/admin` parce que son URL est figée
 * dans la console Google — mais il exige la même session administrateur.
 *
 * Les retours visent `/admin/serveur`, la rubrique qui porte le bouton de
 * connexion : c'est de là qu'on est parti, et le message y répond à un geste
 * encore en tête (D66).
 */
export function createOAuthCallbackRoute(context: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.get('/callback', { preHandler: requireAdmin }, async (request, reply) => {
      const query = request.query as { code?: string; state?: string; error?: string };

      if (query.error) {
        return reply.redirect(`/admin/serveur?oauth=denied`);
      }
      if (!query.code || !query.state) {
        return reply.redirect(`/admin/serveur?oauth=invalid`);
      }

      const cookie = request.cookies[OAUTH_STATE_COOKIE];
      const unsigned = cookie ? request.unsignCookie(cookie) : null;
      if (!unsigned?.valid || unsigned.value !== query.state) {
        request.log.warn('State OAuth invalide, callback rejeté');
        return reply.redirect(`/admin/serveur?oauth=state_mismatch`);
      }

      reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/api' });

      try {
        await context.drive.completeAuth(query.code);
      } catch (error) {
        request.log.error({ err: error }, 'Connexion Drive en échec');
        return reply.redirect(`/admin/serveur?oauth=error`);
      }

      // Première connexion : l'index est vide, autant le remplir sans attendre
      // que l'administrateur clique sur « resynchroniser ».
      void context.syncThenPrewarm(context.albums).catch((error: unknown) => {
        request.log.error({ err: error }, 'Synchronisation initiale en échec');
      });

      return reply.redirect(`/admin/serveur?oauth=connected`);
    });
  };
}
