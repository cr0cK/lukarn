import {
  DEFAULT_SORT_ORDER,
  SEARCH_MIN_LENGTH,
  type AlbumDay,
  type CreateAlbumRequest,
  type CreateCommentRequest,
  type FeedComment,
  type IdentityRequest,
  type CreateUserRequest,
  type ItemsPage,
  type MediaDetail,
  type MediaItem,
  type SortOrder,
  type UpdateAlbumDayRequest,
  type UpdateAlbumRequest,
  type UpdateMediaRequest,
  type UpdateSettingsRequest,
  type UpdateUserRequest,
  type VerifyIdentityRequest,
} from '@gdv/shared';
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
import { ApiError, api, type AdminCommentsQuery } from './client';

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
  // Même construction que les compteurs, et pour la même raison : le littéral
  // en dernier. `''` porte la portée globale — un identifiant d'album ne peut
  // pas être vide, donc rien ne s'y confond.
  commentsFeed: (albumId: string | null) => ['comments', albumId ?? '', 'feed'] as const,
  // Tout ce qui restreint la file entre dans la clé, curseur compris : deux
  // pages voisines sont deux entrées de cache distinctes, ce qui rend le retour
  // à la page précédente immédiat. L'invalidation reste large — le préfixe
  // `['admin','comments']` les emporte toutes.
  adminComments: (query: AdminCommentsQuery) =>
    ['admin', 'comments', query.filter, query.albumId, query.q, query.cursor] as const,
  // La saisie entre dans la clé : deux frappes voisines sont deux entrées de
  // cache, et revenir en arrière d'un caractère réaffiche sa liste sans requête.
  search: (q: string) => ['search', q] as const,
  adminStatus: ['admin', 'status'] as const,
  // La fenêtre entre dans la clé : revenir à « 7 jours » après « 90 » réaffiche
  // sa page sans requête, et les trois cohabitent en cache.
  visits: (days: number) => ['admin', 'visits', days] as const,
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

/* --------------------------------------------------------------------------
 * Appairage d'un écran sans clavier (D260809c)
 * ------------------------------------------------------------------------ */

/** Ouvre une demande. Appelée au clic, jamais à l'affichage de la page. */
export function useStartPairing() {
  return useMutation({ mutationFn: api.startPairing });
}

/**
 * Le sondage de l'écran demandeur, jusqu'à ce que la session arrive.
 *
 * Il s'arrête de lui-même sur l'approbation comme sur l'erreur : une demande
 * expirée répond 404, et continuer à sonder un code mort tiendrait un écran
 * allumé à interroger le serveur toute la nuit.
 */
export function usePairingPoll(deviceCode: string | null, intervalMs: number) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['pairing', 'poll', deviceCode],
    queryFn: async () => {
      const result = await api.pollPairing(deviceCode!);
      if (result.status === 'approved') {
        queryClient.setQueryData(queryKeys.me, result.user);
        void queryClient.invalidateQueries({ queryKey: queryKeys.albums });
      }
      return result;
    },
    enabled: deviceCode !== null,
    refetchInterval: (query) =>
      query.state.status === 'error' || query.state.data?.status === 'approved'
        ? false
        : intervalMs,
    // Un 404 dit que la demande est morte : la réessayer ne la ressuscite pas.
    retry: false,
    gcTime: 0,
  });
}

/** Ce que le téléphone lit avant d'approuver : le code existe-t-il encore ? */
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
 *
 * `enabled` couvre le cas où le sens n'est pas encore connu — album pas chargé
 * et rien en mémoire locale. Sans lui, la première ouverture chargerait deux
 * cents éléments dans un sens rejeté à la réponse suivante ; la requête reste
 * `pending`, donc le Spinner de la grille couvre l'attente.
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

/**
 * Suggestions de recherche. `q` est déjà retardé par `useDebounced` : ce hook
 * ne connaît que la valeur qu'on lui donne.
 *
 * `placeholderData` garde la liste précédente affichée le temps de la requête
 * suivante. Sans lui, chaque frappe la viderait puis la remplirait, et une
 * liste qui clignote sous le doigt est illisible — c'est le seul endroit de
 * l'application où une réponse arrive à la cadence du clavier.
 */
export function useSearch(q: string) {
  return useQuery({
    queryKey: queryKeys.search(q),
    queryFn: () => api.search(q),
    // Le serveur répond 400 en deçà, et il a raison : mieux vaut ne pas
    // demander que d'afficher une erreur pour une saisie en cours.
    enabled: q.length >= SEARCH_MIN_LENGTH,
    placeholderData: keepPreviousData,
    // Les textes cherchés changent rarement — un titre d'album, une note
    // écrite une fois. Rouvrir le champ dans la minute ne relance rien.
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
 * Décrit une photo. La réponse **corrige le cache** au lieu de l'invalider, et
 * c'est indispensable ici : la liste des items est une requête infinie, dont
 * une invalidation relance **toutes** les pages accumulées — après cinq pages
 * de défilement, écrire une légende redemanderait mille lignes (la leçon de
 * D67).
 *
 * `setQueriesData` sur le préfixe `['items', albumId]` et non sur une clé
 * exacte : les deux sens de tri sont deux entrées de cache distinctes, et celui
 * qu'on ne regarde pas porte la même photo — inverser le tri après coup
 * montrerait sinon l'ancienne légende.
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

      // Le détail porte la même description, et le panneau `i` peut être ouvert
      // à l'instant où l'on enregistre. `MediaDetail` étant un `MediaItem`
      // augmenté, seule la partie item est remplacée : l'EXIF et le compteur de
      // commentaires ne viennent pas de cette réponse.
      queryClient.setQueryData<MediaDetail>(queryKeys.detail(albumId, saved.id), (current) =>
        current ? { ...current, ...saved } : current,
      );
    },
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
 * Fil d'activité, page par page.
 *
 * Chargé dès l'affichage d'une page de la galerie et pas seulement à
 * l'ouverture du tiroir : c'est lui qui porte la pastille de non-lus, et une
 * pastille qui n'apparaîtrait qu'après avoir ouvert le tiroir ne servirait à
 * rien — on ne l'ouvre que si quelque chose signale qu'il y a à lire.
 *
 * Même `staleTime` que les compteurs de l'album, et pour le même motif : une
 * conversation qui démarre pendant qu'on regarde ses photos est exactement ce
 * que la pastille sert à annoncer.
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
  // Les deux portées du fil d'activité, la globale comme celle de l'album : le
  // message qu'on vient d'écrire doit y figurer, et les deux peuvent être en
  // cache en même temps. Le coût est celui d'un rechargement des pages déjà
  // parcourues du tiroir — borné par ce qu'on a fait défiler, et le tiroir est
  // presque toujours fermé au moment où l'on écrit.
  void queryClient.invalidateQueries({ queryKey: queryKeys.commentsFeed(albumId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.commentsFeed(null) });
}

/**
 * Une page de la file de modération.
 *
 * Une page à la fois, et non un `useInfiniteQuery` : chaque masquage invalide la
 * file, et une requête infinie recharge alors **toutes** les pages accumulées —
 * après quatre « Charger plus », un seul clic redemandait 200 lignes (D67).
 *
 * `keepPreviousData` garde la page précédente affichée le temps de la suivante :
 * sans lui, la liste disparaît à chaque changement de page et la section se
 * replie sous le curseur.
 */
export function useAdminComments(query: AdminCommentsQuery) {
  return useQuery({
    queryKey: queryKeys.adminComments(query),
    queryFn: () => api.adminComments(query),
    placeholderData: keepPreviousData,
  });
}

/**
 * Masque ou démasque. Toute la file est invalidée, puisque le commentaire traité
 * change de filtre ; le tableau de bord l'est aussi, pour sa pastille de
 * commentaires masqués.
 */
export function useModerateComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, hide }: { commentId: number; hide: boolean }) =>
      hide ? api.hideComment(commentId) : api.showComment(commentId),
    onSuccess: () => invalidateModeration(queryClient),
  });
}

/** Masque ou démasque tous les messages d'une identité, d'un coup. */
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
  // Le fil vu côté galerie change aussi : un commentaire masqué en disparaît.
  void queryClient.invalidateQueries({ queryKey: ['comments'] });
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

/**
 * Télémétrie de visite. `placeholderData` garde le tableau affiché le temps de
 * la fenêtre suivante : sans lui, changer de période viderait la page et la
 * section se replierait sous le curseur — même motif que la file de modération.
 */
export function useVisits(days: number) {
  return useQuery({
    queryKey: queryKeys.visits(days),
    queryFn: () => api.visits(days),
    placeholderData: keepPreviousData,
    // Les compteurs bougent au rythme des visites, pas des secondes : rouvrir
    // l'onglet dans la minute ne redemande rien.
    staleTime: 60 * 1000,
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
