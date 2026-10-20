import { type ReactElement, type ReactNode } from 'react';
import { CommentIcon, IconButton, InfoIcon, StarIcon } from './Tooltip';

/** Props for the `LightboxChrome` top toolbar primitive. */
export interface LightboxChromeProps {
  /** Close/Back button label. */
  closeLabel: string;
  /** Closes the Lightbox viewer. */
  onClose: () => void;
  /** Position counter (`"4 / 128"`). */
  counter: string;
  /** Optional media filename or caption shown next to the counter on desktop. */
  title?: string;
  /** Optional `★` Favorites toggle descriptor (shortcut `s` or `f`). */
  favorite?: {
    active: boolean;
    label: string;
    onToggle: () => void;
  };
  /** Optional `Comments` toggle descriptor. */
  comments?: {
    active: boolean;
    count: number;
    label: string;
    onToggle: () => void;
  };
  /** Optional `Info` (`i`) toggle descriptor. */
  info?: {
    active: boolean;
    label: string;
    onToggle: () => void;
  };
  /** Optional `Download` action descriptor. */
  download?: {
    label: string;
    href?: string;
    downloadName?: string;
    onDownload?: () => void;
  };
  /** Optional `Fullscreen` toggle descriptor. */
  fullscreen?: {
    active: boolean;
    label: string;
    onToggle: () => void;
  };
  /** Optional desktop zoom or extra control slot. */
  extraActions?: ReactNode;
  /** Optional `⋮` secondary / Admin kebab menu slot. */
  kebabSlot?: ReactNode;
  /**
   * When `true` (e.g. for `<video>` on mobile where the bottom sheet is suppressed
   * to keep native video controls unobstructed), keeps the action icons visible below `md`.
   */
  showActionsOnMobile?: boolean;
  /** Hides the overlay bar when the user toggles clean stage mode (`H`). */
  hidden?: boolean;
}

/**
 * Top toolbar chrome for the Lightbox viewer:
 * - Left: Close/Back button + photo counter (`4 / 128`).
 * - Right: 5 homogeneous `36x36` (`size-9 rounded-full`) vector SVG icon buttons
 *   (`★ Favorites`, `Comments` with centered count badge, `Info` with explicit `<circle>` dot,
 *   `Download`, `Fullscreen`) + `⋮ Admin` kebab menu.
 * - Remains accessible on mobile for `<video>` items (`showActionsOnMobile`) where the
 *   bottom sheet is hidden to preserve native video controls.
 */
export function LightboxChrome({
  closeLabel,
  onClose,
  counter,
  title,
  favorite,
  comments,
  info,
  download,
  fullscreen,
  extraActions,
  kebabSlot,
  showActionsOnMobile = false,
  hidden = false,
}: LightboxChromeProps): ReactElement {
  const actionsVisibility = showActionsOnMobile ? 'flex' : 'hidden md:flex';

  return (
    <header
      className={`z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-zinc-950/90 px-3 text-zinc-100 backdrop-blur-md transition-opacity duration-200 sm:px-4 ${
        hidden ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <IconButton label={closeLabel} surface="stage" onClick={onClose}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="size-4"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </IconButton>
        <span className="font-mono text-xs text-zinc-400 tabular-nums">{counter}</span>
        {title && (
          <span className="hidden truncate text-sm font-medium text-zinc-200 sm:inline">
            {title}
          </span>
        )}
      </div>

      <div className={`items-center gap-1.5 ${actionsVisibility}`}>
        {extraActions}

        {favorite && (
          <IconButton
            label={favorite.label}
            surface="stage"
            active={favorite.active}
            activeTone="gold"
            aria-pressed={favorite.active}
            onClick={favorite.onToggle}
          >
            <StarIcon filled={favorite.active} />
          </IconButton>
        )}

        {comments && (
          <IconButton
            label={comments.label}
            surface="stage"
            active={comments.active}
            aria-pressed={comments.active}
            badgeCount={comments.count}
            badgeTone="accent"
            onClick={comments.onToggle}
          >
            <CommentIcon />
          </IconButton>
        )}

        {info && (
          <IconButton
            label={info.label}
            surface="stage"
            active={info.active}
            aria-pressed={info.active}
            onClick={info.onToggle}
          >
            <InfoIcon />
          </IconButton>
        )}

        {download && (
          <IconButton
            label={download.label}
            surface="stage"
            onClick={() => {
              if (download.onDownload) {
                download.onDownload();
                return;
              }
              if (download.href) {
                const anchor = document.createElement('a');
                anchor.href = download.href;
                if (download.downloadName) anchor.download = download.downloadName;
                anchor.click();
              }
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="size-4"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </IconButton>
        )}

        {fullscreen && (
          <IconButton
            label={fullscreen.label}
            surface="stage"
            active={fullscreen.active}
            aria-pressed={fullscreen.active}
            onClick={fullscreen.onToggle}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="size-4"
            >
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </IconButton>
        )}

        {kebabSlot}
      </div>
    </header>
  );
}
