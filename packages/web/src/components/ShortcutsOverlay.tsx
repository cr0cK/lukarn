import { type ReactElement, useEffect } from 'react';
import { useT, type MessageKey } from '../lib/i18n';

/**
 * What triggers a shortcut. A **keystroke** is written as it appears on the
 * keyboard and is the same everywhere; a **gesture** is a word — "Wheel",
 * "Drag" — and reads in the language of the interface like everything else.
 */
type Trigger = { key: string } | { gesture: MessageKey };

/** The reference. What each trigger does is always a message. */
const GROUPS: { title: MessageKey; shortcuts: [Trigger, MessageKey][] }[] = [
  {
    title: 'shortcuts.albums',
    shortcuts: [
      [{ key: '/' }, 'shortcuts.search'],
      [{ key: '↑ ↓' }, 'shortcuts.walk'],
      [{ key: 'Enter' }, 'shortcuts.openSuggestion'],
      [{ key: 'Esc' }, 'shortcuts.escapeSearch'],
    ],
  },
  {
    title: 'shortcuts.grid',
    shortcuts: [
      [{ key: '← ↑ ↓ →' }, 'shortcuts.move'],
      [{ key: 'Enter' }, 'shortcuts.openFullscreen'],
      [{ key: 'Home / End' }, 'shortcuts.firstLast'],
      [{ key: 'Esc' }, 'shortcuts.backToAlbums'],
    ],
  },
  {
    title: 'shortcuts.viewer',
    shortcuts: [
      [{ key: '← →' }, 'shortcuts.prevNext'],
      [{ key: 'Esc' }, 'shortcuts.escapeViewer'],
      [{ key: 'F' }, 'shortcuts.fullscreen'],
      [{ key: 'I' }, 'shortcuts.info'],
      [{ key: 'C' }, 'shortcuts.comments'],
      [{ key: 'D' }, 'shortcuts.download'],
      [{ key: 'Z' }, 'shortcuts.zoom'],
      [{ key: 'L' }, 'shortcuts.caption'],
      [{ key: 'H' }, 'shortcuts.chrome'],
      [{ gesture: 'shortcuts.wheelTrigger' }, 'shortcuts.wheel'],
      [{ gesture: 'shortcuts.dragTrigger' }, 'shortcuts.drag'],
      [{ key: 'Space' }, 'shortcuts.play'],
    ],
  },
];

/** Shortcut reference opened with `?`. */
export function ShortcutsOverlay({ onClose }: { onClose: () => void }): ReactElement {
  const t = useT();

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
      aria-label={t('shortcuts.title')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-ink-700 bg-ink-850 p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-medium">{t('shortcuts.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-400 transition-colors hover:text-ink-100"
            aria-label={t('common.close')}
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
              <h3 className="mb-3 text-xs tracking-wide text-ink-400 uppercase">
                {t(group.title)}
              </h3>
              <dl className="space-y-2">
                {group.shortcuts.map(([trigger, description]) => (
                  <div key={description} className="flex items-baseline gap-3">
                    <dt className="w-24 shrink-0">
                      <kbd className="rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-ink-200">
                        {'key' in trigger ? trigger.key : t(trigger.gesture)}
                      </kbd>
                    </dt>
                    <dd className="text-sm text-ink-300">{t(description)}</dd>
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
