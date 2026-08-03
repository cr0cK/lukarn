import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Détection d'un balayage horizontal, pour passer d'une photo à l'autre au
 * doigt.
 *
 * Une galerie familiale se regarde surtout sur téléphone, où changer de photo
 * supposait jusqu'ici de viser une flèche de 44 px posée sur l'image.
 *
 * **Tactile et stylet uniquement.** À la souris, un glissement horizontal sur la
 * photo est un geste rare, alors que le clic sert déjà à zoomer : y ajouter un
 * changement de photo rendrait le clic imprévisible selon qu'on a bougé de
 * trois pixels ou non.
 */

/** Déplacement minimal pour qu'un geste compte comme un balayage. */
const MIN_DISTANCE_PX = 50;

/**
 * Le geste doit être franchement horizontal. Sans ce rapport, un défilement
 * vertical un peu oblique — le geste le plus courant sur un téléphone — ferait
 * sauter une photo.
 */
const HORIZONTAL_RATIO = 1.5;

/**
 * Au-delà, ce n'est plus un balayage mais un doigt posé puis déplacé : le
 * traiter comme un changement de photo surprendrait.
 */
const MAX_DURATION_MS = 800;

export interface SwipeHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

/**
 * Rend les gestionnaires à poser sur l'élément balayable. `direction` vaut
 * `1` pour un balayage vers la gauche — donc « photo suivante », dans le sens
 * où le contenu se déplace — et `-1` vers la droite.
 */
export function useSwipe(onSwipe: (direction: 1 | -1) => void, enabled = true): SwipeHandlers {
  const start = useRef<{ id: number; x: number; y: number; at: number } | null>(null);

  return {
    onPointerDown: (event) => {
      if (!enabled || event.pointerType === 'mouse') return;
      start.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        at: performance.now(),
      };
    },

    onPointerUp: (event) => {
      const from = start.current;
      start.current = null;
      if (!enabled || !from || from.id !== event.pointerId) return;

      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      if (performance.now() - from.at > MAX_DURATION_MS) return;
      if (Math.abs(dx) < MIN_DISTANCE_PX) return;
      if (Math.abs(dx) < Math.abs(dy) * HORIZONTAL_RATIO) return;

      onSwipe(dx < 0 ? 1 : -1);
    },

    // Un geste interrompu par le navigateur (deuxième doigt, retour arrière par
    // bord d'écran) ne doit pas rester en attente : le pointeur suivant serait
    // comparé à une origine périmée.
    onPointerCancel: () => {
      start.current = null;
    },
  };
}
