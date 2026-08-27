import { DEFAULT_GROUP_BY, DEFAULT_SORT_ORDER, type ShareItem } from '@lukarn/shared';
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ApiError, shareScope } from '../api/client';
import { useAlbumItems, useShare } from '../api/hooks';
import { Brand } from '../components/Brand';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { Lightbox } from '../components/Lightbox';
import { isPanelTab, type PanelTab } from '../components/SidePanel';
import { Spinner } from '../components/Spinner';
import { appName } from '../lib/appName';
import { useT, type Translate } from '../lib/i18n';
import { useGridLayout } from '../lib/useGridLayout';

/** No annotated days on this page: they are an album's, and nobody may edit one here. */
const NO_DAYS = new Map();

/**
 * What a share link opens.
 *
 * **It carries the instance's name, its logo, and what was shared, and nothing
 * else** (D260825d). No album list, no sign-in control, nothing indicating that
 * other content exists. The two failures available here pull in opposite
 * directions: a page of bare photographs has no sender and reads as a phishing
 * message, while the whole application advertises to somebody who was given one
 * album that this instance has accounts and passwords behind it.
 *
 * The page therefore mounts none of the chrome — no top bar, no tab bar, no account
 * menu — in the way `/pair` and `/diagnostic` already mount none.
 *
 * **One path for both kinds of link.** A photograph link is a grid of one, opening
 * the same viewer. Two shapes here would be two things to keep in step for a
 * difference nobody reading the page can see.
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

  /**
   * Whether **this mount's own** opening request has answered for **this** token.
   *
   * Not `isSuccess`: a query serves its cached data while it refetches, and data
   * cached for link A belongs to a visit whose cookie has since been replaced by
   * link B's. Drawing A's grid on B's cookie asks for photographs that answer 404,
   * and an `<img>` that failed is not retried when the right cookie arrives a
   * moment later.
   *
   * Set and never cleared, which is what keeps a **re-**fetch from flashing the
   * page back to a spinner: verifying an address reopens the link (D41), and
   * unmounting the viewer under somebody who has just typed six digits would lose
   * the photograph and the draft they were writing.
   */
  const [openedToken, setOpenedToken] = useState<string | null>(null);
  const answered = share.isSuccess && !share.isFetching;
  useEffect(() => {
    if (answered) setOpenedToken(token);
  }, [answered, token]);
  const ready = openedToken === token;

  const view = share.data;
  const isAlbum = view?.kind === 'album';

  const order = view?.kind === 'album' ? view.sortOrder : DEFAULT_SORT_ORDER;
  // `ready`, so no page is requested on a cookie that belongs to another link.
  const page = useAlbumItems(scope, order, isAlbum && ready);

  // A photograph link serves its one item with the link itself; only an album has
  // pages to fetch. Both then feed the same grid.
  const items = useMemo<ShareItem[]>(
    () => (view === undefined ? [] : view.kind === 'album' ? page.items : [view.item]),
    [view, page.items],
  );

  // The open photograph lives in the URL, exactly as it does in an album: Back
  // closes the viewer, and the reply notification links straight to a conversation
  // with `?photo=…&panel=comments` (see `mail.ts`).
  const openedId = searchParams.get('photo');
  const openedIndex = openedId ? items.findIndex((item) => item.id === openedId) : -1;
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

  const grid = useGridLayout(items, DEFAULT_GROUP_BY, NO_DAYS, EMPTY_KEYS);

  const openAt = useCallback(
    (index: number) => {
      const item = items[index];
      if (item) setParams({ photo: item.id }, false);
    },
    [items, setParams],
  );

  // `replace` while moving between photographs: arrow keys would otherwise fill the
  // history, and Back would walk back through every one instead of closing.
  const showAt = useCallback(
    (index: number) => {
      const item = items[index];
      if (item) setParams({ photo: item.id }, true);
    },
    [items, setParams],
  );

  // `isFetchNextPageError` is not belt and braces: the effect below re-fires on
  // every change to the query result, and a failed page leaves `hasNextPage` true
  // and `isFetchingNextPage` false — which is a request loop against the server for
  // as long as the page is open.
  const loadMore = useCallback(() => {
    if (page.hasNextPage && !page.isFetchingNextPage && !page.isFetchNextPageError) {
      void page.fetchNextPage();
    }
  }, [page]);

  // For a photograph named by the URL but not loaded yet, keep paginating until it
  // is found or the album ends — the same rule `AlbumPage` follows, and it earns its
  // place here: a reply notification links straight to `/s/<token>?photo=…`, and a
  // shared album holds more photographs than the first page carries.
  useEffect(() => {
    if (ready && openedId && openedIndex === -1) loadMore();
  }, [ready, openedId, openedIndex, loadMore]);

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

  return (
    <ShareFrame title={view.kind === 'album' ? view.title : null}>
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

      {items.length > 0 && (
        <JustifiedGrid
          grid={grid}
          scope={scope}
          // No album to annotate, and nobody here who could: both halves say the
          // same thing, and the grid folds them together.
          albumId={null}
          days={NO_DAYS}
          canAnnotate={false}
          onToggleSection={NOOP}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          onOpen={openAt}
          onLoadMore={loadMore}
          hasMore={page.hasNextPage}
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
          // The album title for an album link, which is what was shared; empty for a
          // photograph, whose album is named nowhere its recipient can reach
          // (D260825e).
          albumTitle={view.kind === 'album' ? view.title : ''}
          items={items}
          index={openedIndex}
          total={view.kind === 'album' ? view.itemCount : 1}
          days={NO_DAYS}
          coverId={null}
          // Never: a link is a credential, not a person, and `admin` is false on the
          // session it opens (D260825).
          isAdmin={false}
          panel={panel}
          onPanelChange={(next) => setParams({ panel: next }, true)}
          onIndexChange={showAt}
          onClose={() => setParams({ photo: null, panel: null }, false)}
          onNeedMore={loadMore}
        />
      )}
    </ShareFrame>
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
  children,
}: {
  title?: string | null;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="mx-auto max-w-[2000px] px-4 py-6 sm:px-6">
      <header className="mb-6 flex items-center gap-3">
        <Brand size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm text-ink-400">{appName()}</p>
          {title && <h1 className="truncate text-lg font-medium text-ink-100">{title}</h1>}
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

/**
 * The sentence for a link that no longer works.
 *
 * The server distinguishes the three with a status and an error code — 404 for a
 * token that never existed, 410 for one that did — and the page says which in words
 * (D260825b). The server's own message is the fallback rather than the source: this
 * page is read in a browser whose language the interface already knows.
 */
function deadLinkText(error: unknown, t: Translate): string {
  const code = error instanceof ApiError ? error.code : null;
  if (code === 'share_revoked') return t('share.revoked');
  if (code === 'share_expired') return t('share.expired');
  if (code === 'share_gone') return t('share.gone');
  return t('share.unknown');
}
