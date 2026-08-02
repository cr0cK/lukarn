import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAlbum, useAlbumItems } from '../api/hooks';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { Lightbox } from '../components/Lightbox';
import { ShortcutsOverlay } from '../components/ShortcutsOverlay';
import { Spinner } from '../components/Spinner';
import { TopBar } from '../components/TopBar';
import { formatRange } from '../lib/format';
import { moveSelection, scrollSelectionIntoView, useGridLayout } from '../lib/useGridLayout';
import { useShortcut } from '../lib/useShortcut';

export default function AlbumPage(): ReactElement {
  const { albumId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const album = useAlbum(albumId);
  const { items, isPending, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useAlbumItems(albumId);

  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const grid = useGridLayout(items);

  // La photo ouverte vit dans l'URL : le bouton Retour la referme, et un lien
  // partagé rouvre exactement la même vue.
  const openedId = searchParams.get('photo');
  const openedIndex = openedId ? items.findIndex((item) => item.id === openedId) : -1;
  const isOpen = openedIndex >= 0;

  const openAt = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return;
      setSearchParams({ photo: item.id }, { replace: false });
    },
    [items, setSearchParams],
  );

  // Navigation d'une photo à l'autre dans la visionneuse : en `replace`, sinon
  // parcourir 50 photos aux flèches empilerait 50 entrées d'historique et le
  // bouton Retour ne ramènerait plus à la grille.
  const showAt = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return;
      setSearchParams({ photo: item.id }, { replace: true });
    },
    [items, setSearchParams],
  );

  const closeLightbox = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  // Une photo demandée par l'URL mais pas encore chargée : on continue de
  // paginer jusqu'à la trouver (ou jusqu'à la fin de l'album).
  useEffect(() => {
    if (openedId && openedIndex === -1 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [openedId, openedIndex, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Referme la visionneuse si la photo ciblée n'existe pas dans cet album.
  useEffect(() => {
    if (openedId && openedIndex === -1 && !hasNextPage && items.length > 0) closeLightbox();
  }, [openedId, openedIndex, hasNextPage, items.length, closeLightbox]);

  useEffect(() => {
    if (isOpen) setSelectedIndex(openedIndex);
  }, [isOpen, openedIndex]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Navigation clavier dans la grille. Désactivée quand la visionneuse est
  // ouverte : elle gère ses propres touches.
  useEffect(() => {
    if (isOpen || showShortcuts) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLElement && event.target.tagName === 'INPUT') return;

      const directions = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
        Home: 'home',
        End: 'end',
      } as const;

      const direction = directions[event.key as keyof typeof directions];
      if (direction) {
        event.preventDefault();
        setSelectedIndex((current) => moveSelection(grid.layout, current, direction, items.length));
        return;
      }

      if (event.key === 'Enter' && selectedIndex >= 0) {
        event.preventDefault();
        openAt(selectedIndex);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        void navigate('/');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, showShortcuts, grid.layout, items.length, selectedIndex, openAt, navigate]);

  useEffect(() => {
    if (!isOpen) scrollSelectionIntoView(grid.layout, grid.offsetTop, selectedIndex);
  }, [selectedIndex, isOpen, grid.layout, grid.offsetTop]);

  useShortcut('?', () => setShowShortcuts(true), !isOpen);

  const subtitle = album.data
    ? [
        `${album.data.itemCount.toLocaleString('fr-FR')} ${album.data.itemCount > 1 ? 'éléments' : 'élément'}`,
        formatRange(album.data.oldestAt, album.data.newestAt),
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <div className="min-h-full">
      <TopBar title={album.data?.title ?? 'Album'} subtitle={subtitle} back />

      <main className="mx-auto max-w-[2000px] px-4 py-4 sm:px-6">
        {isPending && <Spinner label="Chargement des photos" />}

        {error && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">
            Impossible de charger cet album.
          </p>
        )}

        {!isPending && items.length === 0 && !error && (
          <div className="rounded-xl border border-dashed border-ink-700 px-6 py-12 text-center">
            <p className="text-sm text-ink-300">Cet album ne contient encore aucune photo.</p>
            <p className="mt-1 text-xs text-ink-400">
              {album.data?.syncStatus === 'never'
                ? "Lance une synchronisation depuis la page d'administration."
                : 'Vérifie le dossier Drive associé.'}
            </p>
          </div>
        )}

        {items.length > 0 && (
          <JustifiedGrid
            grid={grid}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            onOpen={openAt}
            onLoadMore={loadMore}
            hasMore={hasNextPage}
          />
        )}

        {isFetchingNextPage && (
          <div className="flex justify-center py-8">
            <Spinner label="Chargement…" />
          </div>
        )}
      </main>

      {isOpen && (
        <Lightbox
          albumId={albumId}
          items={items}
          index={openedIndex}
          onIndexChange={showAt}
          onClose={closeLightbox}
          onNeedMore={loadMore}
        />
      )}

      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
