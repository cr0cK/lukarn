import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { GUTTER_PX, decideSwipe, resistAtEdge, settleDuration } from './swipeTrack';

/**
 * Balayage horizontal de la visionneuse : la photo suit le doigt, les voisines
 * entrent par les bords, et le rail rejoint sa place au relâchement.
 *
 * Une galerie familiale se regarde surtout sur téléphone, où changer de photo
 * supposait de viser une flèche de 44 px posée sur l'image. Le balayage
 * existait déjà, mais **rien ne le montrait** : l'image sautait à la suivante
 * une fois le doigt levé, si bien que personne ne découvrait le geste et que
 * personne ne pouvait le reprendre en cours de route. Ce que fait toute
 * visionneuse native, c'est déplacer la photo sous le doigt — c'est le
 * mouvement qui enseigne le geste, pas un tutoriel.
 *
 * **Tactile et stylet uniquement.** À la souris, un glissement horizontal sur
 * la photo est un geste rare, alors que le clic sert déjà à zoomer : y ajouter
 * un changement de photo rendrait le clic imprévisible selon qu'on a bougé de
 * trois pixels ou non.
 */

/**
 * Déplacement à partir duquel le geste est reconnu comme horizontal ou vertical.
 *
 * Rien ne bouge avant : un rail qui frémit sous les deux premiers pixels de
 * tout appui rendrait le simple fait de poser le doigt inquiétant.
 */
const DIRECTION_LOCK_PX = 10;

/**
 * Le geste doit être franchement horizontal. Sans ce rapport, un défilement
 * vertical un peu oblique — le geste le plus courant sur un téléphone — ferait
 * sauter une photo.
 */
const HORIZONTAL_RATIO = 1.5;

/**
 * Au-delà de ce silence, le doigt est considéré comme arrêté. Sans cette
 * remise à zéro, un lancer suivi d'une pause avant de lever validerait sur une
 * vitesse mesurée une seconde plus tôt — le geste de quelqu'un qui a
 * précisément changé d'avis.
 */
const VELOCITY_IDLE_MS = 80;

/** Courbe de sortie : départ franc, arrivée posée, comme une inertie qui retombe. */
export const SETTLE_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';

interface SwipeTrackOptions {
  /** Index affiché : c'est son changement qui remet le rail à zéro. */
  index: number;
  /** Nombre de médias chargés, pour savoir s'il y a un voisin de ce côté. */
  count: number;
  /** Reçoit `1` pour la photo suivante, `-1` pour la précédente. */
  onNavigate: (towards: 1 | -1) => void;
  enabled: boolean;
}

export interface SwipeTrack {
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
  /** Décalage du rail, en pixels. */
  offset: number;
  /** Durée de la transition en cours ; `0` tant que le doigt tient le rail. */
  settleMs: number;
  /**
   * Un geste occupe le rail. C'est à ce signal que la visionneuse monte les
   * photos voisines : hors balayage, elles n'ont rien à faire dans le document.
   */
  active: boolean;
}

/**
 * Rail de balayage. Rend les gestionnaires à poser sur le cadre, et l'état de
 * déplacement à appliquer au conteneur des trois photos.
 */
export function useSwipeTrack({
  index,
  count,
  onNavigate,
  enabled,
}: SwipeTrackOptions): SwipeTrack {
  const [offset, setOffset] = useState(0);
  const [settleMs, setSettleMs] = useState(0);
  const [active, setActive] = useState(false);

  const gesture = useRef<{
    id: number;
    origin: { x: number; y: number };
    /** Largeur du cadre à l'appui : l'échelle de tous les seuils du geste. */
    width: number;
    /** Le geste a-t-il été reconnu comme horizontal ? */
    locked: boolean;
    /** Dernier point daté, pour la vitesse instantanée. */
    lastX: number;
    lastAt: number;
    velocity: number;
  } | null>(null);

  const commit = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canPrev = index > 0;
  const canNext = index < count - 1;

  /**
   * Le rail revient chez lui quand la photo a changé, et pas avant.
   *
   * La visionneuse ne décide pas de son index : elle le demande, et il lui
   * revient par l'URL. Entre les deux, le rail doit rester là où l'animation
   * l'a laissé — c'est-à-dire sur la photo voisine, déjà à l'écran. Le remettre
   * à zéro en même temps qu'on demande le changement ferait réapparaître la
   * photo qu'on vient de quitter, le temps d'une image.
   */
  useLayoutEffect(() => {
    setOffset(0);
    setSettleMs(0);
    setActive(false);
  }, [index]);

  useEffect(
    () => () => {
      if (commit.current) clearTimeout(commit.current);
    },
    [],
  );

  const end = useCallback(
    (event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      const from = gesture.current;
      gesture.current = null;
      if (!from || from.id !== event.pointerId) return;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      // Geste jamais reconnu comme horizontal : rien n'a bougé, il appartient
      // encore au zoom, qui décide de son côté s'il s'agissait d'un appui.
      if (!from.locked) return;

      const dx = resistAtEdge(event.clientX - from.origin.x, canPrev, canNext);
      const velocity = performance.now() - from.lastAt > VELOCITY_IDLE_MS ? 0 : from.velocity;
      const towards = cancelled
        ? 0
        : decideSwipe({ dx, velocity, width: from.width, canPrev, canNext });

      const target = towards === 0 ? 0 : -towards * (from.width + GUTTER_PX);
      const duration = settleDuration(target - dx, velocity);
      setSettleMs(duration);
      setOffset(target);

      // La photo ne change qu'une fois le rail arrivé : la demander plus tôt
      // remonterait la visionneuse au milieu de l'animation, sur une photo qui
      // n'est pas encore celle que l'écran montre.
      commit.current = setTimeout(() => {
        if (towards === 0) {
          setActive(false);
          setSettleMs(0);
        } else {
          onNavigate(towards);
        }
      }, duration);
    },
    [canPrev, canNext, onNavigate],
  );

  return {
    offset,
    settleMs,
    active,

    handlers: {
      onPointerDown: (event) => {
        // Un rail encore en mouvement tient déjà une décision : la reprendre
        // en cours de route validerait un geste sur une photo qui n'est plus
        // celle qu'on visait.
        if (!enabled || event.pointerType === 'mouse' || settleMs > 0) return;
        const now = performance.now();
        gesture.current = {
          id: event.pointerId,
          origin: { x: event.clientX, y: event.clientY },
          width: event.currentTarget.getBoundingClientRect().width,
          locked: false,
          lastX: event.clientX,
          lastAt: now,
          velocity: 0,
        };
      },

      onPointerMove: (event) => {
        const from = gesture.current;
        if (!from || from.id !== event.pointerId) return;

        const dx = event.clientX - from.origin.x;
        const dy = event.clientY - from.origin.y;

        if (!from.locked) {
          if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return;
          // Le premier franchissement tranche, une fois pour toutes : un geste
          // qui s'incurve en route ne doit pas changer de nature sous le doigt.
          if (Math.abs(dx) < Math.abs(dy) * HORIZONTAL_RATIO) {
            gesture.current = null;
            return;
          }
          from.locked = true;
          // Garantit de recevoir le relâchement même si le doigt sort du cadre,
          // et coupe au passage les gestionnaires du zoom, qui vivent plus bas.
          event.currentTarget.setPointerCapture(event.pointerId);
          setActive(true);
          setSettleMs(0);
        }

        const now = performance.now();
        const elapsed = now - from.lastAt;
        // Deux points trop rapprochés donnent une vitesse aberrante : on garde
        // la précédente plutôt que de diviser par un intervalle nul.
        if (elapsed >= 4) {
          from.velocity = (event.clientX - from.lastX) / elapsed;
          from.lastX = event.clientX;
          from.lastAt = now;
        }

        setOffset(resistAtEdge(dx, canPrev, canNext));
      },

      onPointerUp: (event) => end(event, false),

      // Geste interrompu par le navigateur — deuxième doigt, retour arrière par
      // bord d'écran : le rail rentre, sans changer de photo.
      onPointerCancel: (event) => end(event, true),
    },
  };
}
