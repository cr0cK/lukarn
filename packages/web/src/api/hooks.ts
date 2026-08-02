import type { MediaItem } from '@gdv/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ApiError, api } from './client';

export const queryKeys = {
  me: ['me'] as const,
  albums: ['albums'] as const,
  album: (id: string) => ['album', id] as const,
  items: (id: string) => ['items', id] as const,
  detail: (albumId: string, mediaId: string) => ['detail', albumId, mediaId] as const,
  adminStatus: ['admin', 'status'] as const,
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
 * Charge l'album page par page et rend la liste aplatie. Le curseur du serveur
 * est stable même si une synchronisation insère des médias pendant le
 * défilement, donc aucune photo n'est sautée ni dupliquée.
 */
export function useAlbumItems(albumId: string) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.items(albumId),
    queryFn: ({ pageParam }) => api.items(albumId, pageParam),
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

export function useAdminStatus() {
  return useQuery({
    queryKey: queryKeys.adminStatus,
    queryFn: api.adminStatus,
    // Une synchronisation en cours change l'état sans action de l'utilisateur.
    refetchInterval: (query) =>
      query.state.data?.albums.some((album) => album.syncStatus === 'running') ? 2000 : false,
  });
}
