/**
 * Contrat d'API partagé entre le serveur Fastify et le front React.
 * Toute forme de payload qui traverse le réseau est décrite ici — le front ne
 * redéclare jamais un type de réponse de son côté.
 */

/** Tailles de vignettes que le serveur accepte de générer. */
export const THUMB_SIZES = [320, 640, 1280] as const;
export type ThumbSize = (typeof THUMB_SIZES)[number];

export function isThumbSize(value: number): value is ThumbSize {
  return (THUMB_SIZES as readonly number[]).includes(value);
}

export type MediaKind = 'photo' | 'video';

/** Sens du tri chronologique d'un album. `desc` = le plus récent d'abord. */
export type SortOrder = 'desc' | 'asc';

/**
 * Découpage de la grille en sections. La liste servie ne change pas d'un
 * découpage à l'autre : le serveur rend une suite triée, c'est la mise en page
 * qui la segmente. Ce qui traverse le réseau, c'est la **préférence** de
 * l'album (`Album.groupBy`), pas le découpage d'une requête.
 *
 * Pas de regroupement par année : sur un album de vacances, il ne produirait
 * qu'une seule section, c'est-à-dire aucun repère.
 */
export type GroupBy = 'month' | 'day';

export const DEFAULT_GROUP_BY: GroupBy = 'month';

export function isGroupBy(value: unknown): value is GroupBy {
  return value === 'month' || value === 'day';
}

export const DEFAULT_SORT_ORDER: SortOrder = 'desc';

export function isSortOrder(value: unknown): value is SortOrder {
  return value === 'desc' || value === 'asc';
}

/**
 * Variante de rendu servie par le pipeline média.
 * `hd` existe pour le zoom : `full` est plafonné à 2560 px, ce qui suffit à
 * remplir un écran mais pas à examiner une photo à sa résolution native.
 */
export const IMAGE_VARIANTS = ['full', 'hd'] as const;
export type ImageVariant = (typeof IMAGE_VARIANTS)[number];

export interface MediaItem {
  id: string;
  albumId: string;
  name: string;
  kind: MediaKind;
  mimeType: string;
  /** Octets. `null` pour les rares fichiers Drive sans taille déclarée. */
  size: number | null;
  width: number | null;
  height: number | null;
  /** ISO 8601. Date de prise de vue EXIF si connue, sinon date de modification Drive. */
  takenAt: string;
  /** `true` si `takenAt` vient de l'EXIF, `false` s'il s'agit du repli Drive. */
  takenAtFromExif: boolean;
  /** Durée en millisecondes, uniquement pour les vidéos. */
  durationMs: number | null;
  /**
   * Empreinte courte du contenu, à joindre aux URLs média.
   *
   * Drive conserve l'identifiant d'un fichier dont on remplace le contenu par
   * une nouvelle version : sans ce discriminant dans l'URL, les dérivés servis
   * en `immutable` resteraient éternellement ceux de l'ancienne version.
   * `null` pour les rares fichiers sans empreinte.
   */
  version: string | null;
}

export interface MediaExif {
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  isoSpeed: number | null;
  exposureTime: number | null;
  aperture: number | null;
  focalLength: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface MediaDetail extends MediaItem {
  exif: MediaExif;
  /**
   * Nombre de commentaires visibles, réponses comprises. Servi avec le détail
   * pour que la visionneuse affiche le compte sur son bouton sans avoir à
   * charger le fil : la plupart des photos sont regardées sans qu'on ouvre les
   * commentaires.
   */
  commentCount: number;
}

export interface Album {
  id: string;
  title: string;
  description: string | null;
  /**
   * Découpage appliqué à l'ouverture, tant que l'URL n'en impose pas un autre.
   * Un séjour se lit par jour, dix ans de photos d'enfants par mois : le bon
   * découpage dépend de l'album, pas d'un défaut global.
   */
  groupBy: GroupBy;
  itemCount: number;
  /**
   * Id du média affiché en couverture : celui qu'un administrateur a choisi, ou
   * la photo la plus récente à défaut — y compris quand la photo choisie a
   * quitté l'index. `null` si l'album n'a aucune photo.
   */
  coverId: string | null;
  /** Empreinte de la couverture, à joindre à son URL. Voir `MediaItem.version`. */
  coverVersion: string | null;
  /** ISO 8601 des bornes chronologiques de l'album, `null` si vide. */
  newestAt: string | null;
  oldestAt: string | null;
  lastSyncAt: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
}

export type SyncStatus = 'never' | 'running' | 'ok' | 'error';

/**
 * Session en cours.
 *
 * `username` est une **clé d'accès**, pas une personne : le même identifiant
 * peut être partagé par plusieurs membres d'un foyer. Ce qui identifie
 * quelqu'un, c'est `identity` — déclaré par l'intéressé et vérifié par email.
 */
export interface SessionUser {
  username: string;
  admin: boolean;
  /** `null` tant que personne ne s'est identifié sur cette session. */
  identity: CommenterIdentity | null;
  /**
   * `false` si l'instance n'a pas de serveur SMTP : aucun code de vérification
   * ne peut partir, donc personne ne peut s'identifier ni commenter. L'interface
   * doit le dire plutôt que d'offrir un formulaire qui échouera.
   */
  commentsEnabled: boolean;
}

/**
 * Identité de commentateur, telle que son titulaire la voit. Présente
 * uniquement une fois l'adresse vérifiée : une identité non vérifiée n'est
 * rattachée à aucune session.
 */
export interface CommenterIdentity {
  email: string;
  displayName: string;
  /** `false` après un désabonnement depuis un email reçu. */
  notify: boolean;
}

/** Ce qu'on déclare pour s'identifier. L'adresse reçoit ensuite un code. */
export interface IdentityRequest {
  email: string;
  displayName: string;
}

export interface VerifyIdentityRequest {
  email: string;
  code: string;
}

/** Longueur du code envoyé par email. Six chiffres, saisis à la main. */
export const VERIFICATION_CODE_LENGTH = 6;

export interface LoginRequest {
  username: string;
  password: string;
}

export interface ItemsPage {
  items: MediaItem[];
  /** À repasser en `?cursor=` pour la page suivante. `null` = fin de l'album. */
  nextCursor: string | null;
}

/* --------------------------------------------------------------------------
 * Journées d'un album
 *
 * Une grille datée ne dit pas ce qu'on a fait. Une journée peut donc porter une
 * note, et le lieu que ses photos portent déjà dans leur EXIF.
 * ------------------------------------------------------------------------ */

/**
 * Une journée annotée. Servie uniquement pour les journées qui ont quelque
 * chose à montrer — inutile de transporter une ligne vide par jour d'album.
 */
export interface AlbumDay {
  /** `YYYY-MM-DD` en UTC, la même clé que le découpage par jour de la grille. */
  day: string;
  description: string | null;
  /**
   * Lieu saisi à la main. **Prime sur `autoPlaces`** : c'est une correction,
   * et une correction qu'un recalcul écraserait ne servirait à rien.
   */
  place: string | null;
  /**
   * Lieux déduits des coordonnées EXIF, du plus tôt au plus tard dans la
   * journée. Vide tant que le géocodage inverse n'a rien rendu — il est
   * asynchrone, et l'interface doit tenir sans lui.
   */
  autoPlaces: string[];
}

/** Champ absent = inchangé, `null` = effacé. */
export interface UpdateAlbumDayRequest {
  description?: string | null;
  place?: string | null;
}

/**
 * Une note de journée est un repère, pas un récit : deux lignes clampées dans
 * l'en-tête de section, dont la hauteur est précalculée par le layout. Une
 * longueur libre le rendrait dépendant d'une mesure DOM (D49).
 */
export const ALBUM_DAY_DESCRIPTION_MAX_LENGTH = 300;
export const ALBUM_DAY_PLACE_MAX_LENGTH = 120;

/* --------------------------------------------------------------------------
 * Commentaires
 *
 * Un fil par média *et par album* : le même fichier Drive indexé sous deux
 * albums porte deux conversations distinctes. Voir `specs/04-securite-et-acces.md`.
 * ------------------------------------------------------------------------ */

/**
 * Auteur d'un commentaire, réduit à ce que l'affichage demande.
 *
 * **L'adresse email n'y figure pas et ne doit jamais y figurer** : elle sert à
 * identifier et à notifier, pas à être diffusée aux autres lecteurs du fil.
 */
export interface CommentAuthor {
  /** Nom déclaré par l'intéressé, vérifié par email. Jamais vide. */
  displayName: string;
}

export interface Comment {
  id: number;
  /** `null` pour un commentaire de premier niveau, sinon l'id de la racine du fil. */
  parentId: number | null;
  author: CommentAuthor;
  body: string;
  createdAt: string;
  /**
   * `true` si le commentaire peut être supprimé par le lecteur courant — son
   * propre commentaire, ou n'importe lequel s'il est administrateur. Calculé
   * par le serveur : le front n'a pas à rejouer la règle d'autorisation.
   */
  canDelete: boolean;
  /**
   * `true` si le serveur accepterait une correction **à l'instant où il a rendu
   * cette réponse** : son auteur, et `COMMENT_EDIT_WINDOW_MS` non écoulées.
   *
   * Contrairement à `canDelete`, cette valeur **périme toute seule**. Le front
   * doit donc la recouper avec `createdAt` plutôt que s'y fier seule : un fil
   * resté ouvert une heure la porterait encore à `true`.
   */
  canEdit: boolean;
}

/**
 * Un commentaire racine et ses réponses. La hiérarchie s'arrête là : répondre
 * à une réponse rattache le message à la racine du fil (voir D35).
 */
export interface CommentThread {
  root: Comment;
  replies: Comment[];
}

export interface CommentsPage {
  threads: CommentThread[];
  /** Total visible, réponses comprises — ce qu'affiche le compteur du panneau. */
  total: number;
}

export interface CreateCommentRequest {
  body: string;
  /** Répondre à ce commentaire. Absent ou `null` pour ouvrir un nouveau fil. */
  parentId?: number | null;
}

/**
 * Nombre de commentaires visibles par photo, sur un album entier.
 *
 * Servi d'un bloc plutôt que photo par photo : la visionneuse doit pouvoir
 * marquer d'une pastille la photo qu'on vient d'atteindre, et demander ce compte
 * à chaque flèche coûterait une requête par photo traversée.
 *
 * Seules les photos commentées figurent dans `counts` — sur un album de
 * milliers de vues dont une dizaine porte une conversation, la réponse tient en
 * quelques centaines d'octets. Une photo absente vaut donc zéro.
 */
export interface AlbumCommentCounts {
  counts: Record<string, number>;
}

/** Ce qu'on renvoie pour corriger un commentaire. Le fil de rattachement ne bouge pas. */
export interface UpdateCommentRequest {
  body: string;
}

/**
 * Un commentaire situé hors de sa photo, tel que le fil d'activité le montre.
 *
 * Une conversation ne se découvre pas en ouvrant la bonne photo par hasard : sur
 * un album de milliers de vues, personne ne tombe sur les dix qui portent un
 * message. D'où le contexte joint au message — sans lui, la liste dirait que
 * quelqu'un a écrit, jamais où.
 */
export interface FeedComment extends Comment {
  albumId: string;
  albumTitle: string;
  mediaId: string;
  /**
   * `null` si la photo a quitté l'index depuis. Le message reste lisible —
   * l'effacer parce que son support a disparu supprimerait une parole que
   * personne n'a décidé de retirer — mais il n'a plus ni vignette ni lien.
   */
  mediaName: string | null;
  /** Empreinte de la photo, à joindre à l'URL de sa vignette. Voir `MediaItem.version`. */
  mediaVersion: string | null;
}

/**
 * Une page du fil d'activité, du plus récent au plus ancien.
 *
 * Le curseur est un identifiant de commentaire, comme celui de la modération :
 * `AUTOINCREMENT` fait que l'ordre des id est l'ordre d'écriture, ce qui évite
 * le curseur composite dont la pagination des médias a besoin.
 *
 * Pas de `total`, à l'inverse d'`AdminCommentsPage` : on ne modère pas ici, on
 * regarde ce qui vient d'arriver. Compter tout le corpus visible coûterait une
 * seconde requête pour un nombre que personne ne lirait.
 */
export interface CommentsFeedPage {
  comments: FeedComment[];
  nextCursor: string | null;
}

/**
 * Taille d'une page du fil d'activité.
 *
 * Assez large pour que la pastille des non-lus, plafonnée à « 9+ », se décide
 * toujours sur la seule première page — sinon un retour après une longue
 * absence afficherait « 9+ » puis un nombre plus petit à mesure du défilement.
 */
export const COMMENTS_FEED_PAGE_SIZE = 30;

/**
 * Délai pendant lequel son auteur peut corriger un commentaire.
 *
 * C'est une fenêtre de rattrapage de faute de frappe, pas un droit d'édition :
 * assez pour relire ce qu'on vient d'envoyer, trop court pour réécrire l'histoire
 * d'une conversation que d'autres ont déjà lue (voir `08-decisions.md`, D57).
 */
export const COMMENT_EDIT_WINDOW_MS = 30_000;

/**
 * Millisecondes restantes pour corriger, `0` une fois la fenêtre fermée.
 *
 * Partagée parce que les deux côtés doivent trancher **à l'identique** : le
 * serveur pour refuser, le front pour cesser de proposer. Deux calculs séparés
 * finiraient par diverger d'une seconde, et c'est exactement l'écart où l'on
 * clique sur un bouton qui répond non.
 */
export function remainingEditMs(createdAt: string, now: number): number {
  const started = Date.parse(createdAt);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, started + COMMENT_EDIT_WINDOW_MS - now);
}

/** Longueur maximale d'un commentaire, contrôlée des deux côtés à l'identique. */
export const COMMENT_MAX_LENGTH = 2000;

export interface AdminStatus {
  /**
   * Comment l'instance s'authentifie auprès de Drive. `service_account` :
   * une clé fournie par la configuration, rien à connecter ni à renouveler,
   * l'accès venant du partage du dossier côté Drive. `oauth` : le
   * consentement du propriétaire, à donner depuis /admin.
   */
  driveMode: 'service_account' | 'oauth';
  /** `true` si un refresh token Google est stocké et utilisable. */
  driveConnected: boolean;
  driveAccount: string | null;
  /**
   * ISO 8601 si Google a cessé d'accepter le refresh token (accès retiré,
   * jeton expiré). `null` sinon. À distinguer d'une absence de connexion :
   * ici il y a eu autorisation, elle ne vaut simplement plus.
   */
  driveRevokedAt: string | null;
  /** `true` si l'un des deux chemins d'authentification est configuré. */
  oauthConfigured: boolean;
  albums: Album[];
  cache: {
    entryCount: number;
    bytes: number;
    maxBytes: number;
  };
  /** Commentaires masqués, pour signaler la file de modération sans l'ouvrir. */
  hiddenComments: number;
  /**
   * `true` si SMTP_URL et MAIL_FROM sont configurés. Sans quoi renseigner une
   * adresse sur un compte ne produit rien, et l'écran d'administration doit le
   * dire plutôt que de laisser croire à des notifications qui ne partiront pas.
   */
  mailConfigured: boolean;
}

export interface ApiError {
  error: string;
  message: string;
}

/* --------------------------------------------------------------------------
 * Administration : comptes, albums et réglages
 *
 * Ces objets sont administrés depuis l'application et vivent en base. Le
 * fichier `config/albums.yaml` ne sert plus qu'à amorcer une installation
 * neuve : une fois la base peuplée, il n'est plus relu.
 * ------------------------------------------------------------------------ */

/** Le joker `*` donne accès à tous les albums, présents et à venir. */
export const ALL_ALBUMS = '*';

/**
 * Une clé d'accès. Elle ouvre des albums et peut être partagée entre plusieurs
 * personnes : aucune adresse email ne lui est attachée, celles-ci appartiennent
 * aux identités de commentateur.
 */
export interface AdminUser {
  username: string;
  admin: boolean;
  /** Liste d'ids d'albums, ou `['*']`. */
  albums: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  admin?: boolean;
  albums?: string[];
}

/** Champs omis = inchangés. `password` absent laisse le mot de passe en place. */
export interface UpdateUserRequest {
  password?: string;
  admin?: boolean;
  albums?: string[];
}

export interface AdminAlbum {
  id: string;
  title: string;
  description: string | null;
  folderId: string;
  recursive: boolean;
  /** Découpage appliqué à l'ouverture de l'album. Voir `Album.groupBy`. */
  groupBy: GroupBy;
  /** Nombre de médias indexés, et état de la dernière synchronisation. */
  itemCount: number;
  lastSyncAt: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  /** Comptes ayant explicitement accès, hors détenteurs du joker. */
  members: string[];
  /**
   * Photo **choisie** comme couverture, `null` si l'album prend automatiquement
   * la plus récente. À ne pas confondre avec `Album.coverId`, qui est la
   * couverture effectivement servie : celle-ci retombe sur l'automatique quand
   * la photo choisie n'est plus indexée, sans que ce choix soit effacé.
   */
  coverId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAlbumRequest {
  id: string;
  title: string;
  description?: string;
  folderId: string;
  recursive?: boolean;
  groupBy?: GroupBy;
}

export interface UpdateAlbumRequest {
  title?: string;
  description?: string | null;
  folderId?: string;
  recursive?: boolean;
  groupBy?: GroupBy;
  /**
   * Photo à afficher en couverture. Elle doit être indexée dans cet album et
   * ne pas être une vidéo. `null` rend le choix automatique.
   */
  coverId?: string | null;
}

/**
 * Longueur maximale d'une description d'album.
 *
 * Bien plus généreuse que celle d'une note de journée
 * (`ALBUM_DAY_DESCRIPTION_MAX_LENGTH`), et pour une raison de rendu : la note
 * vit dans un en-tête dont le layout précalcule la hauteur sans DOM, la
 * description d'album dans un paragraphe libre qui n'a rien à tenir (D49).
 */
export const ALBUM_DESCRIPTION_MAX_LENGTH = 2000;

export interface AppSettings {
  /** Minutes entre deux synchronisations automatiques. 0 pour désactiver. */
  syncIntervalMinutes: number;
  syncOnStartup: boolean;
  cacheMaxSizeGB: number;
  /**
   * Rendre les photos en fond, sans attendre qu'on les ouvre. Coupe la
   * première ouverture de plusieurs secondes à quelques millisecondes, au prix
   * de téléchargements Drive faits d'avance.
   */
  prewarmCache: boolean;
  /**
   * Adresse prévenue de chaque nouveau commentaire. `null` pour n'en prévenir
   * aucune.
   *
   * C'est un réglage d'instance et non une colonne sur les comptes : un compte
   * administrateur est une clé d'accès, pas quelqu'un de joignable, et
   * l'instance n'a qu'un propriétaire.
   */
  moderationEmail: string | null;
}

export type UpdateSettingsRequest = Partial<AppSettings>;

/**
 * Commentaire vu depuis la modération : les visiteurs lisent un fil sur une
 * photo qu'ils ont sous les yeux, l'administrateur balaie tous les albums et a
 * besoin de savoir de quelle photo on parle.
 */
export interface AdminComment extends Comment {
  albumId: string;
  albumTitle: string;
  mediaId: string;
  /** Nom du fichier Drive, ou `null` si le média a disparu de l'index depuis. */
  mediaName: string | null;
  /**
   * Adresse vérifiée de l'auteur. Visible **ici seulement** : la modération a
   * besoin de savoir qui parle derrière un nom déclaré, le fil non.
   */
  authorEmail: string;
  /**
   * Identité de l'auteur, cible de la modération groupée. Absente de `Comment`
   * pour la même raison qu'`authorEmail` : le fil public n'a pas à désigner une
   * personne par une clé stable, qui permettrait de recoller ses messages d'un
   * album à l'autre.
   */
  commenterId: number;
  /**
   * Clé d'accès utilisée pour écrire, `null` si elle a été supprimée depuis.
   * C'est elle qu'on change quand un mot de passe partagé a trop circulé.
   */
  account: string | null;
  /** ISO 8601 du masquage, `null` si le commentaire est visible. */
  hiddenAt: string | null;
  /** Administrateur ayant masqué. Sur une instance à plusieurs, c'est à qui en reparler. */
  hiddenBy: string | null;
}

/**
 * Ce que la file de modération demande : tout, ce qui est encore en ligne, ou
 * ce qui a été retiré. Les deux derniers partitionnent le premier.
 */
export type ModerationFilter = 'all' | 'visible' | 'hidden';

/** Ce que la file de modération sait restreindre, en plus du filtre. */
export interface ModerationQuery {
  filter: ModerationFilter;
  /** Restreint à un album, `null` pour tous. */
  albumId: string | null;
  /** Cherché dans le corps, le nom déclaré et l'adresse. `null` pour ne pas chercher. */
  q: string | null;
  limit: number;
  /** Identifiant de la dernière ligne de la page précédente. `null` pour la première. */
  cursor: number | null;
}

export interface AdminCommentsPage {
  comments: AdminComment[];
  /** À repasser en `?cursor=`. `null` = fin de la liste. */
  nextCursor: string | null;
  /**
   * Nombre de commentaires que le filtre retient, **curseur exclu** : c'est la
   * taille du corpus, pas celle du reste. Sans lui, une page ne dit pas si elle
   * est tout ce qu'il y a à modérer ou le centième.
   */
  total: number;
}

/** Ce que rend une modération groupée : le nombre de messages réellement touchés. */
export interface BulkModerationResult {
  affected: number;
}

/** Contraintes de saisie, partagées pour valider des deux côtés à l'identique. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
export const USERNAME_MAX_LENGTH = 64;
export const ALBUM_ID_PATTERN = USERNAME_PATTERN;
export const PASSWORD_MIN_LENGTH = 8;
export const DISPLAY_NAME_MAX_LENGTH = 64;
/** Longueur maximale d'une adresse, telle que la fixe la RFC 5321. */
export const EMAIL_MAX_LENGTH = 254;
