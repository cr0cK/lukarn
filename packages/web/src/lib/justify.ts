import { DEFAULT_GROUP_BY, type GroupBy, type MediaItem } from '@lukarn/shared';
import { formatDate } from './format';

/**
 * Computes the grid's "justified" layout: variable-height rows whose images
 * preserve their proportions and exactly fill the available width — the Google
 * Photos arrangement.
 *
 * Everything uses already known dimensions from the server index, without
 * loading any image: the grid can be positioned and virtualised before any
 * download, and scrolling causes no layout shift.
 */

export interface LayoutOptions {
  containerWidth: number;
  /** Target row height. Rows deviate from it to fit exactly. */
  targetRowHeight: number;
  gap: number;
  /** Section header height when nothing varies it. */
  headerHeight: number;
  /**
   * Header height for a given section when it contains more than its label — a
   * place or note. When omitted or returning null, `headerHeight` applies.
   *
   * Height is **an input to the calculation**, never a measurement: the entire
   * layout is computed before any DOM node exists, enabling virtualisation and
   * the absence of shifts.
   */
  headerHeightFor?: (key: string) => number;
  /** Margin beneath each section. */
  sectionGap: number;
  /** Section grouping. Omitted means month — the shared default. */
  groupBy?: GroupBy;
  /**
   * Collapsed sections keep their header and lose their rows.
   *
   * Collapse goes through layout calculation rather than render-side
   * `display: none` for the same reason as header heights: the scrollbar and
   * virtualisation read `totalHeight`. Hiding thumbnails afterwards would leave
   * the page as tall as everything it no longer displays.
   */
  isCollapsed?: (key: string) => boolean;
}

export interface LayoutCell {
  item: MediaItem;
  /** Index in the original list, used by keyboard navigation and the viewer. */
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutRow {
  y: number;
  height: number;
  cells: LayoutCell[];
}

export interface LayoutSection {
  key: string;
  label: string;
  /** Header position; rows begin at `y + headerHeight`. */
  y: number;
  /** Height reserved for the header. The component sizes its box to it. */
  headerHeight: number;
  height: number;
  rows: LayoutRow[];
  /**
   * Number of media in the section.
   *
   * Carried by the section rather than recounted from `rows`: a collapsed section
   * has no rows, precisely when its header needs to announce what it hides.
   */
  count: number;
  /** Collapsed: `rows` is empty and `height` equals `headerHeight`. */
  collapsed: boolean;
}

export interface Layout {
  sections: LayoutSection[];
  totalHeight: number;
  /** Every row across all sections in display order. */
  rows: LayoutRow[];
}

/** Fallback aspect ratio when the server lacks file dimensions. */
const FALLBACK_RATIO = 4 / 3;
/** An extremely wide image would distort its whole row, so cap it. */
const MAX_RATIO = 3.5;
const MIN_RATIO = 0.4;

function ratioOf(item: MediaItem): number {
  if (!item.width || !item.height) return FALLBACK_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, item.width / item.height));
}

/**
 * `YYYY-MM` grouping key based on capture date in UTC.
 *
 * Slicing the ISO string rather than using `Date` preserves UTC grouping:
 * `getMonth()` changes month for a photo from the 31st at 23:00 viewed in Paris,
 * although `taken_at` is already camera time.
 */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** `YYYY-MM-DD` grouping key in UTC for the same reason as `monthKey`. */
export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export function monthLabel(key: string, locale = 'en-GB'): string {
  const [year, month] = key.split('-');
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  const label = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Day of an instant on the viewer's clock, as `YYYY-MM-DD`.
 *
 * Deliberately use the **local** calendar rather than UTC day, unlike everything
 * else: `taken_at` is the time shown by the camera, the same wall clock as the
 * browser. Comparing with UTC would deny "Today" during an ongoing afternoon in
 * Montreal and grant it in Auckland before the day began.
 *
 * Also groups the moderation queue for a related reason: a comment date is a real
 * instant, not wall time (see `format.ts`).
 */
export function localDayKey(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Calendar day before `key`, as `YYYY-MM-DD`. */
function previousDayKey(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! - 1));
  return date.toISOString().slice(0, 10);
}

/**
 * Day-section label: "14 July 2026", or a relative marker for the two latest days.
 *
 * Full dates are unreadable in series — twenty headings differing only by the
 * day require reading every number. "Today" and "Yesterday" are recognised at a
 * glance; beyond that, a relative marker ("5 days ago") takes more mental work
 * than the date itself.
 *
 * `today` is injectable so tests do not depend on the current date.
 */
export function dayLabel(key: string, today = localDayKey(new Date())): string {
  if (key === today) return 'Today';
  if (key === previousDayKey(today)) return 'Yesterday';
  // Use noon, not midnight: a day key is only a calendar date, and if a
  // `format.ts` formatter ever stopped using UTC, midnight would change day in
  // half the time zones — noon changes in none.
  return formatDate(`${key}T12:00:00.000Z`);
}

/** Section key for media according to the requested grouping. */
export function sectionKeyOf(iso: string, groupBy: GroupBy): string {
  return groupBy === 'day' ? dayKey(iso) : monthKey(iso);
}

/** Header displayed for a section key according to the requested grouping. */
export function sectionLabelOf(key: string, groupBy: GroupBy): string {
  return groupBy === 'day' ? dayLabel(key) : monthLabel(key);
}

export function computeLayout(items: MediaItem[], options: LayoutOptions): Layout {
  const {
    containerWidth,
    targetRowHeight,
    gap,
    headerHeight,
    headerHeightFor,
    sectionGap,
    groupBy = DEFAULT_GROUP_BY,
    isCollapsed,
  } = options;

  if (containerWidth <= 0 || items.length === 0) {
    return { sections: [], totalHeight: 0, rows: [] };
  }

  const sections: LayoutSection[] = [];
  const allRows: LayoutRow[] = [];
  let cursorY = 0;

  // Items arrive already sorted chronologically in the user's chosen direction:
  // one pass can split them into consecutive sections without assuming the
  // direction. Grouping that sorted its keys would break ascending order.
  let index = 0;
  while (index < items.length) {
    const key = sectionKeyOf(items[index]!.takenAt, groupBy);
    const start = index;
    while (index < items.length && sectionKeyOf(items[index]!.takenAt, groupBy) === key) index++;

    const sectionItems = items.slice(start, index);
    const sectionY = cursorY;
    const sectionHeaderHeight = headerHeightFor?.(key) || headerHeight;
    const collapsed = isCollapsed?.(key) ?? false;
    let rowY = cursorY + sectionHeaderHeight;
    const rows: LayoutRow[] = [];

    let buffer: { item: MediaItem; index: number; ratio: number }[] = [];
    let ratioSum = 0;

    const flush = (justified: boolean): void => {
      if (buffer.length === 0) return;

      const totalGap = gap * (buffer.length - 1);
      const available = containerWidth - totalGap;
      // Height that fits the row exactly into the available width.
      const exactHeight = available / ratioSum;
      // A section's final row is rarely full: stretching would create oversized
      // thumbnails, so keep the target height.
      const height = justified ? exactHeight : Math.min(exactHeight, targetRowHeight);

      const cells: LayoutCell[] = [];
      let x = 0;
      buffer.forEach((entry, position) => {
        // The last item absorbs accumulated rounding so the row ends exactly at
        // the right edge without a one-pixel gap.
        const width =
          justified && position === buffer.length - 1
            ? containerWidth - x
            : Math.round(entry.ratio * height);

        cells.push({ item: entry.item, index: entry.index, x, y: rowY, width, height });
        x += width + gap;
      });

      const row: LayoutRow = { y: rowY, height, cells };
      rows.push(row);
      allRows.push(row);
      rowY += height + gap;

      buffer = [];
      ratioSum = 0;
    };

    // A collapsed section places no rows: its cells exist neither in `rows` nor
    // `allRows`. This is deliberate — everything traversing the grid
    // (virtualisation, keyboard navigation) reads these arrays and would have
    // no other way to know that a cell is hidden.
    if (!collapsed) {
      sectionItems.forEach((item, offset) => {
        const ratio = ratioOf(item);
        buffer.push({ item, index: start + offset, ratio });
        ratioSum += ratio;

        // The row is full once the height needed to fill it falls below the target.
        const height = (containerWidth - gap * (buffer.length - 1)) / ratioSum;
        if (height <= targetRowHeight) flush(true);
      });
      flush(false);
    }

    // `rowY` advanced one extra `gap` after the last row. With no rows at all,
    // subtracting it would move the next section beneath the header.
    const sectionHeight = collapsed ? sectionHeaderHeight : Math.max(0, rowY - gap - sectionY);
    sections.push({
      key,
      label: sectionLabelOf(key, groupBy),
      y: sectionY,
      headerHeight: sectionHeaderHeight,
      height: sectionHeight,
      rows,
      count: sectionItems.length,
      collapsed,
    });
    cursorY = sectionY + sectionHeight + sectionGap;
  }

  return {
    sections,
    rows: allRows,
    totalHeight: Math.max(0, cursorY - sectionGap),
  };
}

/**
 * Chooses row height from available width: taller rows on large screens, shorter
 * on mobile to keep several photos per row instead of one band per photo.
 */
export function targetRowHeightFor(containerWidth: number): number {
  if (containerWidth < 480) return 110;
  if (containerWidth < 768) return 140;
  if (containerWidth < 1280) return 165;
  if (containerWidth < 1920) return 195;
  return 225;
}
