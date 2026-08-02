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

/** Contraintes de saisie, partagées pour valider des deux côtés à l'identique. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
export const USERNAME_MAX_LENGTH = 64;
export const ALBUM_ID_PATTERN = USERNAME_PATTERN;
export const PASSWORD_MIN_LENGTH = 8;
