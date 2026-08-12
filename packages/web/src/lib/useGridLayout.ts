import { DEFAULT_GROUP_BY, type AlbumDay, type GroupBy, type MediaItem } from '@lukarn/shared';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useT } from './i18n';
import { computeLayout, targetRowHeightFor, type Layout } from './justify';
import { measureLines } from './measureLines';

export const GRID_GAP = 4;
export const GRID_SECTION_GAP = 28;

/**
 * Space above a section title. **Invariant, collapsed or not.**
 *
 * It fixes the title coordinate: `section.y + GRID_HEADER_PAD_TOP`. Header
 * content therefore aligns **at the top** of its box, consuming variable height
 * below. With the former bottom alignment, shrinking the box on collapse raised
 * the title by the difference — the label jumped beneath the pointer on every
 * click, exactly what a collapse button must not do.
 */
export const GRID_HEADER_PAD_TOP = 20;
/** Title line. The component holds it with `leading-6`. */
export const GRID_HEADER_TITLE_HEIGHT = 24;
/** Space between a header and its own section's thumbnails. */
export const GRID_HEADER_PAD_BOTTOM = 12;

export const GRID_HEADER_HEIGHT =
  GRID_HEADER_PAD_TOP + GRID_HEADER_TITLE_HEIGHT + GRID_HEADER_PAD_BOTTOM;
/**
 * Collapsed section header: same top padding and title, but nothing below — no
 * thumbnails remain to separate from it.
 */
export const GRID_COLLAPSED_HEADER_HEIGHT = GRID_HEADER_PAD_TOP + GRID_HEADER_TITLE_HEIGHT;

/**
 * Cost of one more line in a section header: place or note.
 *
 * This is a contract with `SectionHeader`, which must fit — layout is computed
 * without the DOM, so nothing recovers overflow and section photos would pass
 * beneath the text. Hence the explicit component line height (`leading-5`): it
 * fulfils the contract, never the font size.
 *
 * One constant rather than two — place and note use equal-height lines — and a
 * reservation exactly matching rendering: place fits one truncated line, while
 * note uses the count measured by `measureLines` (D85, D93).
 */
export const GRID_HEADER_LINE_HEIGHT = 20;

/**
 * Note paragraph classes shared with the measurement probe.
 *
 * They are **the** definition of its geometry: maximum width, indentation aligning
 * it with title text, font size, line height, wrapping and line-break handling.
 * Measuring with classes other than the rendered ones would make reserved and
 * rendered heights diverge without recovery. Colour remains in the component
 * because it changes no metric.
 *
 * `whitespace-pre-line` preserves entered line breaks, as the viewer bar and
 * album description already do for the same note: without it, text written in
 * three lines appeared here as one sentence and read differently by screen.
 */
export const GRID_HEADER_NOTE_CLASS =
  'max-w-3xl pl-[22px] text-sm leading-5 break-words whitespace-pre-line';

/**
 * Section header height to reserve and render.
 *
 * Pure and exported for verification: this invariant prevents overlap between a
 * header and its thumbnails.
 */
export function sectionHeaderHeight(options: {
  collapsed: boolean;
  hasPlace: boolean;
  /** Lines occupied by the note. `0` when the day has none. */
  descriptionLines: number;
}): number {
  const base = options.collapsed ? GRID_COLLAPSED_HEADER_HEIGHT : GRID_HEADER_HEIGHT;
  const lines = (options.hasPlace ? 1 : 0) + options.descriptionLines;
  return base + lines * GRID_HEADER_LINE_HEIGHT;
}
/** Margin of rows rendered outside the viewport so fast scrolling stays filled. */
const OVERSCAN_PX = 900;

export interface GridLayout {
  /**
   * Callback ref rather than `useRef`: the container mounts only after media
   * load, so an effect with empty dependencies would run while `ref.current` was
   * still `null` and never observe anything.
   */
  ref: (node: HTMLDivElement | null) => void;
  layout: Layout;
  /** Vertical bounds to render in layout coordinates. */
  visibleFrom: number;
  visibleTo: number;
  viewportHeight: number;
  /** Container offset in the page for converting layout ↔ scroll. */
  offsetTop: number;
  /**
   * Lines occupied by each day note, by section key.
   *
   * Carried by layout rather than recomputed during rendering: reserved height
   * and rendered box must use the **same** number measured once. Two calculations,
   * even with the same function, are two chances to diverge.
   */
  descriptionLines: ReadonlyMap<string, number>;
}

/**
 * Place displayed for a day: the manually entered one when present, otherwise
 * those supplied by EXIF in sequence order.
 *
 * Exported because header height and rendering must decide identically: a place
 * counted here but not displayed leaves a gap; the reverse overflows onto photos.
 */
export function placeLabelOf(day: AlbumDay | undefined): string | null {
  if (!day) return null;
  if (day.place) return day.place;
  return day.autoPlaces.length > 0 ? day.autoPlaces.join(' · ') : null;
}

/**
 * Measures the container, follows scrolling and computes the justified layout.
 *
 * Layout is extracted from the grid because the page also needs it: keyboard
 * navigation moves row by row, and only positions computed here identify
 * on-screen neighbours.
 *
 * Consult `days` only when grouping by day: a note belongs to a day, and attaching
 * it to a month heading would arbitrarily choose one of thirty.
 *
 * `collapsedKeys` carries collapsed sections for both groupings: their keys have
 * different forms (`2026-07` versus `2026-07-14`) and cannot collide in one set.
 */
export function useGridLayout(
  items: MediaItem[],
  groupBy: GroupBy = DEFAULT_GROUP_BY,
  days?: Map<string, AlbumDay>,
  collapsedKeys?: ReadonlySet<string>,
): GridLayout {
  const t = useT();
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

  // Notes make sense only by day: attaching a day note to a month heading would
  // arbitrarily choose one of thirty.
  const annotatedDays = groupBy === 'day' && days && days.size > 0 ? days : undefined;

  /**
   * Measure here once per width, not while rendering each header: the same number
   * reserves height and bounds the box, and measurement forces a style calculation
   * that virtualisation would repeat on every scroll.
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
    // Collapse applies to both groupings. Either one can change a height.
    const collapses = collapsedKeys && collapsedKeys.size > 0;
    if (!annotatedDays && !collapses) return undefined;

    return (key: string): number =>
      sectionHeaderHeight({
        collapsed: collapsedKeys?.has(key) ?? false,
        hasPlace: placeLabelOf(annotatedDays?.get(key)) !== null,
        descriptionLines: descriptionLines.get(key) ?? 0,
      });
  }, [annotatedDays, collapsedKeys, descriptionLines]);

  // Keep `undefined` while nothing is collapsed — by far the common case — so
  // layout does not recompute from a new function on every render.
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
        t,
      }),
    [items, width, groupBy, headerHeightFor, isCollapsed, t],
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
 * Keyboard navigation in the grid. Vertical movement follows actual layout rows
 * — whose thumbnail count varies — and targets the horizontally nearest photo,
 * where a fixed index offset would drift the cursor left on every row.
 *
 * **Everything operates in placed-cell space, never original-list index space.**
 * They coincide while the grid shows everything; a collapsed section separates
 * them. `currentIndex ± 1` would select a thumbnail absent from the layout,
 * leaving nothing to highlight and `scrollSelectionIntoView` without a target.
 */
export function moveSelection(
  layout: Layout,
  currentIndex: number,
  direction: 'left' | 'right' | 'up' | 'down' | 'home' | 'end',
): number {
  // `layout.rows` is already in display order, including sections.
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
  // With no selection, or one just hidden by collapsing its day, restart from the
  // first visible thumbnail.
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

/** Scrolls the page to bring the selected thumbnail into the viewport. */
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
