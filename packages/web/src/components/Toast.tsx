import { type ReactElement, useEffect } from 'react';
import { createPortal } from 'react-dom';

/** Action outcome rendered inside a bottom-center toast pill. */
export interface ToastNotice {
  tone: 'ok' | 'error';
  text: string;
}

/** Props for the bottom-center `Toast` notification pill. */
export interface ToastProps {
  notice: ToastNotice | null;
  onDismiss?: () => void;
  /** Auto-dismiss timeout in milliseconds when `onDismiss` is supplied (default: 3200). */
  durationMs?: number;
  /** Optional accessible label for a manual close button. */
  dismissLabel?: string;
}

/**
 * Bottom-center notification pill with a leading vector status icon.
 *
 * Anchored at `bottom-6 left-1/2 -translate-x-1/2` so it never collides with the
 * Lightbox right-hand comment "Post" button or top toolbar controls, and never uses
 * colored left-border side stripes.
 */
export function Toast({
  notice,
  onDismiss,
  durationMs = 3200,
  dismissLabel,
}: ToastProps): ReactElement | null {
  useEffect(() => {
    if (!notice || !onDismiss || durationMs <= 0) return;
    const timer = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(timer);
  }, [notice, onDismiss, durationMs]);

  if (!notice) return null;

  const pill = (
    <div
      role={notice.tone === 'error' ? 'alert' : 'status'}
      aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
      className="fixed bottom-6 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-[#454552] bg-[#24242b] px-4 py-2 text-sm font-medium text-[#f4f4f6] shadow-xl light:border-zinc-200 light:bg-white light:text-zinc-900"
    >
      {notice.tone === 'ok' ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="size-4 shrink-0 text-emerald-400 light:text-emerald-600"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="size-4 shrink-0 text-red-400 light:text-red-600"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4" />
          <circle cx="12" cy="16" r="1" fill="currentColor" stroke="none" />
        </svg>
      )}
      <span className="truncate">{notice.text}</span>
      {onDismiss && dismissLabel && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="ml-1 rounded-full p-0.5 text-ink-300 transition-colors hover:bg-tint hover:text-ink-100"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="size-3.5"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );

  if (typeof document === 'undefined') return pill;
  return createPortal(pill, document.body);
}
