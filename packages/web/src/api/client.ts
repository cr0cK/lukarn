import {
  DEFAULT_SORT_ORDER,
  type AdminAlbum,
  type AdminCommentsPage,
  type AdminStatus,
  type AdminUser,
  type Album,
  type AlbumCommentCounts,
  type AlbumDay,
  type AppSettings,
  type BulkModerationResult,
  type Comment,
  type CommentsFeedPage,
  type CommentsPage,
  type CreateAlbumRequest,
  type CreateCommentRequest,
  type CreateUserRequest,
  type DevicePairingStart,
  type DevicePairingState,
  type DevicePollResult,
  type IdentityRequest,
  type ItemsPage,
  type MediaDetail,
  type MediaItem,
  type ModerationFilter,
  type SearchHit,
  type SessionUser,
  type SortOrder,
  type ThumbSize,
  type UpdateAlbumDayRequest,
  type UpdateAlbumRequest,
  type UpdateCommentRequest,
  type UpdateMediaRequest,
  type UpdateSettingsRequest,
  type UpdateUserRequest,
  type VerifyIdentityRequest,
  type VisitsOverview,
} from '@lukarn/shared';
import { activeLocale } from '../lib/i18n/locale';

/** API error carrying the HTTP status, to distinguish a 401 from a real failure. */
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
      // The language chosen in the menu, not the one the browser would send by
      // itself: the server writes its refusals in it, and records it against the
      // commenter identity so its emails arrive in the language being read.
      'Accept-Language': activeLocale(),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    // The session cookie is httpOnly and on the same origin.
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
      body?.message ?? `Error ${response.status}`,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * What the moderation queue requests from the server.
 *
 * Mirrors `ModerationQuery` from `@lukarn/shared`, except for the cursor: it
 * travels as text in the URL and is converted back to an integer only on arrival.
 */
export interface AdminCommentsQuery {
  filter: ModerationFilter;
  albumId: string | null;
  q: string | null;
  limit: number;
  cursor: string | null;
}

export const api = {
  me: () => request<SessionUser>('/auth/me'),

  /** Public: reports whether the instance still has no account. */
  setupState: () => request<{ needsSetup: boolean }>('/auth/setup-state'),

  login: (username: string, password: string) =>
    request<SessionUser>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  /* Pairing a screen without a keyboard — see D260809c. */

  startPairing: () => request<DevicePairingStart>('/auth/device/start', { method: 'POST' }),

  /**
   * Screen polling. The `deviceCode` goes in the body rather than the URL: it is
   * the exchange's only secret, and URLs appear in logs as well as history.
   */
  pollPairing: (deviceCode: string) =>
    request<DevicePollResult>('/auth/device/poll', {
      method: 'POST',
      body: JSON.stringify({ deviceCode }),
    }),

  pairingState: (userCode: string) =>
    request<DevicePairingState>(`/auth/device/${encodeURIComponent(userCode)}`),

  approvePairing: (userCode: string) =>
    request<{ ok: true }>(`/auth/device/${encodeURIComponent(userCode)}/approve`, {
      method: 'POST',
    }),

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

  albumDays: (albumId: string) =>
    request<AlbumDay[]>(`/albums/${encodeURIComponent(albumId)}/days`),

  /**
   * Entities found in library text. The server decides the scope — albums
   * assigned to the session — so there is nothing to pass to it.
   */
  search: (q: string) => request<SearchHit[]>(`/search?${new URLSearchParams({ q })}`),

  /**
   * Editing happens in the album, but the write goes through `/api/admin`: it
   * is the only prefix that responds with 403 (D50).
   */
  updateAlbumDay: (albumId: string, day: string, body: UpdateAlbumDayRequest) =>
    request<AlbumDay>(
      `/admin/albums/${encodeURIComponent(albumId)}/days/${encodeURIComponent(day)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  itemDetail: (albumId: string, mediaId: string) =>
    request<MediaDetail>(
      `/albums/${encodeURIComponent(albumId)}/items/${encodeURIComponent(mediaId)}`,
    ),

  /** Same split as `updateAlbumDay`: edit in the gallery, write under `/api/admin`. */
  updateMedia: (albumId: string, mediaId: string, body: UpdateMediaRequest) =>
    request<MediaItem>(
      `/admin/albums/${encodeURIComponent(albumId)}/items/${encodeURIComponent(mediaId)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  requestIdentityCode: (body: IdentityRequest) =>
    request<{ ok: true }>('/identity/request-code', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  verifyIdentity: (body: VerifyIdentityRequest) =>
    request<SessionUser>('/identity/verify', { method: 'POST', body: JSON.stringify(body) }),

  forgetIdentity: () => request<SessionUser>('/identity/forget', { method: 'POST' }),

  comments: (albumId: string, mediaId: string) =>
    request<CommentsPage>(
      `/comments/${encodeURIComponent(albumId)}/${encodeURIComponent(mediaId)}`,
    ),

  commentCounts: (albumId: string) =>
    request<AlbumCommentCounts>(`/comments/${encodeURIComponent(albumId)}`),

  /**
   * Activity feed. `albumId` restricts it to one album; `null` takes everything
   * the session may see — the server decides the scope, this parameter only
   * narrows it.
   */
  commentsFeed: (albumId: string | null, cursor: string | null) => {
    const params = new URLSearchParams();
    if (albumId) params.set('album', albumId);
    if (cursor) params.set('cursor', cursor);
    return request<CommentsFeedPage>(`/comments/feed?${params}`);
  },

  createComment: (albumId: string, mediaId: string, body: CreateCommentRequest) =>
    request<Comment>(`/comments/${encodeURIComponent(albumId)}/${encodeURIComponent(mediaId)}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateComment: (commentId: number, body: UpdateCommentRequest) =>
    request<Comment>(`/comments/${commentId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteComment: (commentId: number) =>
    request<void>(`/comments/${commentId}`, { method: 'DELETE' }),

  adminComments: (query: AdminCommentsQuery) => {
    const params = new URLSearchParams({ filter: query.filter, limit: String(query.limit) });
    if (query.albumId) params.set('albumId', query.albumId);
    if (query.q) params.set('q', query.q);
    if (query.cursor) params.set('cursor', query.cursor);
    return request<AdminCommentsPage>(`/admin/comments?${params}`);
  },

  hideComment: (commentId: number) =>
    request<{ ok: true }>(`/admin/comments/${commentId}/hide`, { method: 'POST' }),

  showComment: (commentId: number) =>
    request<{ ok: true }>(`/admin/comments/${commentId}/show`, { method: 'POST' }),

  hideCommenter: (commenterId: number) =>
    request<BulkModerationResult>(`/admin/commenters/${commenterId}/hide`, { method: 'POST' }),

  showCommenter: (commenterId: number) =>
    request<BulkModerationResult>(`/admin/commenters/${commenterId}/show`, { method: 'POST' }),

  adminStatus: () => request<AdminStatus>('/admin/status'),

  /** Who visited and what they viewed over the last `days` days. */
  visits: (days: number) =>
    request<VisitsOverview>(`/admin/visits?${new URLSearchParams({ days: String(days) })}`),

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
 * Text shown for a mutation error. Server messages are written for the user, so
 * they always take precedence over the generic fallback, which is only for
 * network failures where no message exists.
 */
export function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * Version discriminator in the URL. Derivatives are served as `immutable`: the
 * browser never revalidates them, so the URL itself must change when a Drive
 * file is replaced by a new version — the file identifier stays the same.
 */
const query = (version?: string | null): string => (version ? `?v=${version}` : '');
const suffix = (version?: string | null): string => (version ? `&v=${version}` : '');

/** Media URLs — built client-side and served by the Fastify proxy. */
export const mediaUrl = {
  thumb: (id: string, size: ThumbSize, version?: string | null) =>
    `/api/media/${encodeURIComponent(id)}/thumb?s=${size}${suffix(version)}`,
  full: (id: string, version?: string | null) =>
    `/api/media/${encodeURIComponent(id)}/full${query(version)}`,
  /** 4096 px render, requested only while zooming. */
  hd: (id: string, version?: string | null) =>
    `/api/media/${encodeURIComponent(id)}/hd${query(version)}`,
  original: (id: string, version?: string | null) =>
    `/api/media/${encodeURIComponent(id)}/original${query(version)}`,
  /**
   * Server-prepared version for codecs this browser cannot decode (D260809b).
   * Responds with 404 until it exists — preparation is anticipated and slow,
   * not triggered by the request.
   */
  playable: (id: string, version?: string | null) =>
    `/api/media/${encodeURIComponent(id)}/playable${query(version)}`,
  /**
   * The download carries the version like the others: served as `immutable`, it
   * would otherwise return the old content of a replaced Drive file from cache
   * for a year while the photo displayed beside it is the new one.
   */
  download: (id: string, version?: string | null) =>
    `/api/media/${encodeURIComponent(id)}/original?download=1${suffix(version)}`,
};
