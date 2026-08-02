import {
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { computeZoomScale, zoomPercent } from '../lib/zoom';

/** Au-delà, on n'observe plus que le grain du capteur. */
const MAX_SCALE = 8;
/** En deçà de cet écart, le zoom est considéré comme inactif (tolérance d'arrondi). */
const FIT_EPSILON = 0.01;
const WHEEL_SENSITIVITY = 0.0015;

interface ZoomableImageProps {
  /** Rendu plein écran (2560 px), affiché immédiatement. */
  src: string;
  /** Rendu haute résolution (4096 px), chargé au premier zoom seulement. */
  hdSrc: string;
  /** Vignette déjà en cache navigateur, affichée pendant le chargement de `src`. */
  placeholderSrc: string;
  alt: string;
  /**
   * Dimensions du fichier d'origine d'après l'index. Elles bornent le zoom par
   * le haut, mais ne le décident pas : le rendu servi peut en avoir moins.
   */
  naturalWidth: number | null;
  naturalHeight: number | null;
  /** Piloté depuis la visionneuse (touche `z`). */
  zoomed: boolean;
  onZoomedChange: (zoomed: boolean) => void;
  onLoadedChange?: (loaded: boolean) => void;
}

interface Box {
  width: number;
  height: number;
}

/** Taille de l'image une fois ajustée dans le cadre, sans agrandissement. */
function fitInside(image: Box, container: Box): Box {
  if (image.width <= 0 || image.height <= 0 || container.width <= 0 || container.height <= 0) {
    return { width: 0, height: 0 };
  }
  const ratio = Math.min(container.width / image.width, container.height / image.height, 1);
  return { width: image.width * ratio, height: image.height * ratio };
}

/**
 * Image zoomable de la visionneuse.
 *
 * Le zoom sert à examiner une photo, pas à grossir ce qui est déjà affiché :
 * un simple `scale()` sur le rendu plein écran (plafonné à 2560 px) ne ferait
 * qu'étirer des pixels déjà rasterisés. Au premier agrandissement, le composant
 * bascule donc sur la variante `hd` (4096 px), qui contient les détails que le
 * rendu d'écran a perdus.
 *
 * L'échelle 1 correspond à l'image ajustée au cadre ; l'échelle « 100 % »
 * (`pixelScale`) est celle où un pixel du rendu disponible occupe un pixel
 * d'écran — pas celle des dimensions du fichier d'origine, que le rendu `hd`
 * n'atteint pas toujours. Le déplacement est borné pour que l'image ne puisse
 * jamais quitter le cadre.
 */
export function ZoomableImage({
  src,
  hdSrc,
  placeholderSrc,
  alt,
  naturalWidth,
  naturalHeight,
  zoomed,
  onZoomedChange,
  onLoadedChange,
}: ZoomableImageProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<Box>({ width: 0, height: 0 });
  const [intrinsic, setIntrinsic] = useState<Box>({
    width: naturalWidth ?? 0,
    height: naturalHeight ?? 0,
  });
  /**
   * Largeur du rendu réellement chargé, mesurée sur l'élément. Le serveur
   * plafonne le plus grand côté de `hd` : sans cette mesure, une photo de
   * 6000 px afficherait « 100 % » alors qu'il n'y a que 4096 pixels à peindre.
   */
  const [renderedWidth, setRenderedWidth] = useState(0);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [hdReady, setHdReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const dragRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const measure = (): void => {
      const rect = element.getBoundingClientRect();
      setContainer({ width: rect.width, height: rect.height });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const displayed = fitInside(intrinsic, container);

  /**
   * Échelle à laquelle un pixel du rendu occupe un pixel d'écran. C'est la
   * cible de la touche `z` : le premier cran utile, et souvent le seul voulu.
   */
  const { availableWidth, pixelScale, limited } = computeZoomScale({
    sourceWidth: naturalWidth ?? 0,
    sourceHeight: naturalHeight ?? 0,
    renderedWidth,
    hdLoaded: hdReady,
    displayedWidth: displayed.width,
    maxScale: MAX_SCALE,
  });

  const canZoom = pixelScale > 1 + FIT_EPSILON;

  /** Déplacement maximal avant que le cadre ne déborde de l'image. */
  const clampOffset = useCallback(
    (next: { x: number; y: number }, atScale: number) => {
      const maxX = Math.max(0, (displayed.width * atScale - container.width) / 2);
      const maxY = Math.max(0, (displayed.height * atScale - container.height) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, next.x)),
        y: Math.min(maxY, Math.max(-maxY, next.y)),
      };
    },
    [displayed.width, displayed.height, container.width, container.height],
  );

  /**
   * Échelle et cadrage courants lus sans créer de dépendance. Les mises à jour
   * sont calculées à partir de ces valeurs plutôt que dans un updater d'état :
   * un `setState` déclenché depuis l'updater d'un autre est un effet de bord
   * que React n'exécute pas de façon fiable.
   */
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);
  scaleRef.current = scale;
  offsetRef.current = offset;

  const applyScale = useCallback(
    (nextScale: number, focus?: { x: number; y: number }) => {
      const clamped = Math.min(MAX_SCALE, Math.max(1, nextScale));

      if (clamped <= 1 + FIT_EPSILON) {
        setScale(1);
        setOffset({ x: 0, y: 0 });
        return;
      }

      // Zoom ancré sur le point visé : le détail sous le curseur ne doit pas
      // se dérober pendant l'agrandissement.
      const ratio = clamped / scaleRef.current;
      const anchorX = focus?.x ?? 0;
      const anchorY = focus?.y ?? 0;
      const previous = offsetRef.current;

      setScale(clamped);
      setOffset(
        clampOffset(
          {
            x: (previous.x - anchorX) * ratio + anchorX,
            y: (previous.y - anchorY) * ratio + anchorY,
          },
          clamped,
        ),
      );
    },
    [clampOffset],
  );

  // Réagit à l'intention venue de la visionneuse (touche `z`), sans se relancer
  // à chaque cran de molette — ce qui ramènerait aussitôt l'image au niveau natif.
  useEffect(() => {
    if (zoomed && scaleRef.current <= 1 + FIT_EPSILON) applyScale(pixelScale);
    else if (!zoomed && scaleRef.current > 1 + FIT_EPSILON) applyScale(1);
  }, [zoomed, pixelScale, applyScale]);

  // Charge la variante haute résolution dès le premier agrandissement, puis la
  // laisse en place : rebasculer sur `full` en revenant au cadre ferait
  // clignoter l'image à chaque aller-retour.
  useEffect(() => {
    if (!canZoom || hdReady || scale <= 1 + FIT_EPSILON) return;
    const image = new Image();
    // Chargé et décodé hors écran : le passage à la haute résolution se fait
    // sur une image prête, sans à-coup visible. Sa largeur réelle est relevée
    // ici : c'est la seule mesure qui remplace l'estimation du plafond serveur.
    image.onload = () => {
      setRenderedWidth(image.naturalWidth);
      setHdReady(true);
    };
    image.src = hdSrc;
  }, [scale, canZoom, hdReady, hdSrc]);

  /**
   * Zoom à la molette.
   *
   * Le listener est posé à la main en `passive: false` : React enregistre les
   * gestionnaires `wheel` en passif, ce qui rend `preventDefault()` inopérant
   * et laisserait le navigateur défiler ou zoomer par-dessus la visionneuse.
   */
  useEffect(() => {
    const element = containerRef.current;
    if (!element || !canZoom) return;

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();

      const rect = element.getBoundingClientRect();
      const focus = {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      };

      // Progression exponentielle : chaque cran multiplie l'échelle, ce qui
      // donne la même sensation près du cadrage initial et au plus fort zoom.
      const next = scaleRef.current * Math.exp(-event.deltaY * WHEEL_SENSITIVITY);
      applyScale(next, focus);
      onZoomedChange(next > 1 + FIT_EPSILON);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [canZoom, applyScale, onZoomedChange]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (scale <= 1 + FIT_EPSILON || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX - offset.x,
      startY: event.clientY - offset.y,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset(
      clampOffset({ x: event.clientX - drag.startX, y: event.clientY - drag.startY }, scale),
    );
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const toggleZoom = (event: ReactMouseEvent<HTMLElement>): void => {
    if (!canZoom) return;

    if (scale > 1 + FIT_EPSILON) {
      applyScale(1);
      onZoomedChange(false);
      return;
    }

    // Agrandit à l'endroit cliqué plutôt qu'au centre : on zoome sur ce qu'on
    // regarde, pas sur le milieu de la photo.
    const rect = event.currentTarget.getBoundingClientRect();
    applyScale(pixelScale, {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    });
    onZoomedChange(true);
  };

  const isZoomed = scale > 1 + FIT_EPSILON;

  return (
    <div
      ref={containerRef}
      className="relative flex size-full items-center justify-center overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={(event) => event.preventDefault()}
    >
      {/* Placeholder : la vignette est déjà en cache navigateur puisqu'elle
          vient d'être affichée dans la grille. Elle occupe l'espace exact du
          rendu final le temps que celui-ci arrive — quelques secondes quand la
          photo doit encore être téléchargée depuis Drive. */}
      {!loaded && !failed && displayed.width > 0 && (
        <img
          src={placeholderSrc}
          alt=""
          aria-hidden="true"
          className="absolute scale-105 blur-lg"
          style={{ width: displayed.width, height: displayed.height }}
        />
      )}

      <img
        src={hdReady ? hdSrc : src}
        alt={alt}
        draggable={false}
        onLoad={(event) => {
          const image = event.currentTarget;
          setLoaded(true);
          onLoadedChange?.(true);
          setRenderedWidth(image.naturalWidth);
          // Repli quand l'index ne connaît pas les dimensions du fichier : on
          // prend celles du rendu reçu. Le zoom sera plus limité, mais présent.
          if (intrinsic.width <= 0) {
            setIntrinsic({ width: image.naturalWidth, height: image.naturalHeight });
          }
        }}
        onError={() => setFailed(true)}
        onClick={toggleZoom}
        className={`relative max-h-full max-w-full object-contain select-none ${
          loaded ? '' : 'opacity-0'
        } ${isZoomed ? 'cursor-grab active:cursor-grabbing' : canZoom ? 'cursor-zoom-in' : ''}`}
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
          // Aucune transition pendant le glisser : le déplacement doit coller
          // au curseur, pas le suivre avec du retard.
          transition: dragRef.current ? 'none' : 'transform 120ms ease-out',
        }}
      />

      {isZoomed && displayed.width > 0 && (
        <Minimap
          displayed={displayed}
          container={container}
          scale={scale}
          offset={offset}
          src={placeholderSrc}
        />
      )}

      {isZoomed && (
        <span className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs tabular-nums text-ink-100">
          {zoomPercent(displayed.width, scale, availableWidth)} %
          {/* Dit que le rendu servi est plus petit que le fichier plutôt que de
              le taire : sans ça, « 100 % » sur une photo de 6000 px laisserait
              croire qu'on regarde ses pixels alors qu'il n'y en a que 4096. */}
          {limited && ` · rendu ${availableWidth} px sur ${naturalWidth} px`}
          {!hdReady && ' · chargement HD…'}
        </span>
      )}

      {failed && <p className="text-sm text-ink-400">Cette image n'a pas pu être affichée.</p>}
    </div>
  );
}

/**
 * Repère de position pendant le zoom : la photo entière en réduction, avec le
 * cadre de la zone visible. Sans lui, on perd tout sens de l'orientation dès
 * qu'on se déplace dans une image agrandie.
 */
function Minimap({
  displayed,
  container,
  scale,
  offset,
  src,
}: {
  displayed: Box;
  container: Box;
  scale: number;
  offset: { x: number; y: number };
  src: string;
}): ReactElement {
  const MAX_EDGE = 132;
  const ratio = Math.min(MAX_EDGE / displayed.width, MAX_EDGE / displayed.height);
  const width = displayed.width * ratio;
  const height = displayed.height * ratio;

  // Part de l'image couverte par le cadre, bornée à 1 : sur un écran plus large
  // que l'image zoomée, la zone visible ne dépasse pas la photo.
  const viewWidth = Math.min(1, container.width / (displayed.width * scale));
  const viewHeight = Math.min(1, container.height / (displayed.height * scale));

  // `offset` déplace l'image sous un cadre fixe : la zone regardée se déplace
  // donc en sens inverse, d'où le signe négatif.
  const centerX = 0.5 - offset.x / (displayed.width * scale);
  const centerY = 0.5 - offset.y / (displayed.height * scale);

  return (
    <div
      className="pointer-events-none absolute right-4 bottom-4 overflow-hidden rounded border border-white/25 shadow-lg"
      style={{ width, height }}
      aria-hidden="true"
    >
      <img src={src} alt="" className="size-full object-cover opacity-60" />
      <span
        className="absolute border-2 border-white/90 bg-white/10"
        style={{
          width: `${viewWidth * 100}%`,
          height: `${viewHeight * 100}%`,
          left: `${(centerX - viewWidth / 2) * 100}%`,
          top: `${(centerY - viewHeight / 2) * 100}%`,
        }}
      />
    </div>
  );
}
