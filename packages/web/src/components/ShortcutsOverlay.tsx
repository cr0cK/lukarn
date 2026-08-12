import { type ReactElement, useEffect } from 'react';

const GROUPS: { title: string; shortcuts: [string, string][] }[] = [
  {
    title: 'Albums',
    shortcuts: [
      ['/', 'Search an album, a place, a photo'],
      ['↑ ↓', 'Walk through the suggestions'],
      ['Enter', 'Open the suggestion'],
      ['Esc', 'Close the list, then clear the field'],
    ],
  },
  {
    title: 'Grid',
    shortcuts: [
      ['← ↑ ↓ →', 'Move between photos'],
      ['Enter', 'Open fullscreen'],
      ['Home / End', 'First / last photo'],
      ['Esc', 'Back to the albums'],
    ],
  },
  {
    title: 'Viewer',
    shortcuts: [
      ['← →', 'Previous / next photo'],
      ['Esc', 'Leave the zoom, then close'],
      ['F', 'Fullscreen'],
      ['I', 'Information and EXIF'],
      ['C', 'Comments'],
      ['D', 'Download the original'],
      ['Z', 'Zoom to 100%'],
      ['L', 'Hide / show the caption'],
      ['H', 'Hide the chrome, nothing but the photo'],
      ['Wheel', 'Zoom in or out'],
      ['Drag', 'Move inside the image, or inside the locator at bottom right'],
      ['Space', 'Play / pause video'],
    ],
  },
];

/** Shortcut reference opened with `?`. */
export function ShortcutsOverlay({ onClose }: { onClose: () => void }): ReactElement {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === '?') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-ink-700 bg-ink-850 p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-medium">Keyboard shortcuts</h2>
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

        <div className="grid gap-6 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-3 text-xs tracking-wide text-ink-400 uppercase">{group.title}</h3>
              <dl className="space-y-2">
                {group.shortcuts.map(([keys, description]) => (
                  <div key={keys} className="flex items-baseline gap-3">
                    <dt className="w-24 shrink-0">
                      <kbd className="rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-ink-200">
                        {keys}
                      </kbd>
                    </dt>
                    <dd className="text-sm text-ink-300">{description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
