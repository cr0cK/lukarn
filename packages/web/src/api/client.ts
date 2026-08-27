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
  type CodeRequest,
  type CodeVerifyRequest,
  type Comment,
  type CommentsFeedPage,
  type CommentsPage,
  type CreateAlbumRequest,
  type CreateCommentRequest,
  type CreateStorageRequest,
  type CreateUserRequest,
  type DevicePairingStart,
  type DevicePairingState,
  type DevicePollResult,
  type IdentityRequest,
  type InviteUserRequest,
  type MediaItem,
  type AdminShareLink,
  type CreateShareRequest,
  type ModerationFilter,
  type SearchHit,
  type ShareDetail,
  type ShareItemsPage,
  type ShareView,
  type SessionUser,
  type SortOrder,
  type StorageConnectionStatus,
  type StorageProbeResult,
  type ThumbSize,
  type UpdateAlbumDayRequest,
  type UpdateAlbumRequest,
  type UpdateCommentRequest,
  type UpdateMediaRequest,
  type UpdateSettingsRequest,
  type UpdateStorageRequest,
  type UpdateUserRequest,
  type VerifyIdentityRequest,
  type VersionInfo,
  type VisitsOverview,
} from '@lukarn/shared';
import { activeLocale } from '../lib/i18n/locale';

/**
 * What a page reads photographs and threads from.
 *
 * An album an account opened, or a **share link**. The two are served by different
 * address families on purpose: a shared photograph must have its album named nowhere
 * its recipient can reach, and that includes the addresses their own requests use
 * (D260825e). Threading this instead of a bare album identifier is what makes the
 * grid, the viewer and the comment stack serve both without knowing which they are on.
 */
export type Scope = { kind: 'album'; albumId: string } | { kind: 'share'; token: string };

export const albumScope = (albumId: string): Scope => ({ kind: 'album', albumId });
export const shareScope = (token: string): Scope => ({ kind: 'share', token });

/** Where this scope's items, details and threads are served from. */
function scopePath(scope: Scope): string {
  return scope.kind === 'album'
    ? `/albums/${encodeURIComponent(scope.albumId)}`
    : `/share/${encodeURIComponent(scope.token)}`;
}

/**
 * The scope as one cache-key segment.
 *
 * Prefixed by kind so an album and a link can never collide: both identifiers are
 * opaque strings, and a shared key would let one scope serve the other's pages out
 * of cache. Also the browser-storage key for reading order and seen comments.
 */
export function scopeKey(scope: Scope): string {
  return scope.kind === 'album' ? `album:${scope.albumId}` : `share:${scope.token}`;
}

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
      // Only a **string** body is JSON: every call below builds one with
      // `JSON.stringify`. A `File` carries its own type, and announcing JSON over
      // it made Fastify's JSON parser read the bytes as UTF-8 — the re-measured
      // length no longer matched `Content-Length`, and the logo upload failed with
      // a message about neither JSON nor images.
      ...(typeof init?.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
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

  /**
   * What this instance runs, and whether something newer exists. `update` only ever
   * arrives for an administrator — the server decides that, not the caller.
   */
  version: () => request<VersionInfo>('/version'),

  /** Public: reports whether the instance still has no account. */
  setupState: () => request<{ needsSetup: boolean }>('/auth/setup-state'),

  login: (username: string, password: string) =>
    request<SessionUser>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  /* Signing in as a person: a code sent to the address, in place of a password (D260819b). */

  /**
   * Asks for a code at an address. `202` for an address that opens an account, one
   * holding an invitation, one nothing knows and one asked again inside the minute
   * alike, so nothing here may report success as "this address exists".
   */
  requestSignInCode: (body: CodeRequest) =>
    request<{ ok: true }>('/auth/code/request', { method: 'POST', body: JSON.stringify(body) }),

  /** Spends the code, and this is what opens the session. */
  verifySignInCode: (body: CodeVerifyRequest) =>
    request<SessionUser>('/auth/code/verify', { method: 'POST', body: JSON.stringify(body) }),

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

  /** What a link opens: an album's heading, or the one photograph it was made from. */
  share: (token: string) => request<ShareView>(`/share/${encodeURIComponent(token)}`),

  /**
   * One page of the grid, from either scope.
   *
   * Typed as `ShareItemsPage`, the narrower of the two: an album's page carries an
   * `albumId` on every item that a link's does not, and nothing downstream reads it.
   * Declaring the wider shape here would let a component start doing so and break on
   * the share page only.
   */
  items: (
    scope: Scope,
    cursor: string | null,
    order: SortOrder = DEFAULT_SORT_ORDER,
    limit = 250,
  ) => {
    const params = new URLSearchParams({ limit: String(limit), order });
    if (cursor) params.set('cursor', cursor);
    return request<ShareItemsPage>(`${scopePath(scope)}/items?${params}`);
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

  itemDetail: (scope: Scope, mediaId: string) =>
    request<ShareDetail>(`${scopePath(scope)}/items/${encodeURIComponent(mediaId)}`),

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

  comments: (scope: Scope, mediaId: string) =>
    request<CommentsPage>(
      scope.kind === 'album'
        ? `/comments/${encodeURIComponent(scope.albumId)}/${encodeURIComponent(mediaId)}`
        : `/share/${encodeURIComponent(scope.token)}/comments/${encodeURIComponent(mediaId)}`,
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

  createComment: (scope: Scope, mediaId: string, body: CreateCommentRequest) =>
    request<Comment>(
      scope.kind === 'album'
        ? `/comments/${encodeURIComponent(scope.albumId)}/${encodeURIComponent(mediaId)}`
        : `/share/${encodeURIComponent(scope.token)}/comments/${encodeURIComponent(mediaId)}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

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

  adminStorage: () => request<StorageConnectionStatus[]>('/admin/storage'),

  createStorage: (body: CreateStorageRequest) =>
    request<StorageConnectionStatus>('/admin/storage', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateStorage: (id: string, body: UpdateStorageRequest) =>
    request<StorageConnectionStatus>(`/admin/storage/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteStorage: (id: string) =>
    request<{ ok: true }>(`/admin/storage/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** Asks the backend itself whether it answers, and returns what it said. */
  testStorage: (id: string) =>
    request<StorageProbeResult>(`/admin/storage/${encodeURIComponent(id)}/test`, {
      method: 'POST',
    }),

  oauthStart: (id: string) =>
    request<{ url: string }>(`/admin/storage/${encodeURIComponent(id)}/oauth/start`),

  storageDisconnect: (id: string) =>
    request<{ ok: true }>(`/admin/storage/${encodeURIComponent(id)}/disconnect`, {
      method: 'POST',
    }),

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

  /**
   * Invites an account that already exists, and sends its invitation again. With an
   * address it invites that account; with an empty body it remints the invitation
   * already pending, which is what the row offers when the first message went unread.
   */
  inviteUser: (username: string, body: InviteUserRequest) =>
    request<AdminUser>(`/admin/users/${encodeURIComponent(username)}/invite`, {
      method: 'POST',
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

  /**
   * Sends the chosen file as-is. No `FormData`, no `Content-Type`: the server
   * decides what the bytes are by decoding them, and a multipart envelope would
   * add a parser for a request that carries one field.
   */
  uploadLogo: (file: File) =>
    request<{ custom: boolean }>('/admin/branding/logo', { method: 'PUT', body: file }),

  resetLogo: () => request<{ custom: boolean }>('/admin/branding/logo', { method: 'DELETE' }),

  /* Share links — every mutation under the one prefix that answers 403 (D12, D50). */

  adminShares: () => request<AdminShareLink[]>('/admin/shares'),

  createShare: (body: CreateShareRequest) =>
    request<AdminShareLink>('/admin/shares', { method: 'POST', body: JSON.stringify(body) }),

  /** Keeps the row and its record of use; only deletion removes those (D260825b). */
  revokeShare: (token: string) =>
    request<{ ok: true }>(`/admin/shares/${encodeURIComponent(token)}/revoke`, { method: 'POST' }),

  deleteShare: (token: string) =>
    request<{ ok: true }>(`/admin/shares/${encodeURIComponent(token)}`, { method: 'DELETE' }),
};

/**
 * The instance logo, and the icons derived from it.
 *
 * Served as `no-cache`, so a change is picked up on the next request — but only
 * on a *new* request. `bust` appends the fingerprint of whatever just changed, so
 * an `<img>` already on the page reloads instead of showing the previous logo
 * until a navigation.
 */
export const brandingUrl = {
  logo: (bust?: string | number) => `/api/branding/logo${bust ? `?v=${bust}` : ''}`,
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
   * Server-prepared version for codecs this browser cannot decode (D6).
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
