import { DEFAULT_GROUP_BY, type AlbumDay, type GroupBy, type MediaItem } from '@gdv/shared';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { computeLayout, targetRowHeightFor, type Layout } from './justify';

export const GRID_GAP = 4;
export const GRID_HEADER_HEIGHT = 56;
export const GRID_SECTION_GAP = 28;
/**
 * En-tête d'une section repliée : juste sa ligne de titre.
 *
 * `GRID_HEADER_HEIGHT` réserve une trentaine de pixels au-dessus du titre pour
 * le décoller des photos de la section précédente. Repliée, la section n'a plus
 * de photos, et cette respiration devient un vide : un album entièrement replié
 * s'étirait sur des blancs qui lui ôtaient tout son intérêt de sommaire.
 */
export const GRID_COLLAPSED_HEADER_HEIGHT = 36;

/**
 * Ce que coûte un lieu, puis une note, dans un en-tête de section. Ces deux
 * valeurs sont un contrat avec `SectionHeader`, qui doit tenir dedans : le
 * layout est calculé sans DOM, donc rien ne rattrapera un dépassement — les
 * photos de la section suivante passeraient dessous. D'où les hauteurs de ligne
 * fixées explicitement côté composant (`leading-5`), et la note clampée à deux
 * lignes.
 */
export const GRID_PLACE_HEIGHT = 20;
export const GRID_DESCRIPTION_HEIGHT = 40;
/** Marge de lignes rendues hors viewport, pour que le défilement rapide reste plein. */
const OVERSCAN_PX = 900;

export interface GridLayout {
  /**
   * Callback ref, et non `useRef` : le conteneur n'est monté qu'une fois les
   * médias chargés, donc un effet à dépendances vides s'exécuterait alors que
   * `ref.current` vaut encore `null` et n'observerait jamais rien.
   */
  ref: (node: HTMLDivElement | null) => void;
  layout: Layout;
  /** Bornes verticales à rendre, dans le repère du layout. */
  visibleFrom: number;
  visibleTo: number;
  viewportHeight: number;
  /** Décalage du conteneur dans la page, pour convertir layout ↔ scroll. */
  offsetTop: number;
}

/**
 * Le lieu affiché pour une journée : celui qu'on a saisi s'il y en a un, sinon
 * ceux que l'EXIF a livrés, dans l'ordre du déroulé.
 *
 * Exporté parce que la hauteur d'en-tête et le rendu doivent en décider
 * exactement pareil : un lieu compté ici et pas affiché là laisserait un blanc,
 * l'inverse ferait déborder l'en-tête sur les photos.
 */
export function placeLabelOf(day: AlbumDay | undefined): string | null {
  if (!day) return null;
  if (day.place) return day.place;
  return day.autoPlaces.length > 0 ? day.autoPlaces.join(' · ') : null;
}

/**
 * Mesure le conteneur, suit le défilement et calcule le layout justifié.
 *
 * Le layout est extrait de la grille parce que la page en a besoin elle aussi :
 * la navigation clavier se déplace de ligne en ligne, et seules les positions
 * calculées ici disent quelles vignettes sont voisines à l'écran.
 *
 * `days` n'est consulté qu'en découpage par jour : une note appartient à une
 * journée, et l'accrocher à un en-tête de mois choisirait arbitrairement
 * laquelle des trente afficher.
 *
 * `collapsedKeys` porte les sections repliées. Il vaut pour les deux
 * découpages : leurs clés n'ont pas la même forme (`2026-07` contre
 * `2026-07-14`), elles ne peuvent pas se confondre dans le même ensemble.
 */
export function useGridLayout(
  items: MediaItem[],
  groupBy: GroupBy = DEFAULT_GROUP_BY,
  days?: Map<string, AlbumDay>,
  collapsedKeys?: ReadonlySet<string>,
): GridLayout {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [offsetTop, setOffsetTop] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });

  const ref = useCallback((node: HTMLDivElement | null) => setElement(node), []);

  useLayoutEffect(() => {
    if (!element) return;

    const measure = (): void => {
      const rect = element.getBoundingClientRect();
      setWidth(rect.width);
      setOffsetTop(rect.top + window.scrollY);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [element]);

  useEffect(() => {
    const update = (): void => setViewport({ top: window.scrollY, height: window.innerHeight });
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  const headerHeightFor = useMemo(() => {
    // Les notes n'ont de sens que par jour ; le repli vaut pour les deux
    // découpages. L'un ou l'autre suffit à faire varier une hauteur.
    const annotated = groupBy === 'day' && days && days.size > 0 ? days : undefined;
    const collapses = collapsedKeys && collapsedKeys.size > 0;
    if (!annotated && !collapses) return undefined;

    return (key: string): number => {
      const day = annotated?.get(key);
      const base = collapsedKeys?.has(key) ? GRID_COLLAPSED_HEADER_HEIGHT : GRID_HEADER_HEIGHT;
      return (
        base +
        (placeLabelOf(day) ? GRID_PLACE_HEIGHT : 0) +
        (day?.description ? GRID_DESCRIPTION_HEIGHT : 0)
      );
    };
  }, [groupBy, days, collapsedKeys]);

  // `undefined` tant que rien n'est replié — le cas de très loin le plus
  // fréquent — pour que le layout ne se recalcule pas sur une fonction neuve à
  // chaque rendu.
  const isCollapsed = useMemo(() => {
    if (!collapsedKeys || collapsedKeys.size === 0) return undefined;
    return (key: string): boolean => collapsedKeys.has(key);
  }, [collapsedKeys]);

  const layout = useMemo(
    () =>
      computeLayout(items, {
        containerWidth: width,
        targetRowHeight: targetRowHeightFor(width),
        gap: GRID_GAP,
        headerHeight: GRID_HEADER_HEIGHT,
        headerHeightFor,
        sectionGap: GRID_SECTION_GAP,
        groupBy,
        isCollapsed,
      }),
    [items, width, groupBy, headerHeightFor, isCollapsed],
  );

  return {
    ref,
    layout,
    visibleFrom: viewport.top - offsetTop - OVERSCAN_PX,
    visibleTo: viewport.top - offsetTop + viewport.height + OVERSCAN_PX,
    viewportHeight: viewport.height,
    offsetTop,
  };
}

/**
 * Navigation clavier dans la grille. Les déplacements verticaux suivent les
 * lignes réelles du layout — dont le nombre de vignettes varie — et visent la
 * photo la plus proche horizontalement, là où un décalage d'index fixe ferait
 * dériver le curseur vers la gauche à chaque ligne.
 *
 * **Tout se joue dans l'espace des cellules placées, jamais dans celui des
 * index de la liste d'origine.** Les deux coïncidaient tant que la grille
 * montrait tout ; une section repliée les sépare. Un `currentIndex ± 1` y
 * enverrait la sélection sur une vignette qui n'est nulle part dans le layout :
 * plus rien à mettre en évidence, et `scrollSelectionIntoView` sans cible.
 */
export function moveSelection(
  layout: Layout,
  currentIndex: number,
  direction: 'left' | 'right' | 'up' | 'down' | 'home' | 'end',
): number {
  // `layout.rows` est déjà dans l'ordre d'affichage, sections comprises.
  const cells = layout.rows.flatMap((row) => row.cells);
  if (cells.length === 0) return -1;

  switch (direction) {
    case 'home':
      return cells[0]!.index;
    case 'end':
      return cells[cells.length - 1]!.index;
    default:
      break;
  }

  const position = cells.findIndex((cell) => cell.index === currentIndex);
  // Aucune sélection, ou une sélection que le repli de sa journée vient de
  // faire disparaître : on repart de la première vignette encore visible.
  if (position === -1) return cells[0]!.index;

  if (direction === 'left') return cells[Math.max(0, position - 1)]!.index;
  if (direction === 'right') return cells[Math.min(cells.length - 1, position + 1)]!.index;

  const rowIndex = layout.rows.findIndex((row) =>
    row.cells.some((cell) => cell.index === currentIndex),
  );
  if (rowIndex === -1) return currentIndex;

  const targetRow = layout.rows[rowIndex + (direction === 'down' ? 1 : -1)];
  if (!targetRow || targetRow.cells.length === 0) return currentIndex;

  const current = layout.rows[rowIndex]!.cells.find((cell) => cell.index === currentIndex)!;
  const currentCenter = current.x + current.width / 2;

  let best = targetRow.cells[0]!;
  let bestDistance = Infinity;
  for (const cell of targetRow.cells) {
    const distance = Math.abs(cell.x + cell.width / 2 - currentCenter);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cell;
    }
  }
  return best.index;
}

/** Fait défiler la page pour amener la vignette sélectionnée dans le viewport. */
export function scrollSelectionIntoView(
  layout: Layout,
  offsetTop: number,
  selectedIndex: number,
): void {
  if (selectedIndex < 0) return;

  const cell = layout.rows.flatMap((row) => row.cells).find((c) => c.index === selectedIndex);
  if (!cell) return;

  const top = offsetTop + cell.y;
  const bottom = top + cell.height;
  const margin = 24;
  const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';

  if (top < window.scrollY + margin) {
    window.scrollTo({ top: top - margin, behavior });
  } else if (bottom > window.scrollY + window.innerHeight - margin) {
    window.scrollTo({ top: bottom - window.innerHeight + margin, behavior });
  }
}
