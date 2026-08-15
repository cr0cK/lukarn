import type { AdminAlbum, AdminComment, ModerationFilter } from '@lukarn/shared';
import { type ReactElement, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorText } from '../../api/client';
import {
  useAdminAlbums,
  useAdminComments,
  useModerateComment,
  useModerateCommenter,
} from '../../api/hooks';
import { formatLocalDateTime, formatRelative } from '../../lib/format';
import { useT, type Translate } from '../../lib/i18n';
import { groupByDayAndPhoto, type PhotoGroup } from '../../lib/commentGroups';
import { Spinner } from '../Spinner';
import { ConfirmDialog } from './ConfirmDialog';
import { Button, FormError, ROW_ACTIONS_CLASS, ROW_CLASS, Section, type Notify } from './ui';

/**
 * One page fits on a screen once days and photos are grouped. Fifty rows — the
 * server default — turned it back into a list scrolled without seeing the end.
 */
const PAGE_SIZE = 25;

/** One keystroke does not warrant one request: wait for input to settle. */
const SEARCH_DELAY_MS = 300;

const FILTER_LABELS: Record<ModerationFilter, Parameters<Translate>[0]> = {
  all: 'moderation.all',
  visible: 'moderation.visible',
  hidden: 'moderation.hidden',
};

/**
 * Moderation queue: a work list, not a feed (D67).
 *
 * Hide rather than delete: a comment removed by mistake can be restored, and the
 * administrator need not decide permanently in the moment. Deletion remains
 * available from the gallery, where the photo is visible.
 */
export function CommentsSection({ notify }: { notify: Notify }): ReactElement {
  const t = useT();
  const [filter, setFilter] = useState<ModerationFilter>('all');
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const q = useDeferredSearch(search);

  // Use a stack rather than a page number: pagination uses cursors, and only the
  // path travelled allows going back. `null` is the first page.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  // Use an explicit index rather than `.at(-1)`: that method exists only from
  // Chromium 92, while the target television browser is 79 (D260809f). It does
  // not merely break layout; it throws and leaves the administration page blank.
  const cursor = cursors[cursors.length - 1]!;

  const [bulkTarget, setBulkTarget] = useState<AdminComment | null>(null);

  // Changing filters invalidates the path: page 4 of one search has nothing to
  // do with page 4 of the next.
  useEffect(() => setCursors([null]), [filter, albumId, q]);

  const albums = useAdminAlbums();
  const { data, isPending, error, isFetching } = useAdminComments({
    filter,
    albumId,
    q,
    limit: PAGE_SIZE,
    cursor,
  });

  const days = groupByDayAndPhoto(data?.comments ?? [], t);
  const first = (cursors.length - 1) * PAGE_SIZE + 1;
  const last = first + (data?.comments.length ?? 0) - 1;

  return (
    <Section title={t('moderation.title')} description={t('moderation.description')}>
      {/* Put the filter bar in the body rather than the section header: three
          tabs, an album selector and a search field do not fit beside a title. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-850 px-4 py-3">
        <div className="flex gap-1 rounded-lg border border-ink-700 p-0.5">
          {(Object.keys(FILTER_LABELS) as ModerationFilter[]).map((value) => (
            <FilterTab key={value} active={filter === value} onClick={() => setFilter(value)}>
              {t(FILTER_LABELS[value])}
            </FilterTab>
          ))}
        </div>

        <AlbumFilter albums={albums.data} value={albumId} onChange={setAlbumId} />

        {/* `basis-64` decides when it wraps: `flex-1` alone gave it what remained
            after the tabs and selector, roughly thirty pixels on a tablet — a
            field where input was invisible. Declaring 16 rem moves it to a new
            line when needed, then lets it grow. */}
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('moderation.searchPlaceholder')}
          aria-label={t('moderation.searchLabel')}
          maxLength={200}
          className="min-w-0 flex-1 basis-64 rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm outline-none placeholder:text-ink-500 focus:border-accent-dim"
        />
      </div>

      {isPending ? (
        <div className="flex justify-center py-8">
          <Spinner label={t('moderation.loading')} />
        </div>
      ) : error ? (
        <div className="px-4 py-4">
          <FormError message={errorText(error, t('moderation.loadFailed'))} />
        </div>
      ) : days.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-400">{emptyMessage(filter, q, albumId, t)}</p>
      ) : (
        <>
          {/* `isFetching` without `isPending`: keep an already displayed page on
              screen, merely dimmed, while the next arrives. */}
          <div className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
            {days.map((day) => (
              <section key={day.key}>
                <h3 className="border-b border-ink-850 bg-ink-900/40 px-4 py-1.5 text-xs font-medium text-ink-300">
                  {day.label}
                </h3>
                {day.photos.map((photo) => (
                  <PhotoBlock
                    key={photo.key}
                    photo={photo}
                    notify={notify}
                    onBulk={setBulkTarget}
                  />
                ))}
              </section>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-850 px-4 py-3">
            <Button
              onClick={() => setCursors(cursors.slice(0, -1))}
              disabled={cursors.length === 1}
            >
              {t('moderation.previous')}
            </Button>

            <p className="text-xs text-ink-400">{t('moderation.range', first, last, data.total)}</p>

            <Button
              onClick={() => setCursors([...cursors, data.nextCursor])}
              disabled={data.nextCursor === null}
            >
              {t('moderation.next')}
            </Button>
          </div>
        </>
      )}

      {bulkTarget && (
        <BulkDialog
          comment={bulkTarget}
          restore={filter === 'hidden'}
          notify={notify}
          onClose={() => setBulkTarget(null)}
        />
      )}
    </Section>
  );
}

/**
 * An empty queue says what to do next, which differs between receiving nothing
 * and searching incorrectly.
 */
function emptyMessage(
  filter: ModerationFilter,
  q: string | null,
  albumId: string | null,
  t: Translate,
): string {
  if (q) return t('moderation.noMatch', q);
  if (albumId) return t('moderation.noneInAlbum');
  if (filter === 'hidden') return t('moderation.noneHidden');
  if (filter === 'visible') return t('moderation.noneVisible');
  return t('moderation.none');
}

/** Delays search: without this pause, every keystroke would reach the server. */
function useDeferredSearch(search: string): string | null {
  const [deferred, setDeferred] = useState(search);

  useEffect(() => {
    const timer = setTimeout(() => setDeferred(search), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  return deferred.trim() || null;
}

/**
 * Queue album selector.
 *
 * Use a plain `<select>` rather than `ui.tsx`'s `SelectField`: that one is a form
 * row — a label above the control, a `SettingRow` on a phone — and this is a
 * header control, named by `aria-label` and sized to the space beside a title.
 * The queue does not wait for it either: it appears while albums load and fills
 * when they arrive.
 */
function AlbumFilter({
  albums,
  value,
  onChange,
}: {
  albums: AdminAlbum[] | undefined;
  value: string | null;
  onChange: (albumId: string | null) => void;
}): ReactElement {
  const t = useT();

  return (
    // `min-w-0`: a `select` requests the width of its longest option, and a
    // sixty-character album title made it overflow the section on a phone. It
    // therefore gets its own line below `sm` and remains bounded above it.
    <select
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
      aria-label={t('moderation.filterByAlbum')}
      className="w-full min-w-0 truncate rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-sm text-ink-200 outline-none focus:border-accent-dim sm:w-auto sm:max-w-64"
    >
      <option value="">{t('moderation.everyAlbum')}</option>
      {albums?.map((album) => (
        <option key={album.id} value={album.id}>
          {album.title}
        </option>
      ))}
    </select>
  );
}

/**
 * Comments on one photo under a single heading.
 *
 * Repeating "IMG_0043 — Holidays 2025" beneath all six messages in a thread
 * buries the only information changing between rows: what was written and by whom.
 */
function PhotoBlock({
  photo,
  notify,
  onBulk,
}: {
  photo: PhotoGroup<AdminComment>;
  notify: Notify;
  onBulk: (comment: AdminComment) => void;
}): ReactElement {
  const t = useT();

  return (
    <div className="border-b border-ink-850 px-4 py-3 last:border-b-0">
      <p className="min-w-0 text-xs text-ink-400">
        {/* Link to the commented photo: moderating without seeing the image
            that prompted the message means judging words without context. The
            media may have disappeared from the index, in which case omit the link. */}
        {photo.mediaName ? (
          <Link
            to={`/album/${encodeURIComponent(photo.albumId)}?photo=${encodeURIComponent(photo.mediaId)}`}
            className="text-accent underline-offset-2 hover:underline"
          >
            {photo.mediaName}
          </Link>
        ) : (
          <span className="italic">{t('moderation.removedPhoto')}</span>
        )}
        <span> — {photo.albumTitle}</span>
      </p>

      <ul className="mt-1 divide-y divide-ink-850/60">
        {photo.comments.map((comment) => (
          <CommentRow key={comment.id} comment={comment} notify={notify} onBulk={onBulk} />
        ))}
      </ul>
    </div>
  );
}

function CommentRow({
  comment,
  notify,
  onBulk,
}: {
  comment: AdminComment;
  notify: Notify;
  onBulk: (comment: AdminComment) => void;
}): ReactElement {
  const t = useT();
  const moderate = useModerateComment();
  const hidden = comment.hiddenAt !== null;

  const toggle = (): void => {
    moderate.mutate(
      { commentId: comment.id, hide: !hidden },
      {
        onSuccess: () =>
          notify({
            tone: 'ok',
            text: t(hidden ? 'moderation.visibleNotice' : 'moderation.hiddenNotice'),
          }),
        onError: (error) =>
          notify({ tone: 'error', text: errorText(error, t('moderation.failed')) }),
      },
    );
  };

  return (
    <li className={`py-2 ${hidden ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-ink-400">
        <span className="text-sm font-medium text-ink-100">{comment.author.displayName}</span>
        {/* Show the verified address only in moderation: it identifies who is
            behind a declared name, which the thread need not reveal. It carries
            the bulk action because it is what someone checks when asking "where
            did all this come from?" */}
        <button
          type="button"
          onClick={() => onBulk(comment)}
          className="rounded text-ink-400 underline decoration-dotted underline-offset-2 transition-colors hover:text-ink-100"
          title={t('moderation.moderateAll', comment.authorEmail)}
        >
          {comment.authorEmail}
        </button>
        <time dateTime={comment.createdAt} title={formatLocalDateTime(comment.createdAt, t)}>
          {formatRelative(comment.createdAt, t)}
        </time>
        {comment.parentId !== null && <span>· {t('moderation.inReply')}</span>}
        {/* Access key used to write: this is what gets changed when a shared
            password has circulated too widely. */}
        {comment.account && <span>· {t('moderation.via', comment.account)}</span>}
        {hidden && (
          <span className="rounded bg-ink-700 px-1.5 py-0.5 text-ink-200">
            {comment.hiddenBy
              ? t('moderation.hiddenBy', comment.hiddenBy)
              : t('moderation.hiddenBadge')}
          </span>
        )}
      </div>

      {/* Use `sm:items-start`, not `sm:items-center`: a multiline message would
          centre its button halfway down, far from the line just read. */}
      <div className={`${ROW_CLASS} mt-1 xl:items-start`}>
        <p className="min-w-0 flex-1 text-sm break-words whitespace-pre-wrap text-ink-200">
          {comment.body}
        </p>

        <div className={ROW_ACTIONS_CLASS}>
          <Button
            onClick={toggle}
            disabled={moderate.isPending}
            variant={hidden ? 'default' : 'danger'}
          >
            {t(hidden ? 'moderation.makeVisible' : 'moderation.hide')}
          </Button>
        </div>
      </div>
    </li>
  );
}

/**
 * Confirmation for bulk moderation.
 *
 * Mounted by the section rather than the row: a hidden comment has `opacity-60`,
 * tinting its whole subtree and creating a stacking context — a modal rendered
 * there would appear at 60% and beneath the rest of the page.
 *
 * **The action comes from the tab, not the clicked row.** Based on comment state,
 * the same address would offer hiding on one row and restoring on the next.
 */
function BulkDialog({
  comment,
  restore,
  notify,
  onClose,
}: {
  comment: AdminComment;
  restore: boolean;
  notify: Notify;
  onClose: () => void;
}): ReactElement {
  const t = useT();
  const moderate = useModerateCommenter();

  const confirm = (): void => {
    moderate.mutate(
      { commenterId: comment.commenterId, hide: !restore },
      {
        onSuccess: ({ affected }) => {
          notify({ tone: 'ok', text: t('moderation.bulkDone', affected, restore) });
          onClose();
        },
        onError: (error) => {
          notify({ tone: 'error', text: errorText(error, t('moderation.bulkFailed')) });
          onClose();
        },
      },
    );
  };

  return (
    <ConfirmDialog
      title={
        restore
          ? t('moderation.bulkRestoreTitle', comment.authorEmail)
          : t('moderation.bulkHideTitle', comment.authorEmail)
      }
      confirmLabel={t(restore ? 'moderation.bulkRestoreButton' : 'moderation.bulkHideButton')}
      busy={moderate.isPending}
      onConfirm={confirm}
      onCancel={onClose}
    >
      <p>
        {t('moderation.bulkScope')} <strong>{t('moderation.bulkScopeStrong')}</strong>
        {t('moderation.bulkScopeEnd')}
      </p>
      <p>{t(restore ? 'moderation.bulkRestoreHint' : 'moderation.bulkHideHint')}</p>
    </ConfirmDialog>
  );
}

function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
        active ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-200'
      }`}
    >
      {children}
    </button>
  );
}
