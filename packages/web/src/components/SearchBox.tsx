import { SEARCH_MIN_LENGTH, type SearchHit, type SearchHitKind } from '@lukarn/shared';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSearch } from '../api/hooks';
import { useT, type Translate } from '../lib/i18n';
import { dayLabel } from '../lib/justify';
import { useDebounced } from '../lib/useDebounced';
import { useShortcut } from '../lib/useShortcut';

/**
 * Searches the entire library from the top bar.
 *
 * It suggests **navigable entities** — an album, a day or a photo — rather than
 * text excerpts: "Marseille" opens the day in Marseille; it does not show the
 * line containing the word. This keeps three short groups instead of a results page.
 *
 * Combobox in the ARIA sense: focus never leaves the field and
 * `aria-activedescendant` identifies the list. Actually moving focus to options
 * would interrupt typing, defeating the purpose of suggestions.
 */

/** Result groups, in display order. Their heading is read from the catalogue. */
const GROUPES: { kind: SearchHitKind; titre: 'search.albums' | 'search.days' | 'search.photos' }[] =
  [
    { kind: 'album', titre: 'search.albums' },
    { kind: 'day', titre: 'search.days' },
    { kind: 'media', titre: 'search.photos' },
  ];

/** Where a result leads. */
function lienDe(hit: SearchHit): string {
  const base = `/album/${encodeURIComponent(hit.albumId)}`;
  // Include `group=day` with the day: when grouped by month, section keys look
  // like `2026-07` and the target day does not exist among them.
  if (hit.kind === 'day' && hit.day) {
    return `${base}?group=day&day=${encodeURIComponent(hit.day)}`;
  }
  if (hit.kind === 'media' && hit.mediaId) {
    return `${base}?photo=${encodeURIComponent(hit.mediaId)}`;
  }
  return base;
}

/**
 * The line beneath the label: context for the result. The album title appears
 * only when it is not already the label, and the date is formatted here like
 * every application date (`format.ts`, in UTC).
 */
function situationDe(hit: SearchHit, t: Translate): string | null {
  const parts = [
    ...(hit.kind === 'day' && hit.day ? [dayLabel(hit.day, t)] : []),
    ...(hit.kind === 'album' ? [] : [hit.albumTitle]),
    ...(hit.context ? [hit.context] : []),
  ];
  return parts.length > 0 ? parts.join(' · ') : null;
}

interface SearchBoxProps {
  /**
   * The `/` shortcut. Disabled while a panel covers the page: it would focus an
   * invisible field and swallow the next keystroke.
   */
  shortcutEnabled?: boolean;
  /**
   * `sheet` below `md`, where the field is the first row of a sheet rather than
   * a control in the top bar: results fill the sheet instead of hanging from the
   * field, and the keyboard is raised on arrival.
   */
  variant?: 'bar' | 'sheet';
  /** A result was chosen. The sheet closes on it; the bar has nothing to do. */
  onDone?: (() => void) | undefined;
}

export function SearchBox({
  shortcutEnabled = true,
  variant = 'bar',
  onDone,
}: SearchBoxProps): ReactElement {
  const inSheet = variant === 'sheet';
  const navigate = useNavigate();
  const t = useT();
  const [saisie, setSaisie] = useState('');
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState(0);
  const zone = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLInputElement>(null);

  const retardee = useDebounced(saisie.trim());
  const { data, isFetching } = useSearch(retardee);
  const hits = useMemo(() => data ?? [], [data]);

  // Not in the sheet: it opens with the field already focused, and there is no
  // keyboard on the screen that reaches it.
  useShortcut('/', () => champ.current?.focus(), shortcutEnabled && !inSheet);

  // Highlight the first result immediately: typing then pressing Enter is the
  // most common action, and requiring an arrow first would turn a shortcut
  // into a manoeuvre.
  useEffect(() => setActif(0), [hits]);

  useEffect(() => {
    if (!ouvert) return;
    const surPointeur = (event: PointerEvent): void => {
      if (!zone.current?.contains(event.target as Node)) setOuvert(false);
    };
    document.addEventListener('pointerdown', surPointeur);
    return () => document.removeEventListener('pointerdown', surPointeur);
  }, [ouvert]);

  const assezLong = retardee.length >= SEARCH_MIN_LENGTH;
  const deplie = ouvert && assezLong;

  const aller = (hit: SearchHit): void => {
    // Clear before navigating: the bar remains mounted between pages, and a list
    // left open would sit above the album it just opened.
    setSaisie('');
    setOuvert(false);
    champ.current?.blur();
    void navigate(lienDe(hit));
    onDone?.();
  };

  const surTouche = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      // The first `Escape` closes the list; the second clears the field. Closing
      // and clearing at once would lose a search meant only to be hidden while
      // looking at the page.
      //
      // Use `preventDefault` because Chrome clears `type="search"` on `Escape` by
      // itself: without it, the first keypress would perform both actions.
      event.preventDefault();
      event.stopPropagation();
      if (deplie) setOuvert(false);
      else {
        setSaisie('');
        champ.current?.blur();
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOuvert(true);
      if (hits.length === 0) return;
      const pas = event.key === 'ArrowDown' ? 1 : -1;
      setActif((rang) => (rang + pas + hits.length) % hits.length);
      return;
    }

    if (event.key === 'Enter') {
      const hit = hits[actif];
      if (!deplie || !hit) return;
      event.preventDefault();
      aller(hit);
    }
  };

  // Hide empty groups with their heading: "Photos" followed by nothing would
  // make people look for what is missing.
  const groupes = GROUPES.map((groupe) => ({
    ...groupe,
    entrees: hits
      .map((hit, rang) => ({ hit, rang }))
      .filter((entree) => entree.hit.kind === groupe.kind),
  })).filter((groupe) => groupe.entrees.length > 0);

  return (
    <div ref={zone} className={inSheet ? 'flex min-h-0 flex-1 flex-col' : 'relative'}>
      <div className={inSheet ? 'relative px-4 pb-3' : 'contents'}>
        <svg
          viewBox="0 0 24 24"
          className={`pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-ink-400 ${
            inSheet ? 'left-7' : 'left-2.5'
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>

        <input
          ref={champ}
          type="search"
          role="combobox"
          aria-label={t('search.label')}
          aria-expanded={deplie}
          aria-controls="recherche-resultats"
          aria-autocomplete="list"
          aria-activedescendant={deplie && hits[actif] ? `recherche-option-${actif}` : undefined}
          placeholder={t('search.placeholder')}
          // The sheet opens for this field and nothing else.
          autoFocus={inSheet}
          value={saisie}
          onChange={(event) => {
            setSaisie(event.target.value);
            setOuvert(true);
          }}
          onFocus={() => setOuvert(true)}
          onKeyDown={surTouche}
          // `[&::-webkit-search-cancel-button]:hidden`: WebKit draws the native
          // `type="search"` cross in a light colour, unreadable on a dark background.
          // Keep the `search` type for screen-reader announcements and mobile keyboards.
          className={`w-full rounded-lg border border-ink-700 bg-ink-850 pr-3 pl-8 text-ink-100 placeholder:text-ink-400 focus:border-ink-600 focus:outline-none [&::-webkit-search-cancel-button]:hidden ${
            // `text-base` in the sheet, never smaller: iOS zooms the whole page in
            // when a field below 16 px takes focus, and the layout never comes back
            // on its own. It also gives the 48 px target the bar does not need.
            inSheet ? 'py-3 text-base' : 'py-1.5 text-sm'
          }`}
        />
      </div>

      {deplie && (
        // In the bar, a panel hanging from the field: `absolute`, never `fixed`,
        // because the bar has a `backdrop-blur` and would become its containing
        // block — the same trap as `ActionMenu`. In the sheet there is nothing to
        // hang from: the results **are** the rest of the sheet, and they scroll
        // with it rather than inside a box of their own.
        <div
          className={
            inSheet
              ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-ink-800 py-1'
              : 'absolute top-full right-0 left-0 z-40 mt-2 max-h-[70vh] min-w-72 overflow-y-auto rounded-xl border border-ink-700 bg-ink-850 py-1 shadow-2xl'
          }
        >
          {/* Use `div` elements rather than lists: a `role="listbox"` owns only
              `option` and `group`, and the implicit `list` role of a nested `ul`
              would sit between them. */}
          <div id="recherche-resultats" role="listbox" aria-label={t('search.results')}>
            {groupes.map((groupe) => (
              <div key={groupe.kind} role="group" aria-label={t(groupe.titre)}>
                <p
                  aria-hidden="true"
                  className={`pt-2 pb-1 text-xs tracking-wide text-ink-400 uppercase ${
                    inSheet ? 'px-4' : 'px-3'
                  }`}
                >
                  {t(groupe.titre)}
                </p>
                {groupe.entrees.map(({ hit, rang }) => {
                  const situation = situationDe(hit, t);
                  return (
                    <div
                      key={`${hit.kind}-${hit.albumId}-${hit.day ?? hit.mediaId ?? ''}`}
                      id={`recherche-option-${rang}`}
                      role="option"
                      aria-selected={rang === actif}
                      // Use `pointerdown` rather than `click`: leaving the field
                      // drops its focus, and the outside-click listener would close
                      // the list before the click reached the option.
                      onPointerDown={(event) => {
                        event.preventDefault();
                        aller(hit);
                      }}
                      onMouseEnter={() => setActif(rang)}
                      // 48 px rows in the sheet, where a fingertip aims at them.
                      className={`cursor-pointer ${inSheet ? 'min-h-12 px-4 py-2.5' : 'px-3 py-2'} ${
                        rang === actif && !inSheet ? 'bg-white/10' : 'hover:bg-white/5'
                      }`}
                    >
                      <p className="truncate text-sm text-ink-100">{hit.label}</p>
                      {situation && <p className="truncate text-xs text-ink-400">{situation}</p>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* On the very first search, `data` is still empty without anything
              being absent — later searches retain the previous list
              (`keepPreviousData`). Announcing "no results" here would flash a
              false statement between two characters. */}
          {hits.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-ink-400">
              {t(isFetching ? 'search.searching' : 'search.empty')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
