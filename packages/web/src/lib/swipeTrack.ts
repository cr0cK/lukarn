/**
 * Règles du rail de la visionneuse : ce que devient un balayage horizontal une
 * fois le doigt levé.
 *
 * Le rail suit le doigt au pixel — c'est lui qui rend le geste visible, donc
 * découvrable —, mais la décision de changer de photo se prend au relâchement.
 * Elle est ici, hors de React, parce qu'elle a des seuils qu'on veut pouvoir
 * éprouver : la moitié des gestes ratés viennent d'un seuil, jamais d'un
 * gestionnaire d'événement.
 */

/**
 * Écart entre deux photos sur le rail, en pixels. Sans lui, la photo suivante
 * paraît collée à la précédente pendant le balayage — deux images bord à bord
 * se lisent comme une seule image coupée.
 */
export const GUTTER_PX = 24;

/**
 * Fraction de la largeur au-delà de laquelle le rail bascule sur la voisine.
 *
 * Un quart environ : plus haut, il faut traverser l'écran pour changer de
 * photo, ce qui est épuisant sur un grand téléphone ; plus bas, un geste
 * hésitant fait sauter une photo.
 */
export const COMMIT_FRACTION = 0.22;

/**
 * Vitesse (px/ms) à partir de laquelle un geste bref bascule quand même. C'est
 * ce qui fait qu'un lancer sec du pouce suffit, sans avoir à parcourir le quart
 * de l'écran : le geste natif que tout le monde a dans les doigts.
 */
export const FLICK_VELOCITY = 0.35;

/** En deçà, ce n'est pas un lancer mais un appui qui tremble. */
const FLICK_MIN_PX = 12;

/**
 * Ce qu'il reste du déplacement quand il n'y a pas de photo de ce côté. Le rail
 * bouge, donc le geste est reçu, mais il résiste : c'est ainsi qu'un bord se
 * fait sentir sans message ni blocage sec.
 */
export const EDGE_RESISTANCE = 0.35;

/** Bornes de la remise en place, pour qu'elle reste vive sans paraître sèche. */
const SETTLE_MIN_MS = 160;
const SETTLE_MAX_MS = 320;

/** Vitesse plancher du calcul de durée : évite de diviser par un doigt immobile. */
const SETTLE_MIN_VELOCITY = 0.5;

interface SwipeDecision {
  /** Déplacement horizontal total du doigt, en pixels. */
  dx: number;
  /** Vitesse à l'instant du relâchement, en px/ms, signée comme `dx`. */
  velocity: number;
  /** Largeur du cadre : c'est elle qui donne l'échelle du geste. */
  width: number;
  canPrev: boolean;
  canNext: boolean;
}

/**
 * Déplacement réellement appliqué au rail, bord compris.
 *
 * Le doigt tire librement tant qu'il y a une photo de ce côté ; au-delà du
 * premier ou du dernier média, il ne reste qu'une fraction du geste.
 */
export function resistAtEdge(dx: number, canPrev: boolean, canNext: boolean): number {
  if (dx > 0 && !canPrev) return dx * EDGE_RESISTANCE;
  if (dx < 0 && !canNext) return dx * EDGE_RESISTANCE;
  return dx;
}

/**
 * Ce que devient le geste : `1` pour la photo suivante, `-1` pour la
 * précédente, `0` pour un retour en place.
 *
 * Deux façons de valider, parce qu'il y a deux gestes : traverser une fraction
 * de l'écran — on regarde ce qui vient avant de lâcher —, ou lancer le rail
 * d'un coup de pouce sans regarder. N'en retenir qu'une rendrait l'autre
 * inopérante.
 */
export function decideSwipe({ dx, velocity, width, canPrev, canNext }: SwipeDecision): -1 | 0 | 1 {
  if (dx === 0) return 0;
  const towards = dx < 0 ? 1 : -1;
  if (towards === 1 && !canNext) return 0;
  if (towards === -1 && !canPrev) return 0;

  if (Math.abs(dx) >= width * COMMIT_FRACTION) return towards;

  // Le lancer ne compte que s'il va dans le sens du déplacement : un doigt qui
  // revient sur ses pas au dernier moment annule, il ne valide pas.
  const flick =
    Math.abs(velocity) >= FLICK_VELOCITY &&
    Math.sign(velocity) === Math.sign(dx) &&
    Math.abs(dx) >= FLICK_MIN_PX;

  return flick ? towards : 0;
}

/**
 * Durée de la remise en place, déduite de ce qu'il reste à parcourir et de la
 * vitesse qu'avait le doigt.
 *
 * Une durée fixe trahit le geste : après un lancer sec, le rail semble
 * s'engluer ; après un glissement lent presque abouti, il part d'un coup. Ici
 * l'animation prolonge le mouvement du doigt au lieu de le remplacer.
 */
export function settleDuration(remainingPx: number, velocity: number): number {
  const speed = Math.max(Math.abs(velocity), SETTLE_MIN_VELOCITY);
  return Math.min(SETTLE_MAX_MS, Math.max(SETTLE_MIN_MS, Math.abs(remainingPx) / speed));
}
