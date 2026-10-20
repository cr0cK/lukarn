import { type ReactElement, type ReactNode, useEffect } from 'react';
import { PHONE_QUERY, useMediaQuery } from '../../lib/useMediaQuery';

/** Props for the `ResponsiveSidePanel` viewer frame primitive. */
export interface ResponsiveSidePanelProps {
  /** Whether the panel is open. */
  open: boolean;
  /** Accessible name for the `<aside>` / dialog region. */
  label: string;
  /** Accessible name for the mobile backdrop close button. */
  closeLabel?: string;
  /** Closes the side panel / mobile bottom sheet. */
  onClose: () => void;
  /** Active tab content (`CommentsPanel` or `ExifPanel`). */
  children: ReactNode;
}

/**
 * Responsive side panel for the Lightbox viewer:
 * - On Desktop (`>= md`): right-hand `360px` column (`w-[360px] shrink-0 border-l`) in the
 *   flex flow **without** a redundant sub-header (`mediaName` + close button) or redundant
 *   `Infos | Commentaires` sub-tab strip, because the Lightbox top bar icons (`Commentaires`
 *   and `Infos`) already switch tabs and toggle the panel closed.
 * - On Mobile (`< md`): bottom sheet (`max-h-[75dvh] rounded-t-2xl`) with a drag handle and
 *   backdrop dismissal.
 */
export function ResponsiveSidePanel({
  open,
  label,
  closeLabel = 'Close',
  onClose,
  children,
}: ResponsiveSidePanelProps): ReactElement | null {
  const phone = useMediaQuery(PHONE_QUERY);

  useEffect(() => {
    if (!open || !phone) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, phone, onClose]);

  if (!open) return null;

  if (phone) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col justify-end md:hidden">
        <button
          type="button"
          aria-label={closeLabel}
          tabIndex={-1}
          onClick={onClose}
          className="fixed inset-0 cursor-default bg-black/50"
        />
        <section
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="relative z-10 flex max-h-[75dvh] w-full flex-col overflow-hidden rounded-t-2xl border-t border-zinc-800 bg-ink-850 pb-[env(safe-area-inset-bottom)] shadow-2xl light:border-zinc-200 light:bg-white"
        >
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className="flex h-9 w-full shrink-0 items-center justify-center transition-colors hover:bg-tint"
          >
            <span
              aria-hidden="true"
              className="h-1 w-9 rounded-full bg-zinc-700 light:bg-zinc-300"
            />
          </button>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
            {children}
          </div>
        </section>
      </div>
    );
  }

  return (
    <aside
      aria-label={label}
      className="hidden md:relative md:z-0 md:flex md:w-[360px] md:shrink-0 md:flex-col md:border-l md:border-zinc-800 md:bg-ink-850 light:md:border-zinc-200 light:md:bg-white"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {children}
      </div>
    </aside>
  );
}
