import type { AlbumDay } from '@nonni/shared';
import { type ReactElement, useEffect } from 'react';
import type { GridLayout } from '../lib/useGridLayout';
import { SectionHeader } from './SectionHeader';
import { Thumb } from './Thumb';

/** Distance au bas du contenu déclenchant le chargement de la page suivante. */
const LOAD_MORE_MARGIN_PX = 1500;

interface JustifiedGridProps {
  grid: GridLayout;
  albumId: string;
  /** Journées annotées, indexées par clé de section. Vide en découpage par mois. */
  days: Map<string, AlbumDay>;
  /** Ouvre le crayon des en-têtes : administrateur, en découpage par jour. */
  canAnnotate: boolean;
  /** Replie ou déplie la section, par sa clé. */
  onToggleSection: (key: string) => void;
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
