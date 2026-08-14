import type { Album } from '@lukarn/shared';
import { type ReactElement, useState } from 'react';
import { Link } from 'react-router-dom';
import { mediaUrl } from '../api/client';
import { useAlbums, useMe } from '../api/hooks';
import { BottomTabs } from '../components/BottomTabs';
import { CommentsFeed, useActivityFeed } from '../components/CommentsFeed';
import { SearchBox } from '../components/SearchBox';
import { ShortcutsOverlay } from '../components/ShortcutsOverlay';
import { Spinner } from '../components/Spinner';
import { TopBar } from '../components/TopBar';
import { useInstanceName } from '../lib/branding';
import { formatRange } from '../lib/format';
import { useT } from '../lib/i18n';
import { useShortcut } from '../lib/useShortcut';

function AlbumCard({ album }: { album: Album }): ReactElement {
  const t = useT();
  const period = formatRange(album.oldestAt, album.newestAt, t);

  return (
    <Link
      to={`/album/${encodeURIComponent(album.id)}`}
      // 20 px corners over the 12 px of `rounded-xl`, and a 12 px gutter instead
      // of 16: two purely visual values, applied at **every** width. A card whose
      // radius changed at 768 px would carry two numbers in every class for a
      // difference nobody can see side by side.
      className="group block overflow-hidden rounded-[20px] bg-ink-850 transition-transform hover:-translate-y-0.5"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-ink-800">
        {album.coverId ? (
          <img
            src={mediaUrl.thumb(album.coverId, 640, album.coverVersion)}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-sm text-ink-400">
            {t(album.syncStatus === 'never' ? 'albums.neverSynced' : 'albums.empty')}
          </div>
        )}
      </div>

      <div className="px-3.5 py-3">
        <h2 className="truncate text-sm font-medium text-ink-100">{album.title}</h2>
        {/* Clamp to two lines: the thumbnail must remain visible, and card
            height cannot vary by album without leaving holes in the grid. The
            full title remains in `title`. */}
        {album.description && (
          <p className="mt-1 line-clamp-2 text-xs leading-4 text-ink-300" title={album.description}>
            {album.description}
          </p>
        )}
        <p className="mt-0.5 truncate text-xs text-ink-400">
          {t('albums.itemCount', album.itemCount)}
          {period ? ` · ${period}` : ''}
        </p>
      </div>
    </Link>
  );
}

export default function AlbumsPage(): ReactElement {
  const t = useT();
  const instanceName = useInstanceName();
  const { data: albums, isPending, error } = useAlbums();
  const { data: user } = useMe();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const activity = useActivityFeed();

  useShortcut('?', () => setShowShortcuts(true), !activity.isOpen);

  return (
    <div className="min-h-full">
      {/* Search belongs here, not inside an album: it covers the whole library,
          and after roughly twenty albums "where are the Marseille photos?" stops
          having an obvious answer. */}
      <TopBar
        // The gallery's own name, not the word "Albums": this is the one page
        // that is the gallery rather than a part of it, and the name beside the
        // mark is what makes the top bar say whose photos these are. Every other
        // page names what it shows — an album, Administration.
        title={instanceName}
        search={<SearchBox shortcutEnabled={!activity.isOpen && !showShortcuts} />}
        feed={{ unread: activity.unread, onOpen: activity.open }}
      />

      {/* The tab bar is `fixed` and therefore outside the flow: the page reserves
          its height itself, or the last row of albums would end underneath it. */}
      <main className="mx-auto max-w-[2000px] px-4 py-6 pb-[calc(5rem_+_env(safe-area-inset-bottom))] sm:px-6 md:pb-6">
        {isPending && <Spinner label={t('albums.loading')} />}

        {error && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {t('albums.loadFailed')}
          </p>
        )}

        {albums && albums.length === 0 && (
          <div className="rounded-xl border border-dashed border-ink-700 px-6 py-12 text-center">
            <p className="text-sm text-ink-300">{t('albums.none')}</p>
            {/* Do not refer to `config/albums.yaml`: once an account exists the
                database is authoritative and the file is never reread. Following
                that instruction meant editing a file with no effect. */}
            <p className="mt-1 text-xs text-ink-400">
              {t(user?.admin ? 'albums.noneAdmin' : 'albums.noneVisitor')}
            </p>
          </div>
        )}

        {albums && albums.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {albums.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        )}
      </main>

      <BottomTabs current="albums" activity={activity} />

      {activity.isOpen && (
        <CommentsFeed albumId={null} albumTitle={null} onClose={activity.close} />
      )}

      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
