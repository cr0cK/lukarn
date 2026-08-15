import type { FeedComment } from '@lukarn/shared';
import { type ReactElement, type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorText, mediaUrl } from '../api/client';
import { useCommentsFeed } from '../api/hooks';
import { groupByDayAndPhoto, type PhotoGroup } from '../lib/commentGroups';
import { emojify } from '../lib/emoji';
import { formatLocalDateTime, formatRelative } from '../lib/format';
import { useT } from '../lib/i18n';
import { unreadFeedCount, useSeenFeed } from '../lib/seenComments';
import { Spinner } from './Spinner';

/** Drawer scope: everything visible to the user, or only the open album. */
type Scope = 'all' | 'album';

export interface ActivityFeed {
  /** Messages received since the last visit, excluding the display cap. */
  unread: number;
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

/**
 * What gallery pages connect to their top bar: the badge and drawer opening.
 *
 * The count scope is **always** global, including from an album. The badge
 * answers "is there anything new anywhere?" — restricting it to the open album
 * would make it disappear when changing pages even though nothing was read.
 */
export function useActivityFeed(): ActivityFeed {
  const [isOpen, setIsOpen] = useState(false);
  const { comments, isSuccess } = useCommentsFeed(null);
  const { seenId, markFeedSeen } = useSeenFeed();

  const newest = comments[0]?.id ?? 0;
  const unread = unreadFeedCount(
    comments.map((comment) => comment.id),
    seenId,
  );

  useEffect(() => {
    // Do nothing until the first page arrives: the feed is still empty, and
    // marking here would clear the marker before reconstructing it incorrectly
    // when real identifiers arrive. This is the same trap as the viewer badge.
    if (!isSuccess) return;

    // An open drawer counts as read. A feed whose head has fallen **below** the
    // marker — through deletion or hiding — must lower it too, or the next message
    // would remain invisible until the gap was filled.
    if (isOpen || newest < seenId) markFeedSeen(newest);
  }, [isOpen, isSuccess, newest, seenId, markFeedSeen]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return { unread, isOpen, open, close };
}

/**
 * Activity drawer: the latest comments across all photos and albums.
 *
 * **It exists because a conversation cannot be discovered otherwise.** A
 * photo's badge assumes the right photo has already been opened, and nobody
 * stumbles across ten messages among thousands of views. A message without a
 * reader is lost — the drawer is the only place that reveals it was written.
 *
 * Grouping — day, then photo — matches the moderation queue in
 * `lib/commentGroups.ts`, for the same reasons: the date need not appear on
 * every row, nor the album/photo pair beneath every message in one thread.
 */
export function CommentsFeed({
  albumId,
  albumTitle,
  onClose,
}: {
  /** Open album, `null` from the album list where the toggle has no purpose. */
  albumId: string | null;
  albumTitle: string | null;
  onClose: () => void;
}): ReactElement {
  const t = useT();
  // Default to global scope, even in an album. That is what the badge counts,
  // and opening a narrower list than it announces would make people look for
  // messages that are not there.
  const [scope, setScope] = useState<Scope>('all');
  const active = scope === 'album' ? albumId : null;

  const { comments, isPending, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useCommentsFeed(active);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const days = groupByDayAndPhoto(comments, t);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('feed.title')}
      className="fixed inset-0 z-40 flex justify-end bg-black/60"
      onClick={onClose}
    >
      <aside
        // Full width on phones, a column from `sm` upwards: taking 384 px from a
        // 393 px screen would leave none of the grid behind, turning the drawer
        // into a page.
        className="flex h-full w-full flex-col border-l border-ink-700 bg-ink-850 sm:w-96"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-ink-800 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-ink-100">{t('feed.title')}</h2>
            <p className="mt-0.5 text-xs text-ink-400">{t('feed.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-ink-400 transition-colors hover:text-ink-100"
            aria-label={t('feed.close')}
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* Show the toggle only in an album: elsewhere, "this album" does
                  not refer to anything. */}
        {albumId && (
          <div className="flex gap-1 border-b border-ink-800 px-5 py-2.5">
            <ScopeTab active={scope === 'all'} onSelect={() => setScope('all')}>
              {t('feed.everyAlbum')}
            </ScopeTab>
            <ScopeTab active={scope === 'album'} onSelect={() => setScope('album')}>
              {albumTitle ?? t('feed.thisAlbum')}
            </ScopeTab>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isPending && (
            <div className="flex justify-center py-8">
              <Spinner label={t('feed.loading')} />
            </div>
          )}

          {error && (
            <p role="alert" className="px-5 py-4 text-sm text-ink-400">
              {errorText(error, t('feed.loadFailed'))}
            </p>
          )}

          {!isPending && !error && days.length === 0 && (
            <p className="px-5 py-6 text-sm text-ink-400">{t('feed.empty')}</p>
          )}

          {days.map((day) => (
            <section key={day.key}>
              <h3 className="sticky top-0 border-b border-ink-800 bg-ink-850/95 px-5 py-1.5 text-xs font-medium text-ink-300 backdrop-blur-sm">
                {day.label}
              </h3>
              {day.photos.map((photo) => (
                <PhotoBlock
                  key={photo.key}
                  photo={photo}
                  // When filtered to one album, repeating it beneath each photo
                  // duplicates what the toggle already shows atop the drawer.
                  showAlbum={scope === 'all'}
                  onNavigate={onClose}
                />
              ))}
            </section>
          ))}

          {hasNextPage && (
            <div className="px-5 py-4">
              {/* Use a button rather than infinite scrolling: the drawer shows
                  what just arrived, not an archive, and a scroll observer would
                  load whole pages beneath a thumb that is merely browsing. */}
              <button
                type="button"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
                className="w-full rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-300 transition-colors hover:bg-tint hover:text-ink-100 disabled:opacity-60"
              >
                {t(isFetchingNextPage ? 'common.loading' : 'feed.older')}
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function ScopeTab({
  active,
  onSelect,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`min-w-0 truncate rounded-lg px-2.5 py-1 text-xs transition-colors ${
        active ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:bg-tint hover:text-ink-200'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * A photo and the messages written beneath it.
 *
 * The entire block links to the photo **with the comments panel open**: arriving
 * at the image without the conversation would require reopening it manually,
 * precisely the detour this drawer exists to remove.
 */
function PhotoBlock({
  photo,
  showAlbum,
  onNavigate,
}: {
  photo: PhotoGroup<FeedComment>;
  showAlbum: boolean;
  onNavigate: () => void;
}): ReactElement {
  const t = useT();
  // Take the version from the first message: every message in a group refers to
  // the same photo, and therefore the same fingerprint.
  const version = photo.comments[0]?.mediaVersion ?? null;
  const target = `/album/${encodeURIComponent(photo.albumId)}?photo=${encodeURIComponent(photo.mediaId)}&panel=comments`;

  return (
    <article className="border-b border-ink-800 px-5 py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        {/* Put the thumbnail first: it identifies the conversation long before
            the filename does. A photo removed from the index no longer has one,
            so the block is no longer clickable — its link would open a viewer
            that immediately closed again. */}
        {photo.mediaName ? (
          <Link
            to={target}
            onClick={onNavigate}
            className="group shrink-0"
            aria-label={t('feed.view', photo.mediaName, photo.albumTitle)}
          >
            <img
              src={mediaUrl.thumb(photo.mediaId, 320, version)}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-14 rounded-lg bg-ink-800 object-cover transition-opacity group-hover:opacity-80"
            />
          </Link>
        ) : (
          <div className="size-14 shrink-0 rounded-lg bg-ink-800" aria-hidden="true" />
        )}

        <div className="min-w-0 flex-1">
          <p className="min-w-0 truncate text-xs text-ink-400">
            {photo.mediaName ? (
              <Link
                to={target}
                onClick={onNavigate}
                className="text-accent underline-offset-2 hover:underline"
              >
                {photo.mediaName}
              </Link>
            ) : (
              <span className="italic">{t('feed.removedPhoto')}</span>
            )}
            {showAlbum && <span> · {photo.albumTitle}</span>}
          </p>

          {/* Chronological **inside** the block while the block list remains in
              reverse chronological order — this is where the drawer differs
              from the moderation queue, which sorts newest to oldest throughout.
              This is a conversation: an answer above its question reads backwards.
              The block's place within the day still depends on its newest message. */}
          <ul className="mt-1.5 space-y-1.5">
            {[...photo.comments].reverse().map((comment) => (
              <li key={comment.id}>
                <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-400">
                  <span className="text-sm font-medium text-ink-100">
                    {comment.author.displayName}
                  </span>
                  <time
                    dateTime={comment.createdAt}
                    title={formatLocalDateTime(comment.createdAt, t)}
                  >
                    {formatRelative(comment.createdAt, t)}
                  </time>
                  {comment.parentId !== null && <span>· {t('comments.inReply')}</span>}
                </p>
                {/* At most three lines: the drawer is an overview of what was
                    said, not the conversation — that opens beneath the photo
                    with a way to reply. `emojify` returns plain text, never markup. */}
                <p className="mt-0.5 line-clamp-3 text-sm break-words whitespace-pre-wrap text-ink-200">
                  {emojify(comment.body)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}
