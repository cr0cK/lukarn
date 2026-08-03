import { DEFAULT_GROUP_BY, type GroupBy, type MediaItem } from '@gdv/shared';
import { formatDate } from './format';

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
  /** Hauteur de l'en-tête de section. */
  headerHeight: number;
  /** Marge sous chaque section. */
  sectionGap: number;
  /** Découpage en sections. Omis, c'est le mois — le défaut partagé. */
  groupBy?: GroupBy;
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
  /** Toutes les lignes, toutes sections confondues, dans l'ordre d'affichage. */
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

/**
 * Clé de regroupement `YYYY-MM`, sur la date de prise de vue en UTC.
 *
 * Découper sur la chaîne ISO plutôt que sur un `Date` garde le découpage en
 * UTC : `getMonth()` bascule de mois pour une photo du 31 à 23 h vue depuis
 * Paris, alors que `taken_at` est déjà l'heure de l'appareil.
 */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Clé de regroupement `YYYY-MM-DD`, en UTC pour la même raison que `monthKey`. */
export function dayKey(iso: string): string {
  return iso.slice(0, 10);
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

/**
 * Jour courant sur l'horloge de celui qui regarde, en `YYYY-MM-DD`.
 *
 * Volontairement le calendrier **local** et non le jour UTC, à l'inverse de
 * tout le reste : `taken_at` est l'heure qu'affichait l'appareil, c'est-à-dire
 * la même horloge murale que celle du navigateur. Comparer au jour UTC
 * refuserait « Aujourd'hui » à un après-midi encore en cours à Montréal, et
 * l'accorderait à Auckland avant que la journée n'ait commencé.
 */
function localDayKey(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Jour calendaire précédant `key`, en `YYYY-MM-DD`. */
function previousDayKey(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! - 1));
  return date.toISOString().slice(0, 10);
}

/**
 * Libellé d'une section jour : « 14 juillet 2026 », ou un repère relatif pour
 * les deux jours les plus récents.
 *
 * Une date complète est illisible en série — vingt en-têtes qui ne diffèrent
 * que par le quantième obligent à lire chaque chiffre. « Aujourd'hui » et
 * « Hier » se reconnaissent d'un coup d'œil ; au-delà, le repère relatif
 * (« il y a 5 jours ») demanderait un calcul mental de plus que la date elle-même.
 *
 * `today` est injectable pour que les tests ne dépendent pas de la date du jour.
 */
export function dayLabel(key: string, today = localDayKey(new Date())): string {
  if (key === today) return "Aujourd'hui";
  if (key === previousDayKey(today)) return 'Hier';
  // Midi et non minuit : une clé de jour n'est qu'un quantième, et si un
  // formateur de `format.ts` cessait un jour d'être en UTC, minuit basculerait
  // de jour dans la moitié des fuseaux — midi ne bascule dans aucun.
  return formatDate(`${key}T12:00:00.000Z`);
}

/** Clé de section d'un média, selon le découpage demandé. */
export function sectionKeyOf(iso: string, groupBy: GroupBy): string {
  return groupBy === 'day' ? dayKey(iso) : monthKey(iso);
}

/** En-tête affiché pour une clé de section, selon le découpage demandé. */
export function sectionLabelOf(key: string, groupBy: GroupBy): string {
  return groupBy === 'day' ? dayLabel(key) : monthLabel(key);
}

export function computeLayout(items: MediaItem[], options: LayoutOptions): Layout {
  const {
    containerWidth,
    targetRowHeight,
    gap,
    headerHeight,
    sectionGap,
    groupBy = DEFAULT_GROUP_BY,
  } = options;

  if (containerWidth <= 0 || items.length === 0) {
    return { sections: [], totalHeight: 0, rows: [] };
  }

  const sections: LayoutSection[] = [];
  const allRows: LayoutRow[] = [];
  let cursorY = 0;

  // Les items arrivent déjà triés chronologiquement, dans un sens ou dans
  // l'autre selon le choix de l'utilisateur : un simple parcours suffit à les
  // découper en sections consécutives, sans présumer de la direction. Un
  // regroupement qui trierait ses clés casserait le tri ascendant.
  let index = 0;
  while (index < items.length) {
    const key = sectionKeyOf(items[index]!.takenAt, groupBy);
    const start = index;
    while (index < items.length && sectionKeyOf(items[index]!.takenAt, groupBy) === key) index++;

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
      // La dernière ligne d'une section est rarement pleine : l'étirer donnerait
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
    sections.push({
      key,
      label: sectionLabelOf(key, groupBy),
      y: sectionY,
      height: sectionHeight,
      rows,
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
