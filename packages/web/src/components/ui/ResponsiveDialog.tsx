import { type ReactElement, type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../lib/i18n';

/** Props for the `ResponsiveDialog` modal / bottom-sheet primitive. */
export interface ResponsiveDialogProps {
  /** Whether the dialog is open (default: `true` for conditionally mounted dialogs). */
  open?: boolean;
  /** Dialog title (`<h3>` at `text-base font-semibold tracking-tight`). */
  title: string;
  /** Optional subtitle below the title (`text-sm text-ink-400`). */
  description?: ReactNode;
  /** Called when the user presses `Escape`, clicks the backdrop, or clicks the close button. */
  onClose: () => void;
  /** Dialog body content. */
  children: ReactNode;
  /** Optional sticky footer row for form actions (`Cancel` / `Save`). */
  footer?: ReactNode;
  /** Desktop max-width utility class (default: `'md:max-w-lg'`). */
  maxWidthClass?: string;
}

/**
 * Responsive dialog primitive:
 * - On Desktop (`>= md`): centered `rounded-2xl` modal (`max-w-lg`).
 * - On Mobile (`< md`): bottom sheet (`w-full max-h-[90dvh] rounded-t-2xl`) with a drag handle
 *   and safe-area bottom inset.
 *
 * Manages backdrop click dismissal, `Escape` key handling (capture phase), focus restoration,
 * and body scroll locking.
 */
export function ResponsiveDialog({
  open = true,
  title,
  description,
  onClose,
  children,
  footer,
  maxWidthClass = 'md:max-w-lg',
}: ResponsiveDialogProps): ReactElement | null {
  const t = useT();
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const dialog = (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-4">
      <button
        type="button"
        aria-label={t('common.close')}
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-black/60 backdrop-blur-[1px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`relative z-10 flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-2xl border-t border-zinc-800 bg-ink-850 pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none md:max-h-[85dvh] md:rounded-2xl md:border md:pb-0 light:border-zinc-200 light:bg-white ${maxWidthClass}`}
      >
        <div className="flex justify-center pt-2.5 pb-1 md:hidden" aria-hidden="true">
          <span className="h-1 w-9 rounded-full bg-zinc-700 light:bg-zinc-300" />
        </div>

        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4 light:border-zinc-200">
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-semibold tracking-tight text-ink-100">
              {title}
            </h3>
            {description && (
              <p id={descId} className="mt-1 text-sm text-ink-400">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-tint hover:text-ink-100"
          >
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
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>

        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-zinc-800 bg-ink-900/40 px-5 py-3.5 light:border-zinc-200 light:bg-zinc-50">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
