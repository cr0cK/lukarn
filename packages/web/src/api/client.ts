import type {
  AdminStatus,
  Album,
  ItemsPage,
  MediaDetail,
  SessionUser,
  ThumbSize,
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

  items: (albumId: string, cursor: string | null, limit = 250) => {
    const params = new URLSearchParams({ limit: String(limit) });
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

  reloadConfig: () =>
    request<{ ok: true; users: number; albums: number }>('/admin/reload', { method: 'POST' }),

  clearCache: () => request<{ ok: true }>('/admin/cache/clear', { method: 'POST' }),
};

/** URLs des médias — construites côté client, servies par le proxy Fastify. */
export const mediaUrl = {
  thumb: (id: string, size: ThumbSize) => `/api/media/${encodeURIComponent(id)}/thumb?s=${size}`,
  full: (id: string) => `/api/media/${encodeURIComponent(id)}/full`,
  original: (id: string) => `/api/media/${encodeURIComponent(id)}/original`,
  download: (id: string) => `/api/media/${encodeURIComponent(id)}/original?download=1`,
};
