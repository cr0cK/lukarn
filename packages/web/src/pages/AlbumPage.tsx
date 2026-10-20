import {
  DEFAULT_GROUP_BY,
  DEFAULT_SORT_ORDER,
  isGroupBy,
  type CreateShareItemInput,
  type GroupBy,
  type ShareItem,
  type SortOrder,
} from '@lukarn/shared';
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { albumScope } from '../api/client';
import {
  useAlbum,
  useAlbumDays,
  useAlbumItems,
  useCommentCounts,
  useMe,
  useToggleFavorite,
  useUpdateAlbum,
  useUpdateProfile,
} from '../api/hooks';
import { ActionMenu } from '../components/ActionMenu';
import { Switch } from '../components/admin/ui';
import { AlbumDescription } from '../components/AlbumDescription';
import { BottomTabs } from '../components/BottomTabs';
import { CommentsFeed, useActivityFeed } from '../components/CommentsFeed';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { Lightbox } from '../components/Lightbox';
import { ShareModal } from '../components/ShareModal';
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
import { openWithSharedElement } from '../lib/viewTransition';

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
  // What the grid, the viewer and the comment stack read from. An album here; the
  // share page hands the same components a link (D260825e).
  const scope = useMemo(() => albumScope(albumId), [albumId]);
  const { data: me } = useMe();
  const { data: commentCounts } = useCommentCounts(scope);
  const toggleFavorite = useToggleFavorite(scope);
  const updateAlbum = useUpdateAlbum();

  const favoriteIds = useMemo(
    () => new Set(album.data?.favoriteMediaIds ?? []),
    [album.data?.favoriteMediaIds],
  );
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);

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
    scope,
    order ?? undefined,
    order !== null,
  );

  const displayedItems = useMemo(
    () => (onlyFavorites ? items.filter((item) => favoriteIds.has(item.id)) : items),
    [items, onlyFavorites, favoriteIds],
  );

  // The open photo lives in the URL: Back closes it, and a shared link restores
  // the exact same view.
  const openedId = searchParams.get('photo');
  const openedIndex = openedId ? displayedItems.findIndex((item) => item.id === openedId) : -1;
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
  const [showShare, setShowShare] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [shareSelectionItems, setShareSelectionItems] = useState<CreateShareItemInput[] | null>(
    null,
  );

  const cancelSelection = useCallback(() => {
    setIsSelecting(false);
    setSelectedIds(new Set());
  }, []);

  const toggleItemSelection = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const handleToggleFavorite = useCallback(
    (itemOrId: ShareItem | string) => {
      const mediaId = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
      const isFav = favoriteIds.has(mediaId);
      toggleFavorite.mutate({ mediaId, favorite: !isFav });
    },
    [favoriteIds, toggleFavorite],
  );

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

  const grid = useGridLayout(displayedItems, groupBy, byDay, collapsedKeys);

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

  // Opening is the one navigation that carries a shared element: the thumbnail
  // grows into the viewer, which is what says *which* of two hundred tiles was
  // touched. `flushSync` because the browser snapshots the new state as soon as
  // the callback returns, and React would otherwise still be holding the update.
  const openAt = useCallback(
    (index: number) => {
      const item = displayedItems[index];
      if (!item) return;
      openWithSharedElement(item.id, () => flushSync(() => setParams({ photo: item.id }, false)));
    },
    [displayedItems, setParams],
  );

  // Use `replace` for viewer photo navigation, or moving through 50 photos with
  // arrows would stack 50 history entries and Back would no longer return to the grid.
  const showAt = useCallback(
    (index: number) => {
      const item = displayedItems[index];
      if (!item) return;
      setParams({ photo: item.id }, true);
    },
    [displayedItems, setParams],
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
    rememberOrder(next);
    setParams({ order: next === albumSortOrder ? null : next }, false);
  }, [shownOrder, albumSortOrder, rememberOrder, setParams]);

  const toggleGroupBy = useCallback(() => {
    const next: GroupBy = groupBy === 'month' ? 'day' : 'month';
    setParams({ group: next === albumGroupBy ? null : next }, false);
  }, [groupBy, albumGroupBy, setParams]);

  // For a photo requested by the URL but not loaded yet, keep paginating until
  // it is found or the album ends.
  useEffect(() => {
    if (openedId && openedIndex === -1 && hasNextPage && !isFetchingNextPage && !onlyFavorites) {
      void fetchNextPage();
    }
  }, [openedId, openedIndex, hasNextPage, isFetchingNextPage, onlyFavorites, fetchNextPage]);

  // Close the viewer if the target photo does not exist in this album.
  useEffect(() => {
    if (openedId && openedIndex === -1 && !hasNextPage && items.length > 0 && !onlyFavorites) {
      closeLightbox();
    }
  }, [openedId, openedIndex, hasNextPage, items.length, onlyFavorites, closeLightbox]);

  const albumLoaded = !album.isPending;
  useEffect(() => {
    if (!albumLoaded) return;
    setSelectedIndex(-1);
    window.scrollTo({ top: 0 });
  }, [order, groupBy, albumLoaded]);

  useEffect(() => {
    if (isOpen) setSelectedIndex(openedIndex);
  }, [isOpen, openedIndex]);

  const dayParam = searchParams.get('day');
  const targetDay = dayParam && groupBy === 'day' ? dayParam : null;
  const targetY = targetDay
    ? (grid.layout.sections.find((section) => section.key === targetDay)?.y ?? null)
    : null;

  useEffect(() => {
    if (!albumLoaded || daysPending || targetDay === null) return;

    if (targetY === null) {
      if (hasNextPage) {
        if (!isFetchingNextPage) void fetchNextPage();
      } else if (items.length > 0) {
        setParams({ day: null }, true);
      }
      return;
    }

    window.scrollTo({ top: Math.max(0, targetY + grid.offsetTop - DAY_SCROLL_MARGIN) });
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
        if (isSelecting) {
          cancelSelection();
        } else {
          void navigate('/');
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isOpen,
    showShortcuts,
    activity.isOpen,
    grid.layout,
    displayedItems.length,
    selectedIndex,
    openAt,
    navigate,
    isSelecting,
    cancelSelection,
  ]);

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

  const orderLabel = t(shownOrder === 'desc' ? 'album.newestFirst' : 'album.oldestFirst');
  const orderAction = t(shownOrder === 'desc' ? 'album.showOldestFirst' : 'album.showNewestFirst');
  const groupLabel = t(groupBy === 'month' ? 'album.byMonth' : 'album.byDay');
  const groupAction = t(groupBy === 'month' ? 'album.groupByDay' : 'album.groupByMonth');

  return (
    <div className="min-h-full">
      <TopBar
        title={album.data?.title ?? t('album.title')}
        subtitle={subtitle}
        back
        favorites={{
          active: onlyFavorites,
          count: favoriteIds.size,
          onToggle: () => setOnlyFavorites((v) => !v),
        }}
        feed={{ unread: activity.unread, onOpen: activity.open }}
        notifications={me?.identity ? <ProfileNotificationsPopover /> : undefined}
        menu={
          me?.admin ? (
            <ActionMenu
              label={t('album.actions')}
              triggerClassName="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-tint hover:text-ink-100 md:size-9"
              groupes={[
                [
                  {
                    label: isSelecting ? t('album.cancelSelection') : t('album.selectPhotos'),
                    onSelect: () => {
                      if (isSelecting) cancelSelection();
                      else setIsSelecting(true);
                    },
                    icon: (
                      <svg
                        viewBox="0 0 24 24"
                        className="size-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M9 11l3 3L22 4" />
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                      </svg>
                    ),
                  },
                  {
                    label: t('album.editDescription'),
                    onSelect: () => setEditingDescription(true),
                    icon: (
                      <svg
                        viewBox="0 0 24 24"
                        className="size-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    ),
                  },
                  ...(album.data?.coverId
                    ? [
                        {
                          label: t('album.resetCover'),
                          onSelect: () => updateAlbum.mutate({ albumId, body: { coverId: null } }),
                          icon: (
                            <svg
                              viewBox="0 0 24 24"
                              className="size-4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <rect x="3" y="4" width="18" height="16" rx="2" />
                              <path d="m6 16 4-4 3 3 2-2 3 3" />
                            </svg>
                          ),
                        },
                      ]
                    : []),
                  {
                    label: t('shares.shareAlbum'),
                    onSelect: () => setShowShare(true),
                    icon: (
                      <svg
                        viewBox="0 0 24 24"
                        className="size-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                        <polyline points="16 6 12 2 8 6" />
                        <line x1="12" y1="2" x2="12" y2="15" />
                      </svg>
                    ),
                  },
                ],
              ]}
            />
          ) : undefined
        }
        actions={[
          ...(me?.admin
            ? [
                {
                  label: isSelecting ? t('album.cancelSelection') : t('album.select'),
                  action: isSelecting ? t('album.cancelSelection') : t('album.select'),
                  onSelect: () => {
                    if (isSelecting) cancelSelection();
                    else setIsSelecting(true);
                  },
                  icon: (
                    <>
                      <path d="M9 11l3 3L22 4" />
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </>
                  ),
                },
                {
                  label: t('shares.shareAlbum'),
                  action: t('shares.shareAlbum'),
                  onSelect: () => setShowShare(true),
                  icon: (
                    <>
                      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                      <polyline points="16 6 12 2 8 6" />
                      <line x1="12" y1="2" x2="12" y2="15" />
                    </>
                  ),
                },
              ]
            : []),
          {
            label: orderLabel,
            action: orderAction,
            onSelect: toggleOrder,
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
                <path d={groupBy === 'month' ? 'M7 14h10M7 17.5h6' : 'M11 14h2v3h-2z'} />
              </>
            ),
          },
        ]}
      />

      <main className="mx-auto max-w-[2000px] px-4 py-4 pb-[calc(5rem_+_env(safe-area-inset-bottom))] sm:px-6 md:pb-4">
        {album.data && (
          <AlbumDescription
            albumId={albumId}
            description={album.data.description}
            editable={Boolean(me?.admin)}
            editing={editingDescription}
            onEditingChange={setEditingDescription}
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

        {!isPending && items.length > 0 && onlyFavorites && displayedItems.length === 0 && (
          <div className="rounded-xl border border-dashed border-ink-700 px-6 py-12 text-center">
            <p className="text-sm text-ink-300">{t('favorites.empty')}</p>
            <p className="mt-1 text-xs text-ink-400">{t('favorites.emptyHint')}</p>
            <button
              type="button"
              onClick={() => setOnlyFavorites(false)}
              className="mt-4 rounded-lg border border-ink-700 px-3 py-1.5 text-sm font-medium text-ink-200 transition-colors hover:bg-tint"
            >
              {t('favorites.showAll')}
            </button>
          </div>
        )}

        {displayedItems.length > 0 && (
          <JustifiedGrid
            grid={grid}
            albumId={albumId}
            days={byDay}
            canAnnotate={Boolean(me?.admin) && groupBy === 'day' && !isSelecting}
            onToggleSection={toggleSection}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            onOpen={openAt}
            onLoadMore={loadMore}
            hasMore={hasNextPage}
            selectionMode={isSelecting}
            selectedIds={selectedIds}
            onToggleSelection={toggleItemSelection}
            favoriteIds={favoriteIds}
            onToggleFavorite={handleToggleFavorite}
            commentCounts={commentCounts?.counts}
          />
        )}

        {isFetchingNextPage && (
          <div className="flex justify-center py-8">
            <Spinner label={t('common.loading')} />
          </div>
        )}
      </main>

      {isSelecting && (
        <aside
          aria-label={t('album.selectionActions')}
          className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-ink-700 bg-surface-elevated/95 px-4 py-2 shadow-2xl backdrop-blur md:bottom-8"
        >
          <button
            type="button"
            onClick={cancelSelection}
            className="rounded-lg px-2 py-1 text-sm font-medium text-ink-300 transition-colors hover:text-ink-100"
          >
            {t('common.cancel')}
          </button>
          <span className="h-4 w-px bg-ink-700" />
          <span className="text-sm font-medium whitespace-nowrap text-ink-200">
            {t('shares.selectedCount', selectedIds.size)}
          </span>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() => {
              const itemsToShare = Array.from(selectedIds).map((id) => ({
                albumId,
                mediaId: id,
              }));
              setShareSelectionItems(itemsToShare);
              setShowShare(true);
            }}
            className="rounded-full bg-accent px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {t('shares.shareSelection')}
          </button>
        </aside>
      )}

      <BottomTabs current="albums" activity={activity} />

      {isOpen && (
        <Lightbox
          scope={scope}
          albumTitle={album.data?.title ?? ''}
          items={displayedItems}
          index={openedIndex}
          total={onlyFavorites ? displayedItems.length : (album.data?.itemCount ?? items.length)}
          days={byDay}
          coverId={album.data?.coverId ?? null}
          isAdmin={Boolean(me?.admin)}
          panel={panel}
          onPanelChange={setPanel}
          onIndexChange={showAt}
          onClose={closeLightbox}
          onNeedMore={loadMore}
          favoriteIds={favoriteIds}
          onToggleFavorite={handleToggleFavorite}
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

      <ShareModal
        albumId={albumId}
        albumTitle={album.data?.title}
        items={shareSelectionItems}
        isOpen={showShare}
        onClose={() => {
          setShowShare(false);
          if (shareSelectionItems) {
            setShareSelectionItems(null);
            cancelSelection();
          }
        }}
      />
    </div>
  );
}

function ProfileNotificationsPopover(): ReactElement | null {
  const t = useT();
  const { data: me } = useMe();
  const updateProfile = useUpdateProfile();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!me?.identity) return null;
  const { displayName, email, notifyPhotos, notifyComments } = me.identity;
  const active = notifyPhotos || notifyComments;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t('notifications.tooltip')}
        title={t('notifications.tooltip')}
        className={`relative flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors md:size-9 ${
          active ? 'text-accent hover:bg-tint' : 'text-ink-300 hover:bg-tint hover:text-ink-100'
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('notifications.title')}
          className="absolute right-0 top-full z-40 mt-2 w-80 rounded-2xl border border-ink-700 bg-surface-elevated p-4 shadow-2xl"
        >
          <p className="text-sm font-semibold text-ink-100">{t('notifications.title')}</p>
          <p className="mt-0.5 truncate text-xs text-ink-400">
            {t('notifications.sendingTo', email ?? '')}
          </p>
          <div className="mt-3 divide-y divide-ink-800">
            <div className="py-2">
              <Switch
                checked={Boolean(notifyPhotos)}
                onChange={(next) =>
                  updateProfile.mutate({ displayName, notifyPhotos: next, notifyComments })
                }
                label={t('notifications.newPhotos')}
                hint={t('notifications.newPhotosHint')}
                disabled={updateProfile.isPending}
              />
            </div>
            <div className="py-2">
              <Switch
                checked={Boolean(notifyComments)}
                onChange={(next) =>
                  updateProfile.mutate({ displayName, notifyPhotos, notifyComments: next })
                }
                label={t('notifications.newComments')}
                hint={t('notifications.newCommentsHint')}
                disabled={updateProfile.isPending}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
