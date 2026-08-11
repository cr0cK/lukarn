import { SEARCH_MIN_LENGTH, type SearchHit, type SearchHitKind } from '@nonni/shared';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSearch } from '../api/hooks';
import { dayLabel } from '../lib/justify';
import { useDebounced } from '../lib/useDebounced';
import { useShortcut } from '../lib/useShortcut';

/**
 * Recherche dans toute la bibliothèque, depuis la barre supérieure.
 *
 * Ce qu'elle suggère sont des **entités navigables** — un album, une journée,
 * une photo — et non des extraits de texte : « Marseille » ouvre la journée à
 * Marseille, il ne montre pas la ligne où le mot apparaît. C'est ce qui permet
 * de garder trois groupes courts plutôt qu'une page de résultats.
 *
 * Combobox au sens ARIA : le focus ne quitte jamais le champ, la liste est
 * désignée par `aria-activedescendant`. Déplacer réellement le focus sur les
 * options couperait la frappe, qui est tout l'intérêt d'une suggestion.
 */

const GROUPES: { kind: SearchHitKind; titre: string }[] = [
  { kind: 'album', titre: 'Albums' },
  { kind: 'day', titre: 'Days and places' },
  { kind: 'media', titre: 'Photos' },
];

/** Où mène un résultat. */
function lienDe(hit: SearchHit): string {
  const base = `/album/${encodeURIComponent(hit.albumId)}`;
  // `group=day` avec la journée : en découpage par mois, les clés de section
  // valent `2026-07` et la journée visée n'y existe pas.
  if (hit.kind === 'day' && hit.day) {
    return `${base}?group=day&day=${encodeURIComponent(hit.day)}`;
  }
  if (hit.kind === 'media' && hit.mediaId) {
    return `${base}?photo=${encodeURIComponent(hit.mediaId)}`;
  }
  return base;
}

/**
 * La ligne sous le libellé : ce qui situe le résultat. Le titre de l'album n'y
 * figure que là où il n'est pas déjà le libellé, et la date est mise en forme
 * ici, comme toutes les dates de l'application (`format.ts`, en UTC).
 */
function situationDe(hit: SearchHit): string | null {
  const parts = [
    ...(hit.kind === 'day' && hit.day ? [dayLabel(hit.day)] : []),
    ...(hit.kind === 'album' ? [] : [hit.albumTitle]),
    ...(hit.context ? [hit.context] : []),
  ];
  return parts.length > 0 ? parts.join(' · ') : null;
}

interface SearchBoxProps {
  /**
   * Le raccourci `/`. Coupé quand un panneau recouvre la page : il focaliserait
   * un champ que personne ne voit, et la frappe suivante disparaîtrait dedans.
   */
  shortcutEnabled?: boolean;
}

export function SearchBox({ shortcutEnabled = true }: SearchBoxProps): ReactElement {
  const navigate = useNavigate();
  const [saisie, setSaisie] = useState('');
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState(0);
  const zone = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLInputElement>(null);

  const retardee = useDebounced(saisie.trim());
  const { data, isFetching } = useSearch(retardee);
  const hits = useMemo(() => data ?? [], [data]);

  useShortcut('/', () => champ.current?.focus(), shortcutEnabled);

  // Le premier résultat est mis en évidence d'emblée : taper puis appuyer sur
  // Entrée est le geste le plus fréquent, et exiger une flèche d'abord ferait
  // d'un raccourci une manœuvre.
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
    // Vider avant de naviguer : la barre reste montée d'une page à l'autre, et
    // une liste laissée ouverte se retrouverait par-dessus l'album qu'elle
    // vient d'ouvrir.
    setSaisie('');
    setOuvert(false);
    champ.current?.blur();
    void navigate(lienDe(hit));
  };

  const surTouche = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      // Le premier `Échap` referme la liste, le second vide le champ : fermer et
      // effacer d'un coup fait perdre une recherche qu'on voulait seulement
      // masquer le temps de regarder la page.
      //
      // `preventDefault` parce que Chrome vide de lui-même un `type="search"` à
      // `Échap` : sans lui, le premier appui ferait les deux gestes à la fois.
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

  // Les groupes vides disparaissent avec leur titre : « Photos » suivi de rien
  // ferait chercher ce qui manque.
  const groupes = GROUPES.map((groupe) => ({
    ...groupe,
    entrees: hits
      .map((hit, rang) => ({ hit, rang }))
      .filter((entree) => entree.hit.kind === groupe.kind),
  })).filter((groupe) => groupe.entrees.length > 0);

  return (
    <div ref={zone} className="relative">
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-400"
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
        aria-label="Search"
        aria-expanded={deplie}
        aria-controls="recherche-resultats"
        aria-autocomplete="list"
        aria-activedescendant={deplie && hits[actif] ? `recherche-option-${actif}` : undefined}
        placeholder="Search…"
        value={saisie}
        onChange={(event) => {
          setSaisie(event.target.value);
          setOuvert(true);
        }}
        onFocus={() => setOuvert(true)}
        onKeyDown={surTouche}
        // `[&::-webkit-search-cancel-button]:hidden` : la croix native de
        // `type="search"` est dessinée en clair par WebKit, illisible sur un
        // fond sombre. Le type reste `search` pour l'annonce des lecteurs
        // d'écran et le clavier des mobiles.
        className="w-full rounded-lg border border-ink-700 bg-ink-850 py-1.5 pr-3 pl-8 text-sm text-ink-100 placeholder:text-ink-400 focus:border-ink-600 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />

      {deplie && (
        // `absolute` et non `fixed` : la barre porte un `backdrop-blur`, qui en
        // fait le bloc conteneur d'un élément fixé — même piège qu'`ActionMenu`.
        <div className="absolute top-full right-0 left-0 z-40 mt-2 max-h-[70vh] min-w-72 overflow-y-auto rounded-xl border border-ink-700 bg-ink-850 py-1 shadow-2xl">
          {/* Des `div` et non des listes : un `role="listbox"` ne possède que
              des `option` et des `group`, et le rôle `list` implicite d'un `ul`
              imbriqué s'interposerait entre les deux. */}
          <div id="recherche-resultats" role="listbox" aria-label="Search results">
            {groupes.map((groupe) => (
              <div key={groupe.kind} role="group" aria-label={groupe.titre}>
                <p
                  aria-hidden="true"
                  className="px-3 pt-2 pb-1 text-xs tracking-wide text-ink-400 uppercase"
                >
                  {groupe.titre}
                </p>
                {groupe.entrees.map(({ hit, rang }) => {
                  const situation = situationDe(hit);
                  return (
                    <div
                      key={`${hit.kind}-${hit.albumId}-${hit.day ?? hit.mediaId ?? ''}`}
                      id={`recherche-option-${rang}`}
                      role="option"
                      aria-selected={rang === actif}
                      // `pointerdown` plutôt que `click` : le pointeur sortant du
                      // champ lui fait perdre le focus, et l'écouteur « clic
                      // dehors » refermerait la liste avant que le clic n'atteigne
                      // l'option.
                      onPointerDown={(event) => {
                        event.preventDefault();
                        aller(hit);
                      }}
                      onMouseEnter={() => setActif(rang)}
                      className={`cursor-pointer px-3 py-2 ${
                        rang === actif ? 'bg-white/10' : 'hover:bg-white/5'
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

          {/* Sur la toute première recherche, `data` est encore vide sans que
              rien ne manque — les suivantes gardent la liste précédente
              (`keepPreviousData`). Annoncer « aucun résultat » là ferait
              clignoter un constat faux entre deux caractères. */}
          {hits.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-ink-400">
              {isFetching ? 'Searching…' : 'No result'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
