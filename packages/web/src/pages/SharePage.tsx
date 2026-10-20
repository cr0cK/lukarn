import {
  DEFAULT_GROUP_BY,
  DEFAULT_SORT_ORDER,
  type ShareItem,
  type ShareView,
} from '@lukarn/shared';
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, shareScope } from '../api/client';
import {
  useAlbumItems,
  useCommentCounts,
  useMe,
  useShare,
  useToggleFavorite,
  useUpdateShareSubscription,
} from '../api/hooks';
import { Switch } from '../components/admin/ui';
import { Brand } from '../components/Brand';
import { CommentsFeed, useActivityFeed } from '../components/CommentsFeed';
import { IdentityForm } from '../components/IdentityForm';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { Lightbox } from '../components/Lightbox';
import { isPanelTab, type PanelTab } from '../components/SidePanel';
import { Spinner } from '../components/Spinner';
import { ResponsiveDialog } from '../components/ui/ResponsiveDialog';
import { appName } from '../lib/appName';
import { useT, type Translate } from '../lib/i18n';
import { useGridLayout } from '../lib/useGridLayout';

/** No annotated days on this page: they are an album's, and nobody may edit one here. */
const NO_DAYS = new Map();

/**
 * What a share link opens.
 *
 * Everything it asks for goes through `shareScope`, so no address it uses names the
 * album (D260825e) — including the ones the viewer and the comment stack build.
 */
export default function SharePage(): ReactElement {
  const t = useT();
  const { token = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const scope = useMemo(() => shareScope(token), [token]);
  const share = useShare(token);
  const { data: me } = useMe();
  const toggleFavorite = useToggleFavorite(scope);

  const [openedToken, setOpenedToken] = useState<string | null>(null);
  const answered = share.isSuccess && !share.isFetching;
  useEffect(() => {
    if (answered) setOpenedToken(token);
  }, [answered, token]);
  const ready = openedToken === token;

  const view = share.data;
  const isAlbum = view?.kind === 'album';
  const allowComments = view && view.kind !== 'locked' ? view.allowComments !== false : false;

  const { data: commentCounts } = useCommentCounts(scope);
  const activity = useActivityFeed(
    ready && view && view.kind !== 'locked' && view.kind !== 'media' && allowComments
      ? token
      : null,
  );

  const favoriteIds = useMemo(
    () =>
      new Set(
        view && (view.kind === 'album' || view.kind === 'selection')
          ? (view.favoriteMediaIds ?? [])
          : [],
      ),
    [view],
  );
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [showIdentifyModal, setShowIdentifyModal] = useState(false);

  const order = view?.kind === 'album' ? view.sortOrder : DEFAULT_SORT_ORDER;
  // `ready`, so no page is requested on a cookie that belongs to another link.
  const page = useAlbumItems(scope, order, isAlbum && ready);

  // A photograph link serves its one item with the link itself; a selection link
  // serves its array of items; only an album has pages to fetch.
  const items = useMemo<ShareItem[]>(
    () =>
      view === undefined || view.kind === 'locked'
        ? []
        : view.kind === 'album'
          ? page.items
          : view.kind === 'selection'
            ? view.items
            : [view.item],
    [view, page.items],
  );

  const displayedItems = useMemo(
    () => (onlyFavorites ? items.filter((item) => favoriteIds.has(item.id)) : items),
    [items, onlyFavorites, favoriteIds],
  );

  const openedId = searchParams.get('photo');
  const openedIndex = openedId ? displayedItems.findIndex((item) => item.id === openedId) : -1;
  const panelParam = searchParams.get('panel');
  const panel: PanelTab | null = isPanelTab(panelParam) ? panelParam : null;

  const [selectedIndex, setSelectedIndex] = useState(-1);

  const setParams = useCallback(
    (values: { photo?: string | null; panel?: string | null }, replace: boolean) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(values)) {
            if (value === null) next.delete(key);
            else if (value !== undefined) next.set(key, value);
          }
          return next;
        },
        { replace },
      );
    },
    [setSearchParams],
  );

  const grid = useGridLayout(displayedItems, DEFAULT_GROUP_BY, NO_DAYS, EMPTY_KEYS);

  const openAt = useCallback(
    (index: number) => {
      const item = displayedItems[index];
      if (item) setParams({ photo: item.id }, false);
    },
    [displayedItems, setParams],
  );

  const showAt = useCallback(
    (index: number) => {
      const item = displayedItems[index];
      if (item) setParams({ photo: item.id }, true);
    },
    [displayedItems, setParams],
  );

  const handleToggleFavorite = useCallback(
    (itemOrId: ShareItem | string) => {
      if (!me?.identity && !me?.username) {
        setShowIdentifyModal(true);
        return;
      }
      const mediaId = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
      const isFav = favoriteIds.has(mediaId);
      toggleFavorite.mutate({ mediaId, favorite: !isFav });
    },
    [me?.identity, me?.username, favoriteIds, toggleFavorite],
  );

  const loadMore = useCallback(() => {
    if (page.hasNextPage && !page.isFetchingNextPage && !page.isFetchNextPageError) {
      void page.fetchNextPage();
    }
  }, [page]);

  useEffect(() => {
    if (ready && openedId && openedIndex === -1 && !onlyFavorites) loadMore();
  }, [ready, openedId, openedIndex, onlyFavorites, loadMore]);

  if (share.isPending || (!ready && !share.isError)) {
    return (
      <ShareFrame>
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      </ShareFrame>
    );
  }

  // A link that stopped working says so in words on this same page rather than on a
  // generic error screen, which is the only way its reader learns what happened
  // without being offered a password field to guess at (D260825b, D260825d).
  if (share.isError || view === undefined) {
    return (
      <ShareFrame>
        <p className="text-center text-sm text-ink-300">{deadLinkText(share.error, t)}</p>
      </ShareFrame>
    );
  }

  const pageTitle = resolveShareTitle(view, t);

  if (view.kind === 'locked') {
    return (
      <ShareFrame title={pageTitle}>
        <div className="mx-auto my-8 max-w-md rounded-2xl border border-ink-800 bg-surface-elevated p-6 shadow-xl">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
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
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink-100">{t('share.lockedTitle')}</h2>
              <p className="mt-0.5 text-xs text-ink-400">{t('share.lockedHint')}</p>
            </div>
          </div>

          <IdentityForm
            onDone={() => {
              void share.refetch();
            }}
          />

          <div className="mt-5 border-t border-ink-800 pt-4 text-center text-xs text-ink-400">
            {t('share.lockedHasAccount')}{' '}
            <Link
              to={`/login?next=${encodeURIComponent(window.location.pathname)}`}
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              {t('share.lockedSignIn')}
            </Link>
          </div>
        </div>
      </ShareFrame>
    );
  }

  const showGalleryActions = view.kind === 'album' || view.kind === 'selection';

  return (
    <ShareFrame
      title={pageTitle}
      actions={
        showGalleryActions ? (
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => setOnlyFavorites((v) => !v)}
              aria-pressed={onlyFavorites}
              title={t(onlyFavorites ? 'favorites.showAll' : 'favorites.filterTooltip')}
              aria-label={t(onlyFavorites ? 'favorites.showAll' : 'favorites.filterTooltip')}
              className={`relative flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                onlyFavorites
                  ? 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
                  : 'text-ink-300 hover:bg-tint hover:text-ink-100'
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill={onlyFavorites ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              {favoriteIds.size > 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute top-0.5 right-0.5 min-w-4 rounded-full px-1 text-center text-[0.625rem] leading-4 font-semibold tabular-nums ${
                    onlyFavorites ? 'bg-amber-400 text-ink-950' : 'bg-ink-700 text-ink-200'
                  }`}
                >
                  {favoriteIds.size > 99 ? '99+' : favoriteIds.size}
                </span>
              )}
            </button>

            {allowComments && (
              <button
                type="button"
                onClick={activity.open}
                title={t('topbar.activity')}
                aria-label={t('topbar.activity')}
                className="relative flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-tint hover:text-ink-100"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />
                </svg>
                {activity.unread > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[0.625rem] leading-4 font-semibold text-accent-ink tabular-nums"
                  >
                    {activity.unread > 9 ? '9+' : activity.unread}
                  </span>
                )}
              </button>
            )}

            <ShareNotificationsButton
              token={token}
              onRequireIdentity={() => setShowIdentifyModal(true)}
            />
          </div>
        ) : undefined
      }
    >
      {view.kind === 'album' && view.description && (
        <p className="mb-4 max-w-prose text-sm whitespace-pre-line text-ink-300">
          {view.description}
        </p>
      )}

      {page.isPending && isAlbum && <Spinner label={t('album.loadingPhotos')} />}

      {page.error && (
        <p role="alert" className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {t('album.loadFailed')}
        </p>
      )}

      {items.length > 0 && onlyFavorites && displayedItems.length === 0 && (
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
          scope={scope}
          albumId={null}
          days={NO_DAYS}
          canAnnotate={false}
          onToggleSection={NOOP}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          onOpen={openAt}
          onLoadMore={loadMore}
          hasMore={isAlbum ? page.hasNextPage : false}
          favoriteIds={showGalleryActions ? favoriteIds : undefined}
          onToggleFavorite={showGalleryActions ? handleToggleFavorite : undefined}
          commentCounts={commentCounts?.counts}
        />
      )}

      {page.isFetchingNextPage && (
        <div className="flex justify-center py-8">
          <Spinner label={t('common.loading')} />
        </div>
      )}

      {openedIndex >= 0 && (
        <Lightbox
          scope={scope}
          albumTitle={pageTitle ?? ''}
          items={displayedItems}
          index={openedIndex}
          total={
            onlyFavorites
              ? displayedItems.length
              : view.kind === 'album'
                ? view.itemCount
                : items.length
          }
          days={NO_DAYS}
          coverId={null}
          isAdmin={false}
          panel={panel}
          onPanelChange={(next) => setParams({ panel: next }, true)}
          onIndexChange={showAt}
          onClose={() => setParams({ photo: null, panel: null }, false)}
          onNeedMore={loadMore}
          favoriteIds={showGalleryActions ? favoriteIds : undefined}
          onToggleFavorite={showGalleryActions ? handleToggleFavorite : undefined}
          allowComments={allowComments}
        />
      )}

      {activity.isOpen && allowComments && (
        <CommentsFeed
          albumId={null}
          albumTitle={pageTitle}
          shareToken={token}
          onOpenPhoto={(mediaId) => setParams({ photo: mediaId, panel: 'comments' }, false)}
          onClose={activity.close}
        />
      )}

      <ResponsiveDialog
        open={showIdentifyModal}
        onClose={() => setShowIdentifyModal(false)}
        title={t('notifications.verifyToSubscribe')}
      >
        <p className="mb-4 text-xs text-ink-400">{t('notifications.verifyHint')}</p>
        <IdentityForm
          onDone={() => {
            setShowIdentifyModal(false);
            void share.refetch();
          }}
        />
      </ResponsiveDialog>
    </ShareFrame>
  );
}

function ShareNotificationsButton({
  token,
  onRequireIdentity,
}: {
  token: string;
  onRequireIdentity: () => void;
}): ReactElement {
  const t = useT();
  const { data: me } = useMe();
  const updateSubscription = useUpdateShareSubscription(token);
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

  const identity = me?.identity ?? null;
  const active = Boolean(identity && (identity.notifyPhotos || identity.notifyComments));

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!identity) {
            onRequireIdentity();
          } else {
            setOpen((v) => !v);
          }
        }}
        aria-expanded={open}
        aria-label={t('notifications.tooltip')}
        title={t('notifications.tooltip')}
        className={`relative flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
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

      {open && identity && (
        <div
          role="dialog"
          aria-label={t('notifications.title')}
          className="absolute right-0 top-full z-40 mt-2 w-80 rounded-2xl border border-ink-700 bg-surface-elevated p-4 shadow-2xl"
        >
          <p className="text-sm font-semibold text-ink-100">{t('notifications.title')}</p>
          <p className="mt-0.5 truncate text-xs text-ink-400">
            {t('notifications.sendingTo', identity.email ?? '')}
          </p>
          <div className="mt-3 divide-y divide-ink-800">
            <div className="py-2">
              <Switch
                checked={Boolean(identity.notifyPhotos)}
                onChange={(next) =>
                  updateSubscription.mutate({
                    notifyPhotos: next,
                    notifyComments: identity.notifyComments,
                  })
                }
                label={t('notifications.newPhotos')}
                hint={t('notifications.newPhotosHint')}
                disabled={updateSubscription.isPending}
              />
            </div>
            <div className="py-2">
              <Switch
                checked={Boolean(identity.notifyComments)}
                onChange={(next) =>
                  updateSubscription.mutate({
                    notifyPhotos: identity.notifyPhotos,
                    notifyComments: next,
                  })
                }
                label={t('notifications.newComments')}
                hint={t('notifications.newCommentsHint')}
                disabled={updateSubscription.isPending}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Never changes, so the grid does not remount on every render. */
const EMPTY_KEYS: ReadonlySet<string> = new Set();
const NOOP = (): void => {};

/**
 * The instance's name and logo above whatever the link opened.
 *
 * The mark is deliberately **not** a link: `TopBar` wraps it in a route to the album
 * list, which is the one place this page must not offer (D260825d).
 */
export function ShareFrame({
  title,
  actions,
  children,
}: {
  title?: string | null;
  actions?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="mx-auto max-w-[2000px] px-4 py-6 sm:px-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Brand size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm text-ink-400">{appName()}</p>
            {title && <h1 className="truncate text-lg font-medium text-ink-100">{title}</h1>}
          </div>
        </div>
        {actions}
      </header>
      <main>{children}</main>
    </div>
  );
}

/**
 * The sentence for a link that no longer works.
 */
function deadLinkText(error: unknown, t: Translate): string {
  const code = error instanceof ApiError ? error.code : null;
  if (code === 'share_revoked') return t('share.revoked');
  if (code === 'share_expired') return t('share.expired');
  if (code === 'share_gone') return t('share.gone');
  return t('share.unknown');
}

/**
 * Resolves the page and lightbox title for a share view.
 *
 * Album shares use the album title; multi-photo selections and locked shares use
 * their custom label (trimmed) or fall back to the localized default title;
 * single-photo shares display no title.
 */
export function resolveShareTitle(view: ShareView | undefined, t: Translate): string | null {
  if (!view) return null;
  if (view.kind === 'album') return view.title;
  if (view.kind === 'selection' || view.kind === 'locked') {
    return view.label?.trim() || t('shares.selectionDefaultTitle');
  }
  return null;
}
