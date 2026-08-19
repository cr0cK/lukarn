import {
  DEFAULT_SORT_ORDER,
  SEARCH_MIN_LENGTH,
  type AlbumDay,
  type CodeRequest,
  type CodeVerifyRequest,
  type CreateAlbumRequest,
  type CreateStorageRequest,
  type CreateCommentRequest,
  type FeedComment,
  type IdentityRequest,
  type InviteUserRequest,
  type CreateUserRequest,
  type ItemsPage,
  type Locale,
  type MediaDetail,
  type MediaItem,
  type SessionUser,
  type SortOrder,
  type UpdateAlbumDayRequest,
  type UpdateAlbumRequest,
  type UpdateStorageRequest,
  type UpdateMediaRequest,
  type UpdateSettingsRequest,
  type UpdateUserRequest,
  type VerifyIdentityRequest,
} from '@lukarn/shared';
import {
  type InfiniteData,
  type QueryClient,
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { logoChanged } from '../lib/branding';
import { useAdoptLocale } from '../lib/i18n';
import { ApiError, api, type AdminCommentsQuery } from './client';

export const queryKeys = {
  me: ['me'] as const,
  version: ['version'] as const,
  albums: ['albums'] as const,
  album: (id: string) => ['album', id] as const,
  // Sort order is part of the key: without it, TanStack Query would reuse pages
  // already loaded in the other direction, and accumulated cursors would keep
  // paginating backwards.
  items: (id: string, order: SortOrder) => ['items', id, order] as const,
  // Unlike media, no `order` is needed here: an album has the same annotated
  // days regardless of reading direction.
  days: (id: string) => ['days', id] as const,
  detail: (albumId: string, mediaId: string) => ['detail', albumId, mediaId] as const,
  comments: (albumId: string, mediaId: string) => ['comments', albumId, mediaId] as const,
  // Use the same `comments` prefix as threads: a broad invalidation (identity
  // change, moderation) must include their counts. Put the literal **after** the
  // album rather than before it: in front, it would collide with the thread for
  // an album named "counts", an identifier that nothing forbids.
  commentCounts: (albumId: string) => ['comments', albumId, 'counts'] as const,
  // Use the same construction as counts for the same reason: literal last. `''`
  // carries the global scope — an album identifier cannot be empty, so nothing
  // can be confused with it.
  commentsFeed: (albumId: string | null) => ['comments', albumId ?? '', 'feed'] as const,
  // Everything that restricts the queue belongs in the key, including the
  // cursor: adjacent pages are separate cache entries, making the return to the
  // previous page immediate. Invalidation remains broad — the
  // `['admin','comments']` prefix includes them all.
  adminComments: (query: AdminCommentsQuery) =>
    ['admin', 'comments', query.filter, query.albumId, query.q, query.cursor] as const,
  // The input belongs in the key: adjacent keystrokes are separate cache
  // entries, and deleting one character restores its list without a request.
  search: (q: string) => ['search', q] as const,
  adminStatus: ['admin', 'status'] as const,
  adminStorage: ['admin', 'storage'] as const,
  // The window belongs in the key: returning to "7 days" after "90" restores
  // its page without a request, and all three coexist in the cache.
  visits: (days: number) => ['admin', 'visits', days] as const,
  adminUsers: ['admin', 'users'] as const,
  adminAlbums: ['admin', 'albums'] as const,
  settings: ['admin', 'settings'] as const,
};

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: api.me,
    // A 401 is the normal response for a signed-out visitor, not an incident:
    // retrying would only delay the form.
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * What this instance runs, and whether a newer release exists.
 *
 * An hour of `staleTime` because the answer is a published release: it changes a
 * few times a year, and the server caches its own question for six hours anyway.
 * `retry: false` for the same reason the server logs its failure rather than
 * raising it — the line at the bottom of a menu is not worth three attempts, and
 * an instance cut off from the outside would retry on every mount.
 */
export function useVersion() {
  return useQuery({
    queryKey: queryKeys.version,
    queryFn: api.version,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}

/**
 * Reports an installation without any account. Without this, the sign-in screen
 * would reject every attempt without ever saying there is simply nobody to sign
 * in as.
 */
export function useSetupState() {
  return useQuery({
    queryKey: ['setup-state'],
    queryFn: api.setupState,
    staleTime: 60 * 1000,
  });
}

/**
 * Settles a session that has just opened: the language first, then the cache.
 *
 * **The order is the point.** `api/client.ts` announces the active language on every
 * request and `plugins/auth.ts` records what it receives against the identity, so the
 * album list refetched below would write this browser's language over the one the
 * invitation was written in — and the adoption would undo itself on the very first
 * request it caused.
 *
 * Only an account that **is** this person offers its language: a shared key stays on
 * the language of the browser reading it, since a household holding one key need not
 * read one language (D260812d).
 */
function settleSession(
  queryClient: QueryClient,
  user: SessionUser,
  adopt: (offered: Locale | null) => void,
): void {
  if (user.identityBound) adopt(user.identity?.locale ?? null);
  queryClient.setQueryData(queryKeys.me, user);
  void queryClient.invalidateQueries({ queryKey: queryKeys.albums });
}

export function useLogin() {
  const queryClient = useQueryClient();
  const adopt = useAdoptLocale();
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      api.login(username, password),
    onSuccess: (user) => settleSession(queryClient, user, adopt),
  });
}

/**
 * Asks for a code at an address. Nothing is settled until it is entered, and the
 * answer says nothing about whether the address is known here.
 */
export function useRequestSignInCode() {
  return useMutation({ mutationFn: (body: CodeRequest) => api.requestSignInCode(body) });
}

/**
 * Spends the code and opens the session, so it settles it exactly as `useLogin` does:
 * the returned user replaces the cached one and the album list is refetched for
 * whoever has just arrived. Without the first, the application would keep serving the
 * signed-out `me` until something else happened to refetch it.
 */
export function useVerifySignInCode() {
  const queryClient = useQueryClient();
  const adopt = useAdoptLocale();
  return useMutation({
    mutationFn: (body: CodeVerifyRequest) => api.verifySignInCode(body),
    onSuccess: (user) => settleSession(queryClient, user, adopt),
  });
}

/* --------------------------------------------------------------------------
 * Pairing a screen without a keyboard (D260809c)
 * ------------------------------------------------------------------------ */

/** Opens a request. Called on click, never when the page is displayed. */
export function useStartPairing() {
  return useMutation({ mutationFn: api.startPairing });
}

/**
 * Polls the requesting screen until the session arrives.
 *
 * It stops on approval as well as error: an expired request responds with 404,
 * and continuing to poll a dead code would keep a screen awake querying the
 * server all night.
 */
export function usePairingPoll(deviceCode: string | null, intervalMs: number) {
  const queryClient = useQueryClient();
  const adopt = useAdoptLocale();
  return useQuery({
    queryKey: ['pairing', 'poll', deviceCode],
    queryFn: async () => {
      const result = await api.pollPairing(deviceCode!);
      if (result.status === 'approved') settleSession(queryClient, result.user, adopt);
      return result;
    },
    enabled: deviceCode !== null,
    refetchInterval: (query) =>
      query.state.status === 'error' || query.state.data?.status === 'approved'
        ? false
        : intervalMs,
    // A 404 means the request is dead: retrying does not revive it.
    retry: false,
    gcTime: 0,
  });
}

/** What the phone reads before approval: does the code still exist? */
export function usePairingState(userCode: string) {
  return useQuery({
    queryKey: ['pairing', 'state', userCode],
    queryFn: () => api.pairingState(userCode),
    enabled: userCode.length > 0,
    retry: false,
    gcTime: 0,
  });
}

export function useApprovePairing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userCode: string) => api.approvePairing(userCode),
    onSuccess: (_result, userCode) =>
      queryClient.invalidateQueries({ queryKey: ['pairing', 'state', userCode] }),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    // Purge everything: the cache contains albums and media from the old
    // session, which do not belong to the next one.
    onSuccess: () => queryClient.clear(),
  });
}

export function useAlbums() {
  return useQuery({ queryKey: queryKeys.albums, queryFn: api.albums });
}

export function useAlbum(albumId: string) {
  return useQuery({ queryKey: queryKeys.album(albumId), queryFn: () => api.album(albumId) });
}

/**
 * Loads the album page by page in the requested chronological order and returns
 * the flattened list. The server cursor remains stable even if a sync inserts
 * media while scrolling, so no photo is skipped or duplicated.
 *
 * `enabled` covers the case where the direction is not known yet — the album is
 * not loaded and local storage has no value. Without it, the first opening would
 * load two hundred items in a direction discarded by the next response; the
 * query stays `pending`, so the grid Spinner covers the wait.
 */
export function useAlbumItems(
  albumId: string,
  order: SortOrder = DEFAULT_SORT_ORDER,
  enabled = true,
) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.items(albumId, order),
    queryFn: ({ pageParam }) => api.items(albumId, pageParam, order),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
  });

  const items = useMemo<MediaItem[]>(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  return { ...query, items };
}

/**
 * Annotated days in the album. Loaded only when grouping by day: when grouping
 * by month, notes are hidden and the request would serve no purpose.
 */
export function useAlbumDays(albumId: string, enabled: boolean) {
  const query = useQuery({
    queryKey: queryKeys.days(albumId),
    queryFn: () => api.albumDays(albumId),
    enabled,
  });

  // Index by day key because that is how the layout and headers consume it.
  // Rebuilding the Map on every render would invalidate memoisation of the
  // height calculation, and therefore the entire layout.
  const byDay = useMemo(
    () => new Map((query.data ?? []).map((day) => [day.day, day])),
    [query.data],
  );

  return { ...query, byDay };
}

/**
 * Annotates a day. The response replaces the row in the cache instead of
 * invalidating the list: header height depends on it, and another network round
 * trip would make the grid jump a second time.
 */
export function useUpdateAlbumDay(albumId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ day, body }: { day: string; body: UpdateAlbumDayRequest }) =>
      api.updateAlbumDay(albumId, day, body),
    onSuccess: (saved) => {
      queryClient.setQueryData<AlbumDay[]>(queryKeys.days(albumId), (current) => {
        const others = (current ?? []).filter((day) => day.day !== saved.day);
        // A day cleared of its note and place keeps its slot only if EXIF provides
        // one — mirror the server rule here so the header immediately returns to
        // its original height.
        const keep =
          saved.description !== null || saved.place !== null || saved.autoPlaces.length > 0;
        const next = keep ? [...others, saved] : others;
        return next.sort((a, b) => b.day.localeCompare(a.day));
      });
    },
  });
}

/**
 * Search suggestions. `q` has already been delayed by `useDebounced`: this hook
 * only knows the value it receives.
 *
 * `placeholderData` keeps the previous list visible during the next request.
 * Without it, every keystroke would empty then refill the list, and a list
 * flashing beneath a finger is unreadable — this is the only place where
 * responses arrive at keyboard pace.
 */
export function useSearch(q: string) {
  return useQuery({
    queryKey: queryKeys.search(q),
    queryFn: () => api.search(q),
    // The server responds with 400 below this threshold, rightly so: issuing no
    // request is better than showing an error for unfinished input.
    enabled: q.length >= SEARCH_MIN_LENGTH,
    placeholderData: keepPreviousData,
    // Searched text rarely changes — an album title or a note written once.
    // Reopening the field within a minute triggers nothing.
    staleTime: 60 * 1000,
  });
}

export function useMediaDetail(albumId: string, mediaId: string | null) {
  return useQuery({
    queryKey: queryKeys.detail(albumId, mediaId ?? ''),
    queryFn: () => api.itemDetail(albumId, mediaId!),
    enabled: mediaId !== null,
    staleTime: Infinity,
  });
}

/**
 * Describes a photo. The response **updates the cache** instead of invalidating
 * it, which is essential here: the item list is an infinite query, and
 * invalidation refetches **all** accumulated pages — after scrolling through
 * five pages, writing a caption would request a thousand rows again (the lesson
 * from D67).
 *
 * Use `setQueriesData` on the `['items', albumId]` prefix rather than an exact
 * key: the two sort orders are separate cache entries, and the unseen one holds
 * the same photo — reversing the sort later would otherwise show the old caption.
 */
export function useUpdateMedia(albumId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ mediaId, body }: { mediaId: string; body: UpdateMediaRequest }) =>
      api.updateMedia(albumId, mediaId, body),
    onSuccess: (saved) => {
      queryClient.setQueriesData<InfiniteData<ItemsPage>>(
        { queryKey: ['items', albumId] },
        (current) =>
          current && {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              items: page.items.map((item) => (item.id === saved.id ? saved : item)),
            })),
          },
      );

      // Detail carries the same description, and the `i` panel may be open when
      // saving. Because `MediaDetail` extends `MediaItem`, replace only the item
      // portion: EXIF and the comment count do not come from this response.
      queryClient.setQueryData<MediaDetail>(queryKeys.detail(albumId, saved.id), (current) =>
        current ? { ...current, ...saved } : current,
      );
    },
  });
}

/* --------------------------------------------------------------------------
 * Commenter identity
 * ------------------------------------------------------------------------ */

/** Requests the code. Changes nothing until it is entered. */
export function useRequestIdentityCode() {
  return useMutation({ mutationFn: (body: IdentityRequest) => api.requestIdentityCode(body) });
}

/**
 * Validates the code and attaches the identity to the session. The session
 * returned by the server replaces the cached one: it carries `identity`, and
 * therefore the right to comment.
 */
export function useVerifyIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: VerifyIdentityRequest) => api.verifyIdentity(body),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me, user);
      // Already loaded threads carry `canDelete` computed for an anonymous user:
      // identifying restores control over one's own messages.
      void queryClient.invalidateQueries({ queryKey: ['comments'] });
    },
  });
}

export function useForgetIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.forgetIdentity,
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me, user);
      void queryClient.invalidateQueries({ queryKey: ['comments'] });
    },
  });
}

/* --------------------------------------------------------------------------
 * Comments
 * ------------------------------------------------------------------------ */

/**
 * A photo's thread. Loaded only while the panel is open: most photos are viewed
 * without reading comments, and the count shown on the tab already comes from
 * media detail.
 */
export function useComments(albumId: string, mediaId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.comments(albumId, mediaId ?? ''),
    queryFn: () => api.comments(albumId, mediaId!),
    enabled: enabled && mediaId !== null,
  });
}

/**
 * Album comment counts, photo by photo.
 *
 * Loaded once for the whole album instead of for each photo reached: the viewer
 * badge must be present before anything is opened, and moving through an album
 * with the arrow keys would otherwise trigger one request per photo.
 */
export function useCommentCounts(albumId: string) {
  return useQuery({
    queryKey: queryKeys.commentCounts(albumId),
    queryFn: () => api.commentCounts(albumId),
    // Shorter than the default 60 seconds: a conversation starting while the
    // album is being viewed is precisely what the badge is meant to signal.
    //
    // This does not bound the delay to 30 seconds: `refetchOnWindowFocus` is
    // `false`, no `refetchInterval` is set, and this hook lives only in the
    // viewer — while it remains open, nothing restarts. This setting therefore
    // acts only on remount, when the viewer is reopened.
    staleTime: 30 * 1000,
  });
}

/**
 * Activity feed, page by page.
 *
 * Loaded as soon as a gallery page is shown, not only when the drawer opens: it
 * supplies the unread badge, and a badge appearing only after opening the
 * drawer would be useless — the drawer is opened only when something signals
 * that there is something to read.
 *
 * The same `staleTime` as album counts, for the same reason: a conversation
 * starting while its photos are being viewed is exactly what the badge announces.
 */
export function useCommentsFeed(albumId: string | null, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.commentsFeed(albumId),
    queryFn: ({ pageParam }) => api.commentsFeed(albumId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
    staleTime: 30 * 1000,
  });

  const comments = useMemo<FeedComment[]>(
    () => query.data?.pages.flatMap((page) => page.comments) ?? [],
    [query.data],
  );

  return { ...query, comments };
}

/**
 * Posts a comment. Both the thread **and** media detail are invalidated: the
 * latter carries the count shown on the tab, which would otherwise remain one
 * behind until the photo is reopened.
 */
export function useCreateComment(albumId: string, mediaId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCommentRequest) => api.createComment(albumId, mediaId, body),
    onSuccess: () => invalidateThread(queryClient, albumId, mediaId),
  });
}

/**
 * Corrects a comment. Only the thread is invalidated, not the counts: a
 * correction changes neither the number of messages nor what remains unread.
 */
export function useUpdateComment(albumId: string, mediaId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, body }: { commentId: number; body: string }) =>
      api.updateComment(commentId, { body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments(albumId, mediaId) });
    },
  });
}

export function useDeleteComment(albumId: string, mediaId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: number) => api.deleteComment(commentId),
    onSuccess: () => invalidateThread(queryClient, albumId, mediaId),
  });
}

function invalidateThread(queryClient: QueryClient, albumId: string, mediaId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.comments(albumId, mediaId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.detail(albumId, mediaId) });
  // Album counts supply the viewer badge: without this invalidation, posting
  // from the panel would leave the badge showing the previous state, even on
  // the photo currently displayed.
  void queryClient.invalidateQueries({ queryKey: queryKeys.commentCounts(albumId) });
  // Invalidate both activity-feed scopes, global and album: the newly
  // written message must appear in them, and both may be cached at once. The
  // cost is refetching drawer pages already visited — bounded by how far it
  // was scrolled, and the drawer is almost always closed while writing.
  void queryClient.invalidateQueries({ queryKey: queryKeys.commentsFeed(albumId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.commentsFeed(null) });
}

/**
 * One page of the moderation queue.
 *
 * One page at a time, not a `useInfiniteQuery`: every hide invalidates the queue,
 * and an infinite query then refetches **all** accumulated pages — after four
 * "Load more" actions, one click requested 200 rows again (D67).
 *
 * `keepPreviousData` keeps the previous page visible while loading the next:
 * without it, the list disappears on every page change and the section
 * collapses beneath the pointer.
 */
export function useAdminComments(query: AdminCommentsQuery) {
  return useQuery({
    queryKey: queryKeys.adminComments(query),
    queryFn: () => api.adminComments(query),
    placeholderData: keepPreviousData,
  });
}

/**
 * Hides or restores. The whole queue is invalidated because the processed
 * comment changes filter; so is the dashboard, for its hidden-comments badge.
 */
export function useModerateComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, hide }: { commentId: number; hide: boolean }) =>
      hide ? api.hideComment(commentId) : api.showComment(commentId),
    onSuccess: () => invalidateModeration(queryClient),
  });
}

/** Hides or restores every message from one identity at once. */
export function useModerateCommenter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ commenterId, hide }: { commenterId: number; hide: boolean }) =>
      hide ? api.hideCommenter(commenterId) : api.showCommenter(commenterId),
    onSuccess: () => invalidateModeration(queryClient),
  });
}

function invalidateModeration(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['admin', 'comments'] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.adminStatus });
  // The gallery thread changes too: a hidden comment disappears from it.
  void queryClient.invalidateQueries({ queryKey: ['comments'] });
}

/* --------------------------------------------------------------------------
 * Storage connections
 * ------------------------------------------------------------------------ */

/**
 * Every write invalidates the status as well as the list: an album row shows
 * whether its storage can serve anything, and a connection that just changed
 * state would leave the rest of the screen contradicting it.
 */
function invalidateStorage(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.adminStorage });
  void queryClient.invalidateQueries({ queryKey: queryKeys.adminStatus });
  void queryClient.invalidateQueries({ queryKey: queryKeys.adminAlbums });
}

export function useAdminStorage() {
  return useQuery({ queryKey: queryKeys.adminStorage, queryFn: api.adminStorage });
}

export function useCreateStorage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateStorageRequest) => api.createStorage(body),
    onSuccess: () => invalidateStorage(queryClient),
  });
}

export function useUpdateStorage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateStorageRequest }) =>
      api.updateStorage(id, body),
    onSuccess: () => invalidateStorage(queryClient),
  });
}

export function useDeleteStorage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteStorage(id),
    onSuccess: () => invalidateStorage(queryClient),
  });
}

/**
 * Asks the backend whether it answers. Deliberately **not** a query: it costs a
 * round trip to the storage itself, and it answers a question somebody asked by
 * pressing a button rather than one a screen asks by opening.
 */
export function useTestStorage() {
  return useMutation({ mutationFn: (id: string) => api.testStorage(id) });
}

export function useDisconnectStorage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.storageDisconnect(id),
    onSuccess: () => invalidateStorage(queryClient),
  });
}

export function useAdminStatus() {
  return useQuery({
    queryKey: queryKeys.adminStatus,
    queryFn: api.adminStatus,
    // A running sync changes the status without user action.
    refetchInterval: (query) =>
      query.state.data?.albums.some((album) => album.syncStatus === 'running') ? 2000 : false,
  });
}

/**
 * Visit telemetry. `placeholderData` keeps the table visible while loading the
 * next window: without it, changing periods would empty the page and collapse
 * the section beneath the pointer — the same reason as the moderation queue.
 */
export function useVisits(days: number) {
  return useQuery({
    queryKey: queryKeys.visits(days),
    queryFn: () => api.visits(days),
    placeholderData: keepPreviousData,
    // Counts change at the pace of visits, not seconds: reopening the tab within
    // a minute requests nothing.
    staleTime: 60 * 1000,
  });
}

/* --------------------------------------------------------------------------
 * Account, album and settings administration
 * ------------------------------------------------------------------------ */

/**
 * An account carries its albums and an album carries its members: both lists
 * describe the same assignment from opposite sides, so writing one makes the
 * other stale.
 */
function invalidateAccess(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
  void queryClient.invalidateQueries({ queryKey: queryKeys.adminAlbums });
}

/**
 * An album write also changes what the current session may view and the
 * dashboard that summarises it.
 */
function invalidateAlbums(queryClient: QueryClient): void {
  invalidateAccess(queryClient);
  void queryClient.invalidateQueries({ queryKey: queryKeys.adminStatus });
  void queryClient.invalidateQueries({ queryKey: queryKeys.albums });
}

/** Starts a sync: one given album, or all of them when the argument is omitted. */
export function useResync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (albumId?: string) => api.resync(albumId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminAlbums });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminStatus });
    },
  });
}

export function useAdminUsers() {
  return useQuery({ queryKey: queryKeys.adminUsers, queryFn: api.adminUsers });
}

export function useAdminAlbums() {
  return useQuery({
    queryKey: queryKeys.adminAlbums,
    queryFn: api.adminAlbums,
    // Same reason as `useAdminStatus`: a sync progresses by itself.
    refetchInterval: (query) =>
      query.state.data?.some((album) => album.syncStatus === 'running') ? 2000 : false,
  });
}

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: api.settings });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserRequest) => api.createUser(body),
    onSuccess: () => invalidateAccess(queryClient),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ username, body }: { username: string; body: UpdateUserRequest }) =>
      api.updateUser(username, body),
    onSuccess: () => invalidateAccess(queryClient),
  });
}

/**
 * Invites an existing account, or sends its invitation again.
 *
 * Only the account list changes: an invitation grants no album, so the album side of
 * the assignment is not stale and refetching it would be a request for nothing.
 */
export function useInviteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ username, body }: { username: string; body: InviteUserRequest }) =>
      api.inviteUser(username, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers }),
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => api.deleteUser(username),
    onSuccess: () => invalidateAccess(queryClient),
  });
}

export function useCreateAlbum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAlbumRequest) => api.createAlbum(body),
    onSuccess: () => invalidateAlbums(queryClient),
  });
}

export function useUpdateAlbum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ albumId, body }: { albumId: string; body: UpdateAlbumRequest }) =>
      api.updateAlbum(albumId, body),
    onSuccess: (album) => {
      invalidateAlbums(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.album(album.id) });
    },
  });
}

export function useDeleteAlbum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (albumId: string) => api.deleteAlbum(albumId),
    onSuccess: (_result, albumId) => {
      invalidateAlbums(queryClient);
      // The album's media have just disappeared from the index.
      queryClient.removeQueries({ queryKey: queryKeys.album(albumId) });
      queryClient.removeQueries({ queryKey: ['items', albumId] });
    },
  });
}

/**
 * Replaces the instance logo. The response says only whether one is now in force:
 * the image itself is read back from `/api/branding/logo`, the single URL every
 * surface already points at.
 */
export function useUploadLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadLogo(file),
    onSuccess: () => invalidateBranding(queryClient),
  });
}

export function useResetLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.resetLogo(),
    onSuccess: () => invalidateBranding(queryClient),
  });
}

/**
 * Tells the pages already open that the logo changed.
 *
 * Two halves, because the logo lives in two places the cache does not cover the
 * same way. The **image** is an `<img>` and a `<link rel="icon">`, neither of
 * which TanStack Query knows about: `logoChanged()` handles them
 * (`lib/branding.ts`). Whether a logo is **in force** is `AdminStatus.logoCustom`,
 * and that is what decides between "Choose an image" and "Replace" and whether
 * there is anything to reset — left stale, the form would show a new logo above a
 * sentence saying there is none.
 */
function invalidateBranding(queryClient: QueryClient): void {
  logoChanged();
  void queryClient.invalidateQueries({ queryKey: queryKeys.adminStatus });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSettingsRequest) => api.updateSettings(body),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.settings, settings);
      // The dashboard also reports the maximum cache size.
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminStatus });
    },
  });
}
