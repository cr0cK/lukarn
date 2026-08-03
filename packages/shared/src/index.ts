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
 * Découpage de la grille en sections. Purement côté client : le serveur rend
 * une liste triée, c'est la mise en page qui la segmente.
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
  itemCount: number;
  /** Id du média utilisé comme couverture, `null` si l'album est vide. */
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

export interface SessionUser {
  username: string;
  admin: boolean;
  /** Nom affiché à côté des commentaires. Vaut `username` tant qu'aucun n'est saisi. */
  displayName: string;
}

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
 * Commentaires
 *
 * Un fil par média *et par album* : le même fichier Drive indexé sous deux
 * albums porte deux conversations distinctes. Voir `specs/04-securite-et-acces.md`.
 * ------------------------------------------------------------------------ */

/** Auteur d'un commentaire, réduit à ce que l'affichage demande. */
export interface CommentAuthor {
  username: string;
  /** Nom saisi dans /admin, ou `username` à défaut. Jamais vide. */
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

/** Longueur maximale d'un commentaire, contrôlée des deux côtés à l'identique. */
export const COMMENT_MAX_LENGTH = 2000;

export interface AdminStatus {
  /** `true` si un refresh token Google est stocké et utilisable. */
  driveConnected: boolean;
  driveAccount: string | null;
  /**
   * ISO 8601 si Google a cessé d'accepter le refresh token (accès retiré,
   * jeton expiré). `null` sinon. À distinguer d'une absence de connexion :
   * ici il y a eu autorisation, elle ne vaut simplement plus.
   */
  driveRevokedAt: string | null;
  /** `true` si GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET sont configurés. */
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

export interface AdminUser {
  username: string;
  admin: boolean;
  /** Liste d'ids d'albums, ou `['*']`. */
  albums: string[];
  /** Nom affiché à côté des commentaires. `null` si le compte s'en tient à son identifiant. */
  displayName: string | null;
  /** Adresse de notification. `null` si le compte n'en a pas — il ne recevra rien. */
  email: string | null;
  /** `false` après un désabonnement : le compte garde son adresse mais ne reçoit plus rien. */
  notify: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  admin?: boolean;
  albums?: string[];
  displayName?: string | null;
  email?: string | null;
}

/** Champs omis = inchangés. `password` absent laisse le mot de passe en place. */
export interface UpdateUserRequest {
  password?: string;
  admin?: boolean;
  albums?: string[];
  displayName?: string | null;
  email?: string | null;
  notify?: boolean;
}

export interface AdminAlbum {
  id: string;
  title: string;
  description: string | null;
  folderId: string;
  recursive: boolean;
  /** Nombre de médias indexés, et état de la dernière synchronisation. */
  itemCount: number;
  lastSyncAt: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  /** Comptes ayant explicitement accès, hors détenteurs du joker. */
  members: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateAlbumRequest {
  id: string;
  title: string;
  description?: string;
  folderId: string;
  recursive?: boolean;
}

export interface UpdateAlbumRequest {
  title?: string;
  description?: string | null;
  folderId?: string;
  recursive?: boolean;
}

export interface AppSettings {
  /** Minutes entre deux synchronisations automatiques. 0 pour désactiver. */
  syncIntervalMinutes: number;
  syncOnStartup: boolean;
  cacheMaxSizeGB: number;
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
  /** ISO 8601 du masquage, `null` si le commentaire est visible. */
  hiddenAt: string | null;
  /** Administrateur ayant masqué. Sur une instance à plusieurs, c'est à qui en reparler. */
  hiddenBy: string | null;
}

/** Ce que la section de modération demande : tout, ou seulement ce qui est masqué. */
export type ModerationFilter = 'all' | 'hidden';

export interface AdminCommentsPage {
  comments: AdminComment[];
  /** À repasser en `?cursor=`. `null` = fin de la liste. */
  nextCursor: string | null;
}

/** Contraintes de saisie, partagées pour valider des deux côtés à l'identique. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
export const USERNAME_MAX_LENGTH = 64;
export const ALBUM_ID_PATTERN = USERNAME_PATTERN;
export const PASSWORD_MIN_LENGTH = 8;
export const DISPLAY_NAME_MAX_LENGTH = 64;
/** Longueur maximale d'une adresse, telle que la fixe la RFC 5321. */
export const EMAIL_MAX_LENGTH = 254;
