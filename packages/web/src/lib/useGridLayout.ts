import { DEFAULT_GROUP_BY, type AlbumDay, type GroupBy, type MediaItem } from '@nonni/shared';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { computeLayout, targetRowHeightFor, type Layout } from './justify';
import { measureLines } from './measureLines';

export const GRID_GAP = 4;
export const GRID_SECTION_GAP = 28;

/**
 * Retrait au-dessus du titre d'une section. **Invariant, replié ou non.**
 *
 * C'est lui qui fixe l'ordonnée du titre : `section.y + GRID_HEADER_PAD_TOP`.
 * Le contenu de l'en-tête est donc aligné **en haut** de sa boîte, et la
 * hauteur variable se consomme en bas. Aligné en bas, comme il l'était,
 * réduire la boîte au repli faisait remonter le titre de la différence — le
 * libellé sautait sous le curseur à chaque clic, ce qui est exactement ce
 * qu'un bouton de repli ne doit pas faire.
 */
export const GRID_HEADER_PAD_TOP = 20;
/** Ligne du titre. Le composant la tient par `leading-6`. */
export const GRID_HEADER_TITLE_HEIGHT = 24;
/** Respiration entre l'en-tête et les vignettes de sa propre section. */
export const GRID_HEADER_PAD_BOTTOM = 12;

export const GRID_HEADER_HEIGHT =
  GRID_HEADER_PAD_TOP + GRID_HEADER_TITLE_HEIGHT + GRID_HEADER_PAD_BOTTOM;
/**
 * En-tête d'une section repliée : le même retrait en haut, le même titre, mais
 * plus rien en bas — il n'y a plus de vignettes dont le séparer.
 */
export const GRID_COLLAPSED_HEADER_HEIGHT = GRID_HEADER_PAD_TOP + GRID_HEADER_TITLE_HEIGHT;

/**
 * Ce que coûte une ligne de plus dans un en-tête de section : le lieu, la note.
 *
 * C'est un contrat avec `SectionHeader`, qui doit tenir dedans — le layout est
 * calculé sans DOM, donc rien ne rattrapera un dépassement et les photos de la
 * section passeraient sous le texte. D'où l'interligne fixé explicitement côté
 * composant (`leading-5`) : c'est lui qui tient le contrat, jamais la taille de
 * police.
 *
 * Une constante et non deux — le lieu et la note se comptent en lignes de même
 * hauteur — et une réservation qui vaut exactement ce qui sera rendu : le lieu
 * tient sur une ligne tronquée, la note sur le nombre de lignes que
 * `measureLines` lui a mesuré (D85, D93).
 */
export const GRID_HEADER_LINE_HEIGHT = 20;

/**
 * Classes du paragraphe de la note, partagées avec la sonde de mesure.
 *
 * Elles sont **la** définition de sa géométrie : la largeur maximale, le retrait
 * qui l'aligne sur le texte du titre, la taille de police, l'interligne, la
 * césure et le traitement des retours à la ligne. Mesurer avec d'autres classes
 * que celles du rendu ferait diverger la hauteur réservée de la hauteur rendue,
 * ce que rien ne rattraperait. La couleur reste au composant : elle ne change
 * aucune métrique.
 *
 * `whitespace-pre-line` conserve les retours à la ligne saisis, comme le
 * bandeau de la visionneuse et la description d'album le font déjà de la même
 * note : sans lui, un texte écrit en trois lignes s'affichait ici en une seule
 * phrase, et le même contenu se lisait différemment selon l'écran où on
 * l'ouvrait.
 */
export const GRID_HEADER_NOTE_CLASS =
  'max-w-3xl pl-[22px] text-sm leading-5 break-words whitespace-pre-line';

/**
 * Hauteur d'un en-tête de section, à réserver comme à rendre.
 *
 * Pure et exportée pour être vérifiable : c'est l'invariant dont dépend
 * l'absence de recouvrement entre un en-tête et ses vignettes.
 */
export function sectionHeaderHeight(options: {
  collapsed: boolean;
  hasPlace: boolean;
  /** Lignes occupées par la note. `0` quand la journée n'en porte pas. */
  descriptionLines: number;
}): number {
  const base = options.collapsed ? GRID_COLLAPSED_HEADER_HEIGHT : GRID_HEADER_HEIGHT;
  const lines = (options.hasPlace ? 1 : 0) + options.descriptionLines;
  return base + lines * GRID_HEADER_LINE_HEIGHT;
}
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
  /**
   * Lignes occupées par la note de chaque journée, par clé de section.
   *
   * Portées par le layout et non recalculées au rendu : la hauteur réservée et
   * la boîte rendue doivent tenir du **même** nombre, mesuré une fois. Deux
   * calculs, fût-ce avec la même fonction, sont deux occasions de diverger.
   */
  descriptionLines: ReadonlyMap<string, number>;
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

  // Les notes n'ont de sens que par jour : accrocher une note de journée à un
  // en-tête de mois choisirait arbitrairement laquelle des trente afficher.
  const annotatedDays = groupBy === 'day' && days && days.size > 0 ? days : undefined;

  /**
   * Mesuré ici, une fois par largeur, et non au rendu de chaque en-tête : c'est
   * ce même nombre qui réserve la hauteur et qui borne la boîte, et la mesure
   * force un calcul de style que la virtualisation rejouerait à chaque
   * défilement.
   */
  const descriptionLines = useMemo(() => {
    const lines = new Map<string, number>();
    if (!annotatedDays || width <= 0) return lines;
    for (const [key, day] of annotatedDays) {
      if (!day.description) continue;
      lines.set(
        key,
        measureLines(day.description, width, GRID_HEADER_NOTE_CLASS, GRID_HEADER_LINE_HEIGHT),
      );
    }
    return lines;
  }, [annotatedDays, width]);

  const headerHeightFor = useMemo(() => {
    // Le repli vaut pour les deux découpages. L'un ou l'autre suffit à faire
    // varier une hauteur.
    const collapses = collapsedKeys && collapsedKeys.size > 0;
    if (!annotatedDays && !collapses) return undefined;

    return (key: string): number =>
      sectionHeaderHeight({
        collapsed: collapsedKeys?.has(key) ?? false,
        hasPlace: placeLabelOf(annotatedDays?.get(key)) !== null,
        descriptionLines: descriptionLines.get(key) ?? 0,
      });
  }, [annotatedDays, collapsedKeys, descriptionLines]);

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
    descriptionLines,
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
