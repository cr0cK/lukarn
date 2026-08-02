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
