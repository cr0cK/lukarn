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

/**
 * Ce que la file de modération demande au serveur.
 *
 * Reprend `ModerationQuery` de `@gdv/shared`, au curseur près : il voyage en
 * texte dans l'URL, et n'est reconverti en entier qu'à l'arrivée.
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

  /** Publique : dit si l'instance n'a encore aucun compte. */
  setupState: () => request<{ needsSetup: boolean }>('/auth/setup-state'),

  login: (username: string, password: string) =>
    request<SessionUser>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  /* Appairage d'un écran sans clavier — voir D260809c. */

  startPairing: () => request<DevicePairingStart>('/auth/device/start', { method: 'POST' }),

  /**
   * Le sondage de l'écran. Le `deviceCode` part dans le corps et non dans
   * l'URL : c'est le seul secret de l'échange, et une URL se retrouve dans les
   * journaux comme dans l'historique.
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
   * Entités trouvées dans les textes de la bibliothèque. Le périmètre est
   * décidé par le serveur — les albums attribués à la session —, il n'y a rien
   * à lui passer.
   */
  search: (q: string) => request<SearchHit[]>(`/search?${new URLSearchParams({ q })}`),

  /**
   * La saisie se fait dans l'album, mais l'écriture passe par `/api/admin` :
   * c'est le seul préfixe qui répond 403 (D50).
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

  /** Même partage que `updateAlbumDay` : saisie dans la galerie, écriture sous `/api/admin`. */
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
   * Fil d'activité. `albumId` le restreint à un album ; `null` prend tout ce que
   * la session a le droit de voir — la portée est décidée par le serveur, ce
   * paramètre ne fait que la réduire.
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
  /**
   * Version préparée par le serveur, pour les codecs que ce navigateur ne décode
   * pas (D260809b). Répond 404 tant qu'elle n'existe pas — la préparation est
   * anticipée et lente, pas déclenchée par la demande.
   */
  playable: (id: string, version?: string | null) =>
    `/api/media/${encodeURIComponent(id)}/playable${query(version)}`,
  /**
   * Le téléchargement porte la version comme les autres : servi en `immutable`,
   * il resservirait sinon depuis le cache l'ancien contenu d'un fichier Drive
   * remplacé, pendant un an, alors que la photo affichée à côté est la neuve.
   */
  download: (id: string, version?: string | null) =>
    `/api/media/${encodeURIComponent(id)}/original?download=1${suffix(version)}`,
};
