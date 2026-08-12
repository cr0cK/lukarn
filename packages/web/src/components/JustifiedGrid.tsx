import type { AlbumDay } from '@nonni/shared';
import { type ReactElement, useEffect } from 'react';
import type { GridLayout } from '../lib/useGridLayout';
import { SectionHeader } from './SectionHeader';
import { Thumb } from './Thumb';

/** Distance from the bottom of the content that triggers loading the next page. */
const LOAD_MORE_MARGIN_PX = 1500;

interface JustifiedGridProps {
  grid: GridLayout;
  albumId: string;
  /** Annotated days indexed by section key. Empty when grouping by month. */
  days: Map<string, AlbumDay>;
  /** Enables header editing for administrators when grouping by day. */
  canAnnotate: boolean;
  /** Collapses or expands the section by key. */
  onToggleSection: (key: string) => void;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
  onLoadMore: () => void;
  hasMore: boolean;
}

/**
 * Virtualised rendering of the justified grid.
 *
 * `useGridLayout` computes the full layout up front; this component mounts only
 * rows near the viewport. An album of several thousand photos therefore uses a
 * few dozen DOM nodes, with the correctly sized scrollbar from the first render.
 */
export function JustifiedGrid({
  grid,
  albumId,
  days,
  canAnnotate,
  onToggleSection,
  selectedIndex,
  onSelect,
  onOpen,
  onLoadMore,
  hasMore,
}: JustifiedGridProps): ReactElement {
  const { layout, visibleFrom, visibleTo, viewportHeight, descriptionLines } = grid;

  useEffect(() => {
    if (!hasMore || layout.totalHeight === 0) return;
    if (visibleTo + LOAD_MORE_MARGIN_PX >= layout.totalHeight) onLoadMore();
  }, [hasMore, visibleTo, layout.totalHeight, onLoadMore]);

  const visibleSections = layout.sections.filter(
    (section) => section.y + section.height >= visibleFrom && section.y <= visibleTo,
  );

  return (
    <div ref={grid.ref} className="relative w-full" style={{ height: layout.totalHeight }}>
      {visibleSections.map((section) => (
        <div key={section.key}>
          <SectionHeader
            albumId={albumId}
            section={section}
            day={days.get(section.key)}
            editable={canAnnotate}
            descriptionLines={descriptionLines.get(section.key) ?? 0}
            onToggle={() => onToggleSection(section.key)}
          />

          {section.rows
            .filter((row) => row.y + row.height >= visibleFrom && row.y <= visibleTo)
            .flatMap((row) =>
              row.cells.map((cell) => (
                <div key={cell.item.id} className="absolute" style={{ left: cell.x, top: cell.y }}>
                  <Thumb
                    item={cell.item}
                    width={cell.width}
                    height={cell.height}
                    selected={cell.index === selectedIndex}
                    // Load first-screen thumbnails without waiting for the native
                    // lazy-loading IntersectionObserver.
                    eager={cell.y < viewportHeight}
                    onOpen={() => {
                      onSelect(cell.index);
                      onOpen(cell.index);
                    }}
                  />
                </div>
              )),
            )}
        </div>
      ))}
    </div>
  );
}
