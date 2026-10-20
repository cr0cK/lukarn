import { type ReactElement, type ReactNode } from 'react';

/** Column descriptor for the desktop (`>= md`) table view of `ResponsiveDataList`. */
export interface ResponsiveDataColumn<T> {
  /** Stable column key. */
  key: string;
  /** Column header label (`text-xs font-medium text-ink-400`). */
  header: ReactNode;
  /** Alignment of header and cell contents (`'right'` automatically right-aligns trailing actions). */
  align?: 'left' | 'right';
  /** Optional width or layout classes applied to `<th>` and `<td>`. */
  className?: string;
  /** Renders the desktop cell (`text-sm`) for a given item. */
  cell: (item: T) => ReactNode;
}

/** Props for the `ResponsiveDataList` primitive. */
export interface ResponsiveDataListProps<T> {
  /** Items rendered in the desktop table and mobile stacked card list. */
  items: readonly T[];
  /** Extracts a unique React key for each item. */
  getKey: (item: T) => string;
  /** Desktop (`>= md`) column definitions. */
  columns: readonly ResponsiveDataColumn<T>[];
  /** Mobile (`< md`) stacked card renderer (`flex flex-col gap-3 p-4`). */
  renderMobileCard: (item: T) => ReactNode;
  /** Optional message or node rendered when `items` is empty. */
  emptyState?: ReactNode;
  /** Optional additional class on the outer container card (`rounded-2xl`). */
  className?: string;
}

/**
 * Dual-layout data list primitive:
 * - On Desktop (`>= md`): semantic `<table>` (`hidden md:table w-full`) with aligned columns
 *   and right-aligned trailing action column (`text-right`), avoiding `flex justify-between`
 *   column drift.
 * - On Mobile (`< md`): stacked cards (`md:hidden divide-y`) with zero horizontal overflow.
 */
export function ResponsiveDataList<T>({
  items,
  getKey,
  columns,
  renderMobileCard,
  emptyState,
  className = '',
}: ResponsiveDataListProps<T>): ReactElement {
  if (items.length === 0 && emptyState) {
    return (
      <div
        className={`rounded-2xl border border-zinc-800 bg-ink-850/60 p-6 text-center text-sm text-ink-400 light:border-zinc-200 light:bg-white ${className}`.trim()}
      >
        {emptyState}
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-zinc-800 bg-ink-850/60 light:border-zinc-200 light:bg-white ${className}`.trim()}
    >
      <table className="hidden w-full border-collapse md:table">
        <thead>
          <tr className="border-b border-zinc-800 bg-ink-900/40 light:border-zinc-200 light:bg-zinc-50/80">
            {columns.map((col, index) => {
              const isRight = col.align === 'right' || index === columns.length - 1;
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={`px-4 py-3 text-xs font-medium tracking-wide text-ink-400 ${
                    isRight ? 'text-right' : 'text-left'
                  } ${col.className ?? ''}`.trim()}
                >
                  {col.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/80 light:divide-zinc-200">
          {items.map((item) => {
            const key = getKey(item);
            return (
              <tr key={key} className="transition-colors hover:bg-tint">
                {columns.map((col, index) => {
                  const isRight = col.align === 'right' || index === columns.length - 1;
                  return (
                    <td
                      key={col.key}
                      className={`px-4 py-3.5 align-middle text-sm text-ink-100 ${
                        isRight ? 'text-right' : 'text-left'
                      } ${col.className ?? ''}`.trim()}
                    >
                      {col.cell(item)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="divide-y divide-zinc-800/80 md:hidden light:divide-zinc-200">
        {items.map((item) => (
          <div key={getKey(item)} className="flex flex-col gap-3 p-4">
            {renderMobileCard(item)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Props for the structured `ResponsiveMobileCard` layout helper (`< md`). */
export interface ResponsiveMobileCardProps {
  /** Primary identity/name (`text-sm font-medium text-ink-100`). */
  title: ReactNode;
  /** Optional subtitle (`text-sm text-ink-400`) below the title. */
  subtitle?: ReactNode;
  /** Top-right status badge or action buttons (`shrink-0`). */
  actions?: ReactNode;
  /** Middle row of role/state pills (`flex flex-wrap gap-1.5`). */
  badges?: ReactNode;
  /** Bottom row with scope summary and granular notification toggles (`Photos`, `Commentaires`). */
  footer?: ReactNode;
}

/**
 * Structured mobile card (`< md`) used inside `ResponsiveDataList`:
 * - Header row: identity + subtitle on the left, actions on the right.
 * - Body row: non-breaking role/status pills (`flex flex-wrap gap-1.5`).
 * - Footer row: scope and notification controls.
 */
export function ResponsiveMobileCard({
  title,
  subtitle,
  actions,
  badges,
  footer,
}: ResponsiveMobileCardProps): ReactElement {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-ink-100">{title}</div>
          {subtitle && <div className="mt-0.5 truncate text-sm text-ink-400">{subtitle}</div>}
        </div>
        {actions && <div className=" flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {badges && <div className="flex flex-wrap items-center gap-1.5">{badges}</div>}
      {footer && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/60 pt-2.5 text-sm text-ink-300 light:border-zinc-200">
          {footer}
        </div>
      )}
    </>
  );
}
