import {
  DEFAULT_SORT_ORDER,
  type AlbumDay,
  type CreateAlbumRequest,
  type CreateCommentRequest,
  type IdentityRequest,
  type CreateUserRequest,
  type MediaItem,
  type ModerationFilter,
  type SortOrder,
  type UpdateAlbumDayRequest,
  type UpdateAlbumRequest,
  type UpdateSettingsRequest,
  type UpdateUserRequest,
  type VerifyIdentityRequest,
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
  // Pas de `order` ici, contrairement aux médias : les journées annotées d'un
  // album sont les mêmes quel que soit le sens de lecture.
  days: (id: string) => ['days', id] as const,
  detail: (albumId: string, mediaId: string) => ['detail', albumId, mediaId] as const,
  comments: (albumId: string, mediaId: string) => ['comments', albumId, mediaId] as const,
  // Sous le même préfixe `comments` que les fils : une invalidation large
  // (changement d'identité, modération) doit emporter les compteurs avec eux.
  // Le littéral est placé **après** l'album et non avant : devant, il entrerait
  // en collision avec le fil d'un album qui s'appellerait « counts », un
  // identifiant que rien n'interdit.
  commentCounts: (albumId: string) => ['comments', albumId, 'counts'] as const,
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

/**
 * Journées annotées de l'album. Chargées seulement en découpage par jour : en
 * découpage par mois, les notes sont masquées et la requête ne servirait à rien.
 */
export function useAlbumDays(albumId: string, enabled: boolean) {
  const query = useQuery({
    queryKey: queryKeys.days(albumId),
    queryFn: () => api.albumDays(albumId),
    enabled,
  });

  // Indexé par clé de jour : c'est ainsi que le layout et les en-têtes s'en
  // servent, et refaire la Map à chaque rendu invaliderait la mémoïsation du
  // calcul de hauteur, donc du layout entier.
  const byDay = useMemo(
    () => new Map((query.data ?? []).map((day) => [day.day, day])),
    [query.data],
  );

  return { ...query, byDay };
}

/**
 * Annote une journée. La réponse remplace la ligne dans le cache plutôt que
 * d'invalider la liste : la hauteur de l'en-tête en dépend, et un aller-retour
 * réseau de plus ferait sauter la grille une seconde fois.
 */
export function useUpdateAlbumDay(albumId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ day, body }: { day: string; body: UpdateAlbumDayRequest }) =>
      api.updateAlbumDay(albumId, day, body),
    onSuccess: (saved) => {
      queryClient.setQueryData<AlbumDay[]>(queryKeys.days(albumId), (current) => {
        const others = (current ?? []).filter((day) => day.day !== saved.day);
        // Une journée vidée de sa note et de son lieu ne garde sa place que si
        // l'EXIF lui en donne un — c'est la règle du serveur, rejouée ici pour
        // que l'en-tête retombe tout de suite à sa hauteur d'origine.
        const keep =
          saved.description !== null || saved.place !== null || saved.autoPlaces.length > 0;
        const next = keep ? [...others, saved] : others;
        return next.sort((a, b) => b.day.localeCompare(a.day));
      });
    },
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

/* --------------------------------------------------------------------------
 * Identité de commentateur
 * ------------------------------------------------------------------------ */

/** Demande l'envoi du code. Ne change rien tant qu'il n'est pas saisi. */
export function useRequestIdentityCode() {
  return useMutation({ mutationFn: (body: IdentityRequest) => api.requestIdentityCode(body) });
}

/**
 * Valide le code et rattache l'identité à la session. La session rendue par le
 * serveur remplace celle du cache : c'est elle qui porte `identity`, donc le
 * droit de commenter.
 */
export function useVerifyIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: VerifyIdentityRequest) => api.verifyIdentity(body),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me, user);
      // Les fils déjà chargés portent `canDelete` calculé pour un anonyme :
      // s'identifier rend la main sur ses propres messages.
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
 * Compteurs de commentaires de l'album, photo par photo.
 *
 * Chargé une fois pour l'album entier plutôt qu'à chaque photo atteinte : la
 * pastille de la visionneuse doit être là avant qu'on ouvre quoi que ce soit, et
 * parcourir un album à la flèche déclencherait sinon une requête par photo.
 */
export function useCommentCounts(albumId: string) {
  return useQuery({
    queryKey: queryKeys.commentCounts(albumId),
    queryFn: () => api.commentCounts(albumId),
    // Plus court que les 60 s par défaut : une conversation qui démarre pendant
    // qu'on regarde l'album est le cas même que la pastille sert à signaler.
    //
    // Ne borne pas pour autant le retard à 30 s : `refetchOnWindowFocus` est à
    // `false`, aucun `refetchInterval` n'est posé, et ce hook ne vit que dans la
    // visionneuse — tant qu'elle reste ouverte, rien ne repart. Ce réglage n'agit
    // donc qu'au remontage, c'est-à-dire à la réouverture de la visionneuse.
    staleTime: 30 * 1000,
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

/**
 * Corrige un commentaire. Seul le fil est invalidé, pas les compteurs : une
 * correction ne change ni le nombre de messages ni ce qui reste à lire.
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
  // Les compteurs de l'album portent la pastille de la visionneuse : sans cette
  // invalidation, publier depuis le panneau laisserait la pastille annoncer
  // l'état d'avant, y compris sur la photo qu'on a sous les yeux.
  void queryClient.invalidateQueries({ queryKey: queryKeys.commentCounts(albumId) });
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
