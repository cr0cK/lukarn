import type { MediaItem } from '@gdv/shared';

/**
 * Calcul du layout « justifié » de la grille : des lignes de hauteur variable
 * dont les images conservent leur proportion et remplissent exactement la
 * largeur disponible — la disposition de Google Photos.
 *
 * Tout est calculé à partir des dimensions déjà connues (elles viennent de
 * l'index côté serveur), donc sans charger la moindre image : la grille peut
 * être positionnée et virtualisée avant tout téléchargement, et le défilement
 * ne provoque aucun décalage de mise en page.
 */

export interface LayoutOptions {
  containerWidth: number;
  /** Hauteur visée pour une ligne. Les lignes s'en écartent pour tomber juste. */
  targetRowHeight: number;
  gap: number;
  /** Hauteur de l'en-tête de mois. */
  headerHeight: number;
  /** Marge sous chaque section. */
  sectionGap: number;
}

export interface LayoutCell {
  item: MediaItem;
  /** Index dans la liste d'origine : sert à la navigation clavier et à la visionneuse. */
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
  /** Position de l'en-tête ; les lignes commencent à `y + headerHeight`. */
  y: number;
  height: number;
  rows: LayoutRow[];
}

export interface Layout {
  sections: LayoutSection[];
  totalHeight: number;
  /** Toutes les lignes, tous mois confondus, dans l'ordre d'affichage. */
  rows: LayoutRow[];
}

/** Proportion de repli quand le serveur n'a pas les dimensions du fichier. */
const FALLBACK_RATIO = 4 / 3;
/** Une image très panoramique déformerait toute sa ligne : on la borne. */
const MAX_RATIO = 3.5;
const MIN_RATIO = 0.4;

function ratioOf(item: MediaItem): number {
  if (!item.width || !item.height) return FALLBACK_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, item.width / item.height));
}

/** Clé de regroupement `YYYY-MM`, sur la date de prise de vue en UTC. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function monthLabel(key: string, locale = 'fr-FR'): string {
  const [year, month] = key.split('-');
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  const label = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function computeLayout(items: MediaItem[], options: LayoutOptions): Layout {
  const { containerWidth, targetRowHeight, gap, headerHeight, sectionGap } = options;

  if (containerWidth <= 0 || items.length === 0) {
    return { sections: [], totalHeight: 0, rows: [] };
  }

  const sections: LayoutSection[] = [];
  const allRows: LayoutRow[] = [];
  let cursorY = 0;

  // Les items arrivent déjà triés chronologiquement, dans un sens ou dans
  // l'autre selon le choix de l'utilisateur : un simple parcours suffit à les
  // découper en mois consécutifs, sans présumer de la direction.
  let index = 0;
  while (index < items.length) {
    const key = monthKey(items[index]!.takenAt);
    const start = index;
    while (index < items.length && monthKey(items[index]!.takenAt) === key) index++;

    const sectionItems = items.slice(start, index);
    const sectionY = cursorY;
    let rowY = cursorY + headerHeight;
    const rows: LayoutRow[] = [];

    let buffer: { item: MediaItem; index: number; ratio: number }[] = [];
    let ratioSum = 0;

    const flush = (justified: boolean): void => {
      if (buffer.length === 0) return;

      const totalGap = gap * (buffer.length - 1);
      const available = containerWidth - totalGap;
      // Hauteur qui fait tenir la ligne pile dans la largeur disponible.
      const exactHeight = available / ratioSum;
      // La dernière ligne d'un mois est rarement pleine : l'étirer donnerait
      // des vignettes démesurées, on la laisse à la hauteur cible.
      const height = justified ? exactHeight : Math.min(exactHeight, targetRowHeight);

      const cells: LayoutCell[] = [];
      let x = 0;
      buffer.forEach((entry, position) => {
        // Le dernier de la ligne absorbe l'arrondi cumulé pour que la ligne
        // finisse exactement au bord droit, sans liseré d'un pixel.
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

    sectionItems.forEach((item, offset) => {
      const ratio = ratioOf(item);
      buffer.push({ item, index: start + offset, ratio });
      ratioSum += ratio;

      // La ligne est pleine dès que la hauteur nécessaire pour la remplir
      // passe sous la hauteur cible.
      const height = (containerWidth - gap * (buffer.length - 1)) / ratioSum;
      if (height <= targetRowHeight) flush(true);
    });
    flush(false);

    // `rowY` a avancé d'un `gap` de trop après la dernière ligne.
    const sectionHeight = Math.max(0, rowY - gap - sectionY);
    sections.push({ key, label: monthLabel(key), y: sectionY, height: sectionHeight, rows });
    cursorY = sectionY + sectionHeight + sectionGap;
  }

  return {
    sections,
    rows: allRows,
    totalHeight: Math.max(0, cursorY - sectionGap),
  };
}

/**
 * Choisit la hauteur de ligne selon la largeur disponible : des lignes hautes
 * sur un grand écran, plus basses sur mobile pour garder plusieurs photos par
 * ligne plutôt qu'une seule bande par photo.
 */
export function targetRowHeightFor(containerWidth: number): number {
  if (containerWidth < 480) return 110;
  if (containerWidth < 768) return 140;
  if (containerWidth < 1280) return 165;
  if (containerWidth < 1920) return 195;
  return 225;
}
