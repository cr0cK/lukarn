import {
  DEFAULT_SORT_ORDER,
  type AdminAlbum,
  type AdminStatus,
  type AdminUser,
  type Album,
  type AppSettings,
  type CreateAlbumRequest,
  type CreateUserRequest,
  type ItemsPage,
  type MediaDetail,
  type SessionUser,
  type SortOrder,
  type ThumbSize,
  type UpdateAlbumRequest,
  type UpdateSettingsRequest,
  type UpdateUserRequest,
} from '@gdv/shared';

/** Erreur d'API portant le code HTTP, pour distinguer un 401 d'une vraie panne. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    // Le cookie de session est httpOnly et sur la même origine.
    credentials: 'same-origin',
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    throw new ApiError(
      response.status,
      body?.error ?? 'unknown',
      body?.message ?? `Erreur ${response.status}`,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  me: () => request<SessionUser>('/auth/me'),

  login: (username: string, password: string) =>
    request<SessionUser>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  albums: () => request<Album[]>('/albums'),

  album: (albumId: string) => request<Album>(`/albums/${encodeURIComponent(albumId)}`),

  items: (
    albumId: string,
    cursor: string | null,
    order: SortOrder = DEFAULT_SORT_ORDER,
    limit = 250,
  ) => {
    const params = new URLSearchParams({ limit: String(limit), order });
    if (cursor) params.set('cursor', cursor);
    return request<ItemsPage>(`/albums/${encodeURIComponent(albumId)}/items?${params}`);
  },

  itemDetail: (albumId: string, mediaId: string) =>
    request<MediaDetail>(
      `/albums/${encodeURIComponent(albumId)}/items/${encodeURIComponent(mediaId)}`,
    ),

  adminStatus: () => request<AdminStatus>('/admin/status'),

  oauthStart: () => request<{ url: string }>('/admin/oauth/start'),

  driveDisconnect: () => request<{ ok: true }>('/admin/drive/disconnect', { method: 'POST' }),

  resync: (albumId?: string) =>
    request<{ started: string[] }>('/admin/resync', {
      method: 'POST',
      body: JSON.stringify(albumId ? { albumId } : {}),
    }),

  clearCache: () => request<{ ok: true }>('/admin/cache/clear', { method: 'POST' }),

  adminUsers: () => request<AdminUser[]>('/admin/users'),

  createUser: (body: CreateUserRequest) =>
    request<AdminUser>('/admin/users', { method: 'POST', body: JSON.stringify(body) }),

  updateUser: (username: string, body: UpdateUserRequest) =>
    request<AdminUser>(`/admin/users/${encodeURIComponent(username)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteUser: (username: string) =>
    request<{ ok: true }>(`/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' }),

  adminAlbums: () => request<AdminAlbum[]>('/admin/albums'),

  createAlbum: (body: CreateAlbumRequest) =>
    request<AdminAlbum>('/admin/albums', { method: 'POST', body: JSON.stringify(body) }),

  updateAlbum: (albumId: string, body: UpdateAlbumRequest) =>
    request<AdminAlbum>(`/admin/albums/${encodeURIComponent(albumId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteAlbum: (albumId: string) =>
    request<{ ok: true }>(`/admin/albums/${encodeURIComponent(albumId)}`, { method: 'DELETE' }),

  settings: () => request<AppSettings>('/admin/settings'),

  updateSettings: (body: UpdateSettingsRequest) =>
    request<AppSettings>('/admin/settings', { method: 'PATCH', body: JSON.stringify(body) }),
};

/**
 * Texte à afficher pour une erreur de mutation. Les messages du serveur sont
 * rédigés pour l'utilisateur : on les préfère toujours au repli générique, qui
 * ne sert qu'aux pannes réseau, où il n'y a aucun message.
 */
export function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * Discriminant de version dans l'URL. Les dérivés sont servis en `immutable` :
 * le navigateur ne revalide jamais, donc c'est l'URL elle-même qui doit changer
 * lorsqu'un fichier Drive est remplacé par une nouvelle version — l'identifiant
 * du fichier, lui, reste le même.
 */
const query = (version?: string | null): string => (version ? `?v=${version}` : '');
const suffix = (version?: string | null): string => (version ? `&v=${version}` : '');

/** URLs des médias — construites côté client, servies par le proxy Fastify. */
export const mediaUrl = {
  thumb: (id: string, size: ThumbSize, version?: string | null) =>
    `/api/media/${encodeURIComponent(id)}/thumb?s=${size}${suffix(version)}`,
  full: (id: string, version?: string | null) =>
    `/api/media/${encodeURIComponent(id)}/full${query(version)}`,
  /** Rendu 4096 px, demandé uniquement au zoom. */
  hd: (id: string, version?: string | null) =>
    `/api/media/${encodeURIComponent(id)}/hd${query(version)}`,
  original: (id: string, version?: string | null) =>
    `/api/media/${encodeURIComponent(id)}/original${query(version)}`,
  download: (id: string) => `/api/media/${encodeURIComponent(id)}/original?download=1`,
};
