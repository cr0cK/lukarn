import type { Album } from '@lukarn/shared';
import { type ReactElement, useState } from 'react';
import { Link } from 'react-router-dom';
import { mediaUrl } from '../api/client';
import { useAlbums, useMe } from '../api/hooks';
import { CommentsFeed, useActivityFeed } from '../components/CommentsFeed';
import { SearchBox } from '../components/SearchBox';
import { ShortcutsOverlay } from '../components/ShortcutsOverlay';
import { Spinner } from '../components/Spinner';
import { TopBar } from '../components/TopBar';
import { formatRange } from '../lib/format';
import { useShortcut } from '../lib/useShortcut';

function AlbumCard({ album }: { album: Album }): ReactElement {
  const period = formatRange(album.oldestAt, album.newestAt);

  return (
    <Link
      to={`/album/${encodeURIComponent(album.id)}`}
      className="group block overflow-hidden rounded-xl bg-ink-850 transition-transform hover:-translate-y-0.5"
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
            {album.syncStatus === 'never' ? 'Not synced yet' : 'Empty album'}
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
          {album.itemCount.toLocaleString('en-US')} {album.itemCount > 1 ? 'items' : 'item'}
          {period ? ` · ${period}` : ''}
        </p>
      </div>
    </Link>
  );
}

export default function AlbumsPage(): ReactElement {
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
        title="Albums"
        search={<SearchBox shortcutEnabled={!activity.isOpen && !showShortcuts} />}
        feed={{ unread: activity.unread, onOpen: activity.open }}
      />

      <main className="mx-auto max-w-[2000px] px-4 py-6 sm:px-6">
        {isPending && <Spinner label="Loading albums" />}

        {error && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">
            Cannot load the albums.
          </p>
        )}

        {albums && albums.length === 0 && (
          <div className="rounded-xl border border-dashed border-ink-700 px-6 py-12 text-center">
            <p className="text-sm text-ink-300">No album is assigned to you.</p>
            {/* Do not refer to `config/albums.yaml`: once an account exists the
                database is authoritative and the file is never reread. Following
                that instruction meant editing a file with no effect. */}
            <p className="mt-1 text-xs text-ink-400">
              {user?.admin
                ? 'Create an album from /admin, then assign it to an account.'
                : 'Ask the administrator of this instance to assign you one.'}
            </p>
          </div>
        )}

        {albums && albums.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {albums.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        )}
      </main>

      {activity.isOpen && (
        <CommentsFeed albumId={null} albumTitle={null} onClose={activity.close} />
      )}

      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
