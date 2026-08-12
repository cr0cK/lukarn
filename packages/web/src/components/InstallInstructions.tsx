import { type ReactElement, useEffect } from 'react';
import { createPortal } from 'react-dom';

const ETAPES = [
  ['Share', 'The square with an arrow, at the bottom of the screen on iPhone.'],
  ['Add to Home Screen', 'A little further down the list.'],
  ['Add', 'Top right. You will be asked to sign in once more, only once.'],
] as const;

/**
 * iOS instructions modelled on `ShortcutsOverlay` — same overlay, same card:
 * inventing another dialog style for three lines would only add divergence to
 * maintain.
 *
 * Rendered in `document.body`, necessarily: it opens from `TopBar`, whose header
 * has a `backdrop-blur`. A filter makes the element the containing block of its
 * `fixed` descendants — the overlay's `inset-0` would then relate to the roughly
 * fifty-pixel-high bar, centring the dialog there and clipping its top.
 */
export function InstallInstructions({ onClose }: { onClose: () => void }): ReactElement {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add to home screen"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-ink-700 bg-ink-850 p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-medium">Add to home screen</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-400 transition-colors hover:text-ink-100"
            aria-label="Close"
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
        </div>

        <ol className="space-y-4">
          {ETAPES.map(([libelle, precision], rang) => (
            <li key={libelle} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink-800 text-xs text-ink-300">
                {rang + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm text-ink-100">{libelle}</p>
                <p className="text-xs text-ink-400">{precision}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>,
    document.body,
  );
}
