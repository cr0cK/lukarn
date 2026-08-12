import {
  DEFAULT_GROUP_BY,
  DEFAULT_SORT_ORDER,
  isGroupBy,
  type GroupBy,
  type SortOrder,
} from '@lukarn/shared';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAlbum, useAlbumDays, useAlbumItems, useMe } from '../api/hooks';
import { AlbumDescription } from '../components/AlbumDescription';
import { CommentsFeed, useActivityFeed } from '../components/CommentsFeed';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { Lightbox } from '../components/Lightbox';
import { ShortcutsOverlay } from '../components/ShortcutsOverlay';
import { isPanelTab, type PanelTab } from '../components/SidePanel';
import { Spinner } from '../components/Spinner';
import { TopBar } from '../components/TopBar';
import { resolveOrder, useStoredOrder } from '../lib/albumOrder';
import { formatRange } from '../lib/format';
import { useT } from '../lib/i18n';
import { isTyping } from '../lib/typing';
import { moveSelection, scrollSelectionIntoView, useGridLayout } from '../lib/useGridLayout';
import { useShortcut } from '../lib/useShortcut';

/** View settings carried by the album address bar. */
type ViewParam = 'photo' | 'panel' | 'order' | 'group' | 'day';

/**
 * Margin above a day targeted by the URL. The top bar is sticky and 64 px high:
 * placing the section at its exact coordinate would slide it underneath, making
 * the sought heading the only invisible element on screen.
 */
const DAY_SCROLL_MARGIN = 80;

export default function AlbumPage(): ReactElement {
  const t = useT();
  const { albumId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const album = useAlbum(albumId);
  const { data: me } = useMe();

  // Reading order comes from three sources in order: the URL — a shared link
  // restores the exact view —, what this browser remembers for the album, then
  // the album default. See `lib/albumOrder.ts`.
  const { stored: storedOrder, remember: rememberOrder } = useStoredOrder(albumId);
  const albumSortOrder = album.data?.sortOrder;
  const order = resolveOrder(searchParams.get('order'), storedOrder, albumSortOrder);
  // What the button announces while awaiting the album. The grid waits for the
  // actual order instead of displaying two hundred photos backwards.
  const shownOrder: SortOrder = order ?? DEFAULT_SORT_ORDER;

  // Section grouping follows the same rule except for browser memory. A trip is
  // read by day, ten years of children's photos by month, and nobody should need
  // to request it on every opening.
  const albumGroupBy = album.data?.groupBy ?? DEFAULT_GROUP_BY;
  const groupParam = searchParams.get('group');
  const groupBy: GroupBy = isGroupBy(groupParam) ? groupParam : albumGroupBy;

  const { items, isPending, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useAlbumItems(
    albumId,
    order ?? undefined,
    order !== null,
  );

  // The open photo lives in the URL: Back closes it, and a shared link restores
  // the exact same view.
  const openedId = searchParams.get('photo');
  const openedIndex = openedId ? items.findIndex((item) => item.id === openedId) : -1;
  const isOpen = openedIndex >= 0;

  // The panel tab follows the same rule, allowing direct arrival at the
  // conversation: the activity drawer and notification emails link to
  // `?photo=…&panel=comments`. Without the parameter, they would open the photo
  // with messages closed and therefore invisible.
  const panelParam = searchParams.get('panel');
  const panel: PanelTab | null = isPanelTab(panelParam) ? panelParam : null;

  // The viewer carries day context and therefore needs notes even when grouped
  // by month. Use the grid's `queryKey`: opening a photo from a day-grouped album
  // triggers no new request.
  const { byDay, isPending: daysPending } = useAlbumDays(albumId, groupBy === 'day' || isOpen);

  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const activity = useActivityFeed();

  // Collapsed sections by key. Memory-only deliberately: a list of collapsed
  // days would make the URL unreadable; persisted, it could reopen an empty album
  // months later without explanation.
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(() => new Set());

  const toggleSection = useCallback((key: string) => {
    setCollapsedKeys((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const grid = useGridLayout(items, groupBy, byDay, collapsedKeys);

  // `photo`, `panel`, `order` and `group` are four independent settings in one
  // URL: every write starts from current parameters, or opening a photo would
  // clear sorting and closing it would restore sorting by itself. Update several
  // keys together for actions touching two — closing the viewer removes the photo
  // **and** panel, while two writes would leave an intermediate history entry
  // where one disappeared without the other.
  const setParams = useCallback(
    (values: Partial<Record<ViewParam, string | null>>, replace: boolean) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(values)) {
            if (value === null) next.delete(key);
            else next.set(key, value);
          }
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
      setParams({ photo: item.id }, false);
    },
    [items, setParams],
  );

  // Use `replace` for viewer photo navigation, or moving through 50 photos with
  // arrows would stack 50 history entries and Back would no longer return to the grid.
  const showAt = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return;
      setParams({ photo: item.id }, true);
    },
    [items, setParams],
  );

  // The panel leaves with the photo: left alone in the URL, it would open the
  // next photo on a tab nobody requested again.
  const closeLightbox = useCallback(() => {
    setParams({ photo: null, panel: null }, true);
  }, [setParams]);

  // Use `replace` like photo navigation: opening and closing the panel three times
  // would otherwise stack six history entries between the grid and Back.
  const setPanel = useCallback(
    (next: PanelTab | null) => {
      setParams({ panel: next }, true);
    },
    [setParams],
  );

  const toggleOrder = useCallback(() => {
    const next: SortOrder = shownOrder === 'desc' ? 'asc' : 'desc';
    // Always remembered by the browser to avoid switching the same album on
    // every visit. In the URL, write the parameter only when it contradicts the
    // album preference — the `toggleGroupBy` rule: returning to the preference
    // restores the album's original address.
    rememberOrder(next);
    setParams({ order: next === albumSortOrder ? null : next }, false);
  }, [shownOrder, albumSortOrder, rememberOrder, setParams]);

  const toggleGroupBy = useCallback(() => {
    const next: GroupBy = groupBy === 'month' ? 'day' : 'month';
    // Write the parameter only when it contradicts the album preference:
    // returning to the preference must restore the original address, or a shared
    // link would carry a `?group=` saying nothing extra.
    setParams({ group: next === albumGroupBy ? null : next }, false);
  }, [groupBy, albumGroupBy, setParams]);

  // For a photo requested by the URL but not loaded yet, keep paginating until
  // it is found or the album ends.
  useEffect(() => {
    if (openedId && openedIndex === -1 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [openedId, openedIndex, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Close the viewer if the target photo does not exist in this album.
  useEffect(() => {
    if (openedId && openedIndex === -1 && !hasNextPage && items.length > 0) closeLightbox();
  }, [openedId, openedIndex, hasNextPage, items.length, closeLightbox]);

  // Reversing sort renumbers the whole album: retaining the selected index would
  // point to another photo and the scroll position to another month. Changing
  // grouping renumbers nothing but recomputes all heights: the same coordinate
  // lands elsewhere and moves selection off-screen. Restart at the top in both cases.
  //
  // Do nothing until the album loads: both `groupBy` and `order` start from a
  // default then switch together to the album preference when the response
  // arrives. Without this guard, opening an album set to "day" would reset
  // selection and scroll to the top a second time beneath someone already scrolling.
  const albumLoaded = !album.isPending;
  useEffect(() => {
    if (!albumLoaded) return;
    setSelectedIndex(-1);
    window.scrollTo({ top: 0 });
  }, [order, groupBy, albumLoaded]);

  useEffect(() => {
    if (isOpen) setSelectedIndex(openedIndex);
  }, [isOpen, openedIndex]);

  // A day requested by the URL — a search result. Honour it only when grouping by
  // day: with month grouping, section keys are `2026-07`, the day does not exist,
  // and the effect would load the whole album looking for a section that never comes.
  const dayParam = searchParams.get('day');
  const targetDay = dayParam && groupBy === 'day' ? dayParam : null;
  // Depend on a coordinate, not the section: `grid` is new on every render and
  // would rerun the effect while scrolling.
  const targetY = targetDay
    ? (grid.layout.sections.find((section) => section.key === targetDay)?.y ?? null)
    : null;

  // Run only after the effect scrolling to the top on grouping changes: both pull
  // in the same direction for one render when the album arrives set to "day".
  useEffect(() => {
    // Wait for annotated days: every place and note adds a line to its section
    // header, so coordinates above the target may still grow before they arrive.
    // In practice this request arrives before the second media page and the
    // difference is invisible; the guard covers an album where it does not, which
    // would land hundreds of pixels too high without an error.
    if (!albumLoaded || daysPending || targetDay === null) return;

    if (targetY === null) {
      // Not loaded yet: keep paginating until found, exactly like a photo requested
      // through `?photo=`.
      if (hasNextPage) {
        if (!isFetchingNextPage) void fetchNextPage();
      } else if (items.length > 0) {
        // Day absent from the album: the parameter has no target, and leaving it
        // would paginate the whole album again on the next render.
        setParams({ day: null }, true);
      }
      return;
    }

    window.scrollTo({ top: Math.max(0, targetY + grid.offsetTop - DAY_SCROLL_MARGIN) });
    // Remove with `replace` immediately after the parameter serves its purpose.
    // Retained, it would return the page to the day on every layout-recomputing
    // scroll, and Back would replay the jump instead of returning.
    setParams({ day: null }, true);
  }, [
    albumLoaded,
    daysPending,
    targetDay,
    targetY,
    grid.offsetTop,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    items.length,
    setParams,
  ]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Grid keyboard navigation. Disabled while the viewer or activity drawer is
  // open: each handles its own keys, and `Escape` would otherwise return to the
  // albums while closing the drawer.
  useEffect(() => {
    if (isOpen || showShortcuts || activity.isOpen) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;

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
        setSelectedIndex((current) => moveSelection(grid.layout, current, direction));
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
  }, [
    isOpen,
    showShortcuts,
    activity.isOpen,
    grid.layout,
    items.length,
    selectedIndex,
    openAt,
    navigate,
  ]);

  // Read layout through a ref and **not** as a dependency: it is new on every
  // loaded page, resize and collapsed section. As a dependency, the effect reran
  // during scrolling and smoothly — therefore more confusingly — returned to
  // the latest selected thumbnail. Measured while scrolling without interaction:
  // the view jumped from y≈13000 to y≈2845 on every item page. Scrolling into
  // view follows **selection**, nothing else.
  const gridRef = useRef(grid);
  gridRef.current = grid;
  useEffect(() => {
    if (!isOpen) {
      scrollSelectionIntoView(gridRef.current.layout, gridRef.current.offsetTop, selectedIndex);
    }
  }, [selectedIndex, isOpen]);

  useShortcut('?', () => setShowShortcuts(true), !isOpen && !activity.isOpen);

  const subtitle = album.data
    ? [
        t('albums.itemCount', album.data.itemCount),
        formatRange(album.data.oldestAt, album.data.newestAt, t),
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  // The button states the current state; the tooltip states what clicking will do.
  const orderLabel = t(shownOrder === 'desc' ? 'album.newestFirst' : 'album.oldestFirst');
  const orderAction = t(shownOrder === 'desc' ? 'album.showOldestFirst' : 'album.showNewestFirst');

  // Same rule for grouping: the label states the state, the tooltip the click effect.
  const groupLabel = t(groupBy === 'month' ? 'album.byMonth' : 'album.byDay');
  const groupAction = t(groupBy === 'month' ? 'album.groupByDay' : 'album.groupByMonth');

  return (
    <div className="min-h-full">
      <TopBar
        title={album.data?.title ?? t('album.title')}
        subtitle={subtitle}
        back
        feed={{ unread: activity.unread, onOpen: activity.open }}
        actions={[
          {
            label: orderLabel,
            action: orderAction,
            onSelect: toggleOrder,
            // Supply only the path, not its element: `TopBar` wraps it at the size of
            // its display location — bar or menu.
            icon: (
              <>
                <path d="M12 5v14" />
                <path d={shownOrder === 'desc' ? 'm19 12-7 7-7-7' : 'm5 12 7-7 7 7'} />
              </>
            ),
          },
          {
            label: groupLabel,
            action: groupAction,
            onSelect: toggleGroupBy,
            icon: (
              <>
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M3 10h18M8 3v4M16 3v4" />
                {/* Several lines for month, one marker for day. */}
                <path d={groupBy === 'month' ? 'M7 14h10M7 17.5h6' : 'M11 14h2v3h-2z'} />
              </>
            ),
          },
        ]}
      />

      <main className="mx-auto max-w-[2000px] px-4 py-4 sm:px-6">
        {album.data && (
          <AlbumDescription
            albumId={albumId}
            description={album.data.description}
            editable={Boolean(me?.admin)}
          />
        )}

        {isPending && <Spinner label={t('album.loadingPhotos')} />}

        {error && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {t('album.loadFailed')}
          </p>
        )}

        {!isPending && items.length === 0 && !error && (
          <div className="rounded-xl border border-dashed border-ink-700 px-6 py-12 text-center">
            <p className="text-sm text-ink-300">{t('album.empty')}</p>
            <p className="mt-1 text-xs text-ink-400">
              {t(
                album.data?.syncStatus === 'never'
                  ? 'album.emptyNeverSynced'
                  : 'album.emptyCheckFolder',
              )}
            </p>
          </div>
        )}

        {items.length > 0 && (
          <JustifiedGrid
            grid={grid}
            albumId={albumId}
            days={byDay}
            // A note belongs to a day: with month grouping, no header exists to attach it to.
            canAnnotate={Boolean(me?.admin) && groupBy === 'day'}
            onToggleSection={toggleSection}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            onOpen={openAt}
            onLoadMore={loadMore}
            hasMore={hasNextPage}
          />
        )}

        {isFetchingNextPage && (
          <div className="flex justify-center py-8">
            <Spinner label={t('common.loading')} />
          </div>
        )}
      </main>

      {isOpen && (
        <Lightbox
          albumId={albumId}
          albumTitle={album.data?.title ?? ''}
          items={items}
          index={openedIndex}
          total={album.data?.itemCount ?? items.length}
          days={byDay}
          coverId={album.data?.coverId ?? null}
          isAdmin={Boolean(me?.admin)}
          panel={panel}
          onPanelChange={setPanel}
          onIndexChange={showAt}
          onClose={closeLightbox}
          onNeedMore={loadMore}
        />
      )}

      {activity.isOpen && (
        <CommentsFeed
          albumId={albumId}
          albumTitle={album.data?.title ?? null}
          onClose={activity.close}
        />
      )}

      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
