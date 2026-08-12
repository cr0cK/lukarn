import { Fragment, type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';

/** What a menu entry displays: a label, an icon and an action. */
export interface MenuEntry {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  /**
   * Present when the entry is one choice among several — the language list.
   * The tick beside the active entry is visual only; this is what a screen
   * reader announces, and it also turns the group into a set of alternatives
   * rather than a series of independent actions.
   */
  checked?: boolean;
}

interface ActionMenuProps {
  /** Groups separated by a rule. Empty groups are ignored. */
  groupes: MenuEntry[][];
  /**
   * Non-clickable context lines at the top of the menu. The first stands out;
   * the following ones clarify it — an identifier, then its signing address.
   */
  entete?: string[];
  /** Accessible button name when several menus share a page. */
  label?: string | undefined;
  /** Button content. Three dots by default, an account badge when needed. */
  trigger?: ReactNode;
  /** Button styling: the bar and viewer have different backgrounds. */
  triggerClassName?: string;
}

const TRIGGER_PAR_DEFAUT =
  'rounded-lg p-2 text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100';

/**
 * Small-screen kebab menu shared by the top bar and viewer.
 *
 * One component rather than one per location: the important behaviour — close
 * on an outside click, close on `Escape` while restoring focus, close **before**
 * running the selected action — would be rewritten incorrectly the second time.
 *
 * Positioned as `absolute`, never `fixed`: both hosts have a `backdrop-blur` or
 * live in a stack of contexts, where `fixed` would relate to the filtered
 * ancestor rather than the viewport.
 */
export function ActionMenu({
  groupes,
  entete,
  label,
  trigger,
  triggerClassName = TRIGGER_PAR_DEFAUT,
}: ActionMenuProps): ReactElement {
  const t = useT();
  const nom = label ?? t('common.menu');
  const [ouvert, setOuvert] = useState(false);
  const zone = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const remplis = groupes.filter((groupe) => groupe.length > 0);

  useEffect(() => {
    if (!ouvert) return;

    const surPointeur = (event: PointerEvent): void => {
      if (!zone.current?.contains(event.target as Node)) setOuvert(false);
    };
    const surTouche = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // Stop propagation: in the viewer, `Escape` also closes the photo, and one
      // keypress must not do both.
      event.stopPropagation();
      setOuvert(false);
      // Restore focus to the button: closing from the keyboard must not send
      // navigation back to the top of the page.
      bouton.current?.focus();
    };

    document.addEventListener('pointerdown', surPointeur);
    // Capture so this runs before viewer shortcuts.
    document.addEventListener('keydown', surTouche, true);
    return () => {
      document.removeEventListener('pointerdown', surPointeur);
      document.removeEventListener('keydown', surTouche, true);
    };
  }, [ouvert]);

  return (
    <div ref={zone} className="relative shrink-0">
      <button
        ref={bouton}
        type="button"
        onClick={() => setOuvert((etat) => !etat)}
        className={triggerClassName}
        aria-label={nom}
        aria-haspopup="menu"
        aria-expanded={ouvert}
      >
        {trigger ?? (
          <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
            <circle cx="12" cy="5" r="1.75" />
            <circle cx="12" cy="12" r="1.75" />
            <circle cx="12" cy="19" r="1.75" />
          </svg>
        )}
      </button>

      {ouvert && (
        <div className="absolute top-full right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border border-ink-700 bg-ink-850 py-1 shadow-2xl">
          {/* Outside `role="menu"`, which accepts only `menuitem`: these lines
              cannot be selected. `title` is present because a slightly long
              address is truncated rather than widening the menu. */}
          {entete && entete.length > 0 && (
            <>
              <div className="px-4 py-2">
                {entete.map((ligne, rang) => (
                  <p
                    key={ligne}
                    title={ligne}
                    className={
                      rang === 0 ? 'truncate text-sm text-ink-200' : 'truncate text-xs text-ink-400'
                    }
                  >
                    {ligne}
                  </p>
                ))}
              </div>
              <div className="mb-1 h-px bg-ink-700" />
            </>
          )}

          <div role="menu">
            {remplis.map((groupe, rang) => (
              <Fragment key={groupe[0]!.label}>
                {rang > 0 && <div role="separator" className="my-1 h-px bg-ink-700" />}
                {groupe.map((entree) => (
                  <button
                    key={entree.label}
                    type="button"
                    role={entree.checked === undefined ? 'menuitem' : 'menuitemradio'}
                    aria-checked={entree.checked}
                    onClick={() => {
                      // Close first: `onSelect` may navigate or open a panel, and
                      // a menu left open would sit above what it just triggered.
                      setOuvert(false);
                      entree.onSelect();
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-200 transition-colors hover:bg-white/5 hover:text-ink-100"
                  >
                    <span className="shrink-0 text-ink-400">{entree.icon}</span>
                    {entree.label}
                  </button>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
