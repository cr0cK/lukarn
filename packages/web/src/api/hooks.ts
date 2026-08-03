import {
  DEFAULT_SORT_ORDER,
  type CreateAlbumRequest,
  type CreateCommentRequest,
  type CreateUserRequest,
  type MediaItem,
  type ModerationFilter,
  type SortOrder,
  type UpdateAlbumRequest,
  type UpdateSettingsRequest,
  type UpdateUserRequest,
} from '@gdv/shared';
import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { ApiError, api } from './client';

export const queryKeys = {
  me: ['me'] as const,
  albums: ['albums'] as const,
  album: (id: string) => ['album', id] as const,
  // Le sens de tri fait partie de la clé : sans lui, TanStack Query resservirait
  // les pages déjà chargées dans l'autre sens, et les curseurs accumulés
  // continueraient de paginer à l'envers.
  items: (id: string, order: SortOrder) => ['items', id, order] as const,
  detail: (albumId: string, mediaId: string) => ['detail', albumId, mediaId] as const,
  comments: (albumId: string, mediaId: string) => ['comments', albumId, mediaId] as const,
  adminComments: (filter: ModerationFilter) => ['admin', 'comments', filter] as const,
  adminStatus: ['admin', 'status'] as const,
  adminUsers: ['admin', 'users'] as const,
  adminAlbums: ['admin', 'albums'] as const,
  settings: ['admin', 'settings'] as const,
};

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: api.me,
    // Un 401 est la réponse normale d'un visiteur non connecté, pas un incident :
    // réessayer ne ferait que retarder l'affichage du formulaire.
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Signale une installation sans aucun compte. Sans ça, l'écran de connexion
 * refuserait toutes les tentatives sans jamais dire qu'il n'y a simplement
 * personne à qui se connecter.
 */
export function useSetupState() {
  return useQuery({
    queryKey: ['setup-state'],
    queryFn: api.setupState,
    staleTime: 60 * 1000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      api.login(username, password),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me, user);
      void queryClient.invalidateQueries({ queryKey: queryKeys.albums });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    // Purge complète : le cache contient les albums et les médias de l'ancienne
    // session, qui ne regardent pas la suivante.
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
 * Charge l'album page par page, dans le sens chronologique demandé, et rend la
 * liste aplatie. Le curseur du serveur est stable même si une synchronisation
 * insère des médias pendant le défilement, donc aucune photo n'est sautée ni
 * dupliquée.
 */
export function useAlbumItems(albumId: string, order: SortOrder = DEFAULT_SORT_ORDER) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.items(albumId, order),
    queryFn: ({ pageParam }) => api.items(albumId, pageParam, order),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const items = useMemo<MediaItem[]>(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  return { ...query, items };
}

export function useMediaDetail(albumId: string, mediaId: string | null) {
  return useQuery({
    queryKey: queryKeys.detail(albumId, mediaId ?? ''),
    queryFn: () => api.itemDetail(albumId, mediaId!),
    enabled: mediaId !== null,
    staleTime: Infinity,
  });
}

/* --------------------------------------------------------------------------
 * Commentaires
 * ------------------------------------------------------------------------ */

/**
 * Fil d'une photo. Chargé seulement quand le panneau est ouvert : la plupart
 * des photos sont regardées sans qu'on lise les commentaires, et le compteur
 * affiché sur l'onglet vient déjà du détail du média.
 */
export function useComments(albumId: string, mediaId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.comments(albumId, mediaId ?? ''),
    queryFn: () => api.comments(albumId, mediaId!),
    enabled: enabled && mediaId !== null,
  });
}

/**
 * Poste un commentaire. Le fil **et** le détail du média sont invalidés :
 * le second porte le compteur affiché sur l'onglet, qui resterait sinon en
 * retard d'une unité jusqu'à la réouverture de la photo.
 */
export function useCreateComment(albumId: string, mediaId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCommentRequest) => api.createComment(albumId, mediaId, body),
    onSuccess: () => invalidateThread(queryClient, albumId, mediaId),
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
}

/** File de modération, paginée à la demande depuis /admin. */
export function useAdminComments(filter: ModerationFilter) {
  return useInfiniteQuery({
    queryKey: queryKeys.adminComments(filter),
    queryFn: ({ pageParam }) => api.adminComments(filter, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

/**
 * Masque ou démasque. Les deux filtres de la file sont invalidés, puisque le
 * commentaire traité passe de l'un à l'autre ; le tableau de bord l'est aussi,
 * pour sa pastille de commentaires masqués.
 */
export function useModerateComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, hide }: { commentId: number; hide: boolean }) =>
      hide ? api.hideComment(commentId) : api.showComment(commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'comments'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminStatus });
      // Le fil vu côté galerie change aussi : un commentaire masqué en disparaît.
      void queryClient.invalidateQueries({ queryKey: ['comments'] });
    },
  });
}

export function useAdminStatus() {
  return useQuery({
    queryKey: queryKeys.adminStatus,
    queryFn: api.adminStatus,
    // Une synchronisation en cours change l'état sans action de l'utilisateur.
    refetchInterval: (query) =>
      query.state.data?.albums.some((album) => album.syncStatus === 'running') ? 2000 : false,
  });
}

/* --------------------------------------------------------------------------
 * Administration des comptes, des albums et des réglages
 * ------------------------------------------------------------------------ */

/**
 * Un compte porte ses albums et un album porte ses membres : les deux listes
 * décrivent la même attribution des deux côtés, donc écrire l'une périme
 * l'autre.
 */
function invalidateAccess(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
  void queryClient.invalidateQueries({ queryKey: queryKeys.adminAlbums });
}

/**
 * Une écriture sur les albums change en plus ce que la session courante peut
 * consulter, et le tableau de bord qui les récapitule.
 */
function invalidateAlbums(queryClient: QueryClient): void {
  invalidateAccess(queryClient);
  void queryClient.invalidateQueries({ queryKey: queryKeys.adminStatus });
  void queryClient.invalidateQueries({ queryKey: queryKeys.albums });
}

/** Lance une synchronisation : un album donné, ou tous si l'argument est omis. */
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
    // Même raison que `useAdminStatus` : une synchronisation avance toute seule.
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
      // Les médias de l'album viennent de disparaître de l'index.
      queryClient.removeQueries({ queryKey: queryKeys.album(albumId) });
      queryClient.removeQueries({ queryKey: ['items', albumId] });
    },
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSettingsRequest) => api.updateSettings(body),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.settings, settings);
      // La taille maximale du cache est aussi rapportée par le tableau de bord.
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminStatus });
    },
  });
}
