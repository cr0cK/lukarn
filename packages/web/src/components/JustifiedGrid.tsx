import { type ReactElement, useEffect } from 'react';
import { GRID_HEADER_HEIGHT, type GridLayout } from '../lib/useGridLayout';
import { Thumb } from './Thumb';

/** Distance au bas du contenu déclenchant le chargement de la page suivante. */
const LOAD_MORE_MARGIN_PX = 1500;

interface JustifiedGridProps {
  grid: GridLayout;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
  onLoadMore: () => void;
  hasMore: boolean;
}

/**
 * Rendu virtualisé de la grille justifiée.
 *
 * Le layout complet est calculé en amont par `useGridLayout` ; ce composant ne
 * monte que les lignes proches du viewport. Un album de plusieurs milliers de
 * photos tient ainsi dans quelques dizaines de nœuds DOM, avec une barre de
 * défilement à la bonne longueur dès le premier rendu.
 */
export function JustifiedGrid({
  grid,
  selectedIndex,
  onSelect,
  onOpen,
  onLoadMore,
  hasMore,
}: JustifiedGridProps): ReactElement {
  const { layout, visibleFrom, visibleTo, viewportHeight } = grid;

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
          <h2
            className="absolute left-0 flex items-end pb-3 text-[15px] font-medium text-ink-200"
            style={{ top: section.y, height: GRID_HEADER_HEIGHT }}
          >
            {section.label}
          </h2>

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
                    // Les vignettes du premier écran sont chargées sans attendre
                    // l'IntersectionObserver du lazy-loading natif.
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
