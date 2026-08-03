import {
  DEFAULT_GROUP_BY,
  DEFAULT_SORT_ORDER,
  isGroupBy,
  isSortOrder,
  type GroupBy,
  type SortOrder,
} from '@gdv/shared';
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

  // Le sens de tri vit dans l'URL, comme la photo ouverte : un lien partagé
  // restitue la vue exacte. Une valeur inconnue (URL bricolée à la main) est
  // ramenée au défaut plutôt que de laisser l'API répondre 400.
  const orderParam = searchParams.get('order');
  const order: SortOrder = isSortOrder(orderParam) ? orderParam : DEFAULT_SORT_ORDER;

  // Le découpage en sections suit la même règle. Il ne concerne que la mise en
  // page : la requête est la même, seule la grille segmente autrement.
  const groupParam = searchParams.get('group');
  const groupBy: GroupBy = isGroupBy(groupParam) ? groupParam : DEFAULT_GROUP_BY;

  const album = useAlbum(albumId);
  const { items, isPending, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useAlbumItems(
    albumId,
    order,
  );

  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const grid = useGridLayout(items, groupBy);

  // La photo ouverte vit dans l'URL : le bouton Retour la referme, et un lien
  // partagé rouvre exactement la même vue.
  const openedId = searchParams.get('photo');
  const openedIndex = openedId ? items.findIndex((item) => item.id === openedId) : -1;
  const isOpen = openedIndex >= 0;

  // `photo`, `order` et `group` sont trois réglages indépendants de la même
  // URL : chaque écriture repart des paramètres courants, sinon ouvrir une
  // photo effacerait le tri et le refermer le rétablirait tout seul.
  const setParam = useCallback(
    (key: 'photo' | 'order' | 'group', value: string | null, replace: boolean) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value === null) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace },
      );
    },
    [setSearchParams],
  );

  const openAt = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return;
      setParam('photo', item.id, false);
    },
    [items, setParam],
  );

  // Navigation d'une photo à l'autre dans la visionneuse : en `replace`, sinon
  // parcourir 50 photos aux flèches empilerait 50 entrées d'historique et le
  // bouton Retour ne ramènerait plus à la grille.
  const showAt = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return;
      setParam('photo', item.id, true);
    },
    [items, setParam],
  );

  const closeLightbox = useCallback(() => {
    setParam('photo', null, true);
  }, [setParam]);

  const toggleOrder = useCallback(() => {
    const next: SortOrder = order === 'desc' ? 'asc' : 'desc';
    // Le défaut n'est pas écrit dans l'URL : elle reste courte, et l'album
    // revient à son adresse d'origine quand on rebascule.
    setParam('order', next === DEFAULT_SORT_ORDER ? null : next, false);
  }, [order, setParam]);

  const toggleGroupBy = useCallback(() => {
    const next: GroupBy = groupBy === 'month' ? 'day' : 'month';
    setParam('group', next === DEFAULT_GROUP_BY ? null : next, false);
  }, [groupBy, setParam]);

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

  // Inverser le tri renumérote tout l'album : conserver l'index sélectionné
  // désignerait une autre photo, et la position de défilement un autre mois.
  // Changer de regroupement ne renumérote rien, mais recalcule toutes les
  // hauteurs : la même ordonnée tombe ailleurs, et la sélection se retrouve
  // hors écran. Dans les deux cas on repart du haut.
  useEffect(() => {
    setSelectedIndex(-1);
    window.scrollTo({ top: 0 });
  }, [order, groupBy]);

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

  // Le bouton annonce l'état courant ; l'infobulle annonce ce que le clic fera.
  const orderLabel = order === 'desc' ? "Plus récentes d'abord" : "Plus anciennes d'abord";
  const orderAction =
    order === 'desc' ? "Afficher les plus anciennes d'abord" : "Afficher les plus récentes d'abord";

  // Même règle pour le regroupement : le libellé dit l'état, l'infobulle dit
  // l'effet du clic.
  const groupLabel = groupBy === 'month' ? 'Par mois' : 'Par jour';
  const groupAction = groupBy === 'month' ? 'Regrouper par jour' : 'Regrouper par mois';

  return (
    <div className="min-h-full">
      <TopBar title={album.data?.title ?? 'Album'} subtitle={subtitle} back>
        <button
          type="button"
          onClick={toggleOrder}
          title={orderAction}
          // Le libellé disparaît sous `sm` faute de place : le nom accessible
          // doit rester complet, et dire aussi l'effet du clic.
          aria-label={`Tri : ${orderLabel}. ${orderAction}.`}
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M12 5v14" />
            <path d={order === 'desc' ? 'm19 12-7 7-7-7' : 'm5 12 7-7 7 7'} />
          </svg>
          <span className="hidden sm:inline">{orderLabel}</span>
        </button>

        <button
          type="button"
          onClick={toggleGroupBy}
          title={groupAction}
          aria-label={`Regroupement : ${groupLabel}. ${groupAction}.`}
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
            {/* Plusieurs traits pour le mois, un seul repère pour le jour. */}
            <path d={groupBy === 'month' ? 'M7 14h10M7 17.5h6' : 'M11 14h2v3h-2z'} />
          </svg>
          <span className="hidden sm:inline">{groupLabel}</span>
        </button>
      </TopBar>

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
