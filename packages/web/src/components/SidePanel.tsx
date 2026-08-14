import type { AlbumDay, MediaDetail } from '@lukarn/shared';
import type { ReactElement } from 'react';
import { useT } from '../lib/i18n';
import { CommentsPanel } from './CommentsPanel';
import { ExifPanel } from './ExifPanel';

/** Tab displayed by the viewer side panel. */
export type PanelTab = 'info' | 'comments';

/**
 * The tab lives in the URL like the open photo: this lets a link — from the
 * activity drawer or a notification email — open the conversation, not only the
 * image. An unknown value from a hand-edited URL means "panel closed" rather
 * than an empty tab.
 */
export function isPanelTab(value: string | null): value is PanelTab {
  return value === 'info' || value === 'comments';
}

/**
 * Viewer side panel: metadata and comments in a single two-tab frame.
 *
 * Two separate `aside` elements would compete for the same space, each with a
 * header and close button, and switching between them would shift the image
 * twice. One frame solves both: the photo shrinks once and the inactive tab
 * remains one click away.
 *
 * On a large screen the shrink is literal — the panel occupies a column in the
 * flow. This lets it remain open: as an overlay, it covered the "Next" arrow.
 * Zoom need not know, because `ZoomableImage` measures its container with
 * `ResizeObserver`.
 *
 * **Below `md` this component is not used.** The viewer renders `PanelBody` into
 * a sheet instead, where the same tabs are reached by pulling the caption up.
 * Only the frame differs; everything inside it is shared, which is why the body
 * lives in its own component rather than behind a prop on this one.
 */
export function SidePanel({
  albumId,
  mediaId,
  mediaName,
  detail,
  day,
  tab,
  onTabChange,
  onClose,
}: {
  albumId: string;
  mediaId: string;
  mediaName: string;
  detail: MediaDetail | undefined;
  /** Photo day, when it carries a note or place. */
  day: AlbumDay | undefined;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  onClose: () => void;
}): ReactElement {
  const t = useT();

  return (
    <aside
      // Two modes depending on width. From `md`, the panel sits in the flow: the
      // photo area shrinks accordingly, navigation arrows remain reachable, and
      // the panel can stay open between photos. Below that, it becomes an overlay
      // — taking 320 px from a phone screen would leave nothing to see.
      // Use `ink-850`, not `ink-900`: the viewer is `ink-950`, and two blacks only
      // three luminance points apart blended together — only the border revealed
      // the open panel.
      className="absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-ink-700 bg-ink-850/95 backdrop-blur-sm md:relative md:z-0 md:w-80 md:shrink-0 md:bg-ink-850 md:backdrop-blur-none lg:w-96"
      aria-label={t('panel.label')}
    >
      <header className="flex items-start justify-between gap-4 border-b border-ink-800 px-5 py-4">
        <h3 className="min-w-0 text-sm font-medium break-words text-ink-100">{mediaName}</h3>
        <button
          type="button"
          onClick={onClose}
          // `-my-1 -mr-1` removes the padding that enlarges the click target from
          // the flow without removing it from the target itself: the cross then
          // aligns with the filename baseline and the panel's right margin.
          // Without this, its 4 px placed it below the title and to the right of
          // the content column — two offsets that are hard to name but visible.
          className="-my-1 -mr-1 shrink-0 rounded p-1 text-ink-400 transition-colors hover:text-ink-100"
          aria-label={t('panel.close')}
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

      <PanelBody
        albumId={albumId}
        mediaId={mediaId}
        detail={detail}
        day={day}
        tab={tab}
        onTabChange={onTabChange}
      />
    </aside>
  );
}

/**
 * The two tabs and their contents, without the frame holding them.
 *
 * Extracted because the frame is the only thing that changes with width: a
 * column above `md`, a sheet below it. Duplicating the tabs would eventually
 * leave the comment count on one of the two.
 */
export function PanelBody({
  albumId,
  mediaId,
  detail,
  day,
  tab,
  onTabChange,
}: {
  albumId: string;
  mediaId: string;
  detail: MediaDetail | undefined;
  day: AlbumDay | undefined;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
}): ReactElement {
  const t = useT();

  return (
    <>
      <div role="tablist" aria-label={t('panel.sections')} className="flex border-b border-ink-800">
        <Tab selected={tab === 'info'} onSelect={() => onTabChange('info')} controls="panel-info">
          {t('panel.info')}
        </Tab>
        <Tab
          selected={tab === 'comments'}
          onSelect={() => onTabChange('comments')}
          controls="panel-comments"
        >
          {t('panel.comments')}
          {/* The count comes from already loaded media detail: showing "3"
              before the tab opens is what makes it worth reading. */}
          {detail && detail.commentCount > 0 && (
            <span className="ml-1.5 rounded-full bg-ink-700 px-1.5 py-0.5 text-[0.7rem] text-ink-200">
              {detail.commentCount}
            </span>
          )}
        </Tab>
      </div>

      {tab === 'info' ? (
        <div id="panel-info" role="tabpanel" className="flex-1 overflow-y-auto">
          <ExifPanel detail={detail} day={day} />
        </div>
      ) : (
        // No `overflow-y-auto` here: the comments panel manages its own scrolling
        // to keep the form anchored at the bottom.
        <div id="panel-comments" role="tabpanel" className="flex min-h-0 flex-1 flex-col">
          <CommentsPanel albumId={albumId} mediaId={mediaId} />
        </div>
      )}
    </>
  );
}

function Tab({
  selected,
  onSelect,
  controls,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  controls: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={controls}
      onClick={onSelect}
      className={`flex-1 border-b-2 px-4 py-2.5 text-sm transition-colors ${
        selected
          ? 'border-accent text-ink-100'
          : 'border-transparent text-ink-400 hover:text-ink-200'
      }`}
    >
      {children}
    </button>
  );
}
