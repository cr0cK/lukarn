import {
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  computeZoomScale,
  isTap,
  offsetForCenter,
  viewCenter,
  visibleFraction,
  zoomPercent,
  type Point,
} from '../lib/zoom';
import { previewOverlay } from '../lib/preview';

/** Au-delà, on n'observe plus que le grain du capteur. */
const MAX_SCALE = 8;
/** En deçà de cet écart, le zoom est considéré comme inactif (tolérance d'arrondi). */
const FIT_EPSILON = 0.01;
const WHEEL_SENSITIVITY = 0.0015;

interface ZoomableImageProps {
  /** Rendu plein écran (2560 px), affiché immédiatement. */
  src: string;
  /**
   * Rendu haute résolution (4096 px), chargé au premier agrandissement
   * seulement — celui de la visionneuse, ou le pincement natif de la page.
   */
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
 * rendu d'écran a perdus — que l'agrandissement vienne de la visionneuse ou du
 * pincement natif de la page, que le navigateur rasterise à partir des mêmes
 * pixels d'écran.
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
  const imageRef = useRef<HTMLImageElement>(null);
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

  /**
   * Geste pointeur en cours. Il sert à deux choses d'un coup : déplacer l'image
   * agrandie, et décider au relâchement si le pointeur a désigné un point —
   * donc un clic — ou déplacé l'image.
   */
  const gestureRef = useRef<{
    pointerId: number;
    /** Position à l'appui, référence de la décision clic ou glisser. */
    origin: Point;
    /** Position du pointeur moins le décalage courant : base du déplacement. */
    panFrom: Point;
    /** Vrai dès que l'image a bougé sous le pointeur : coupe la transition. */
    panning: boolean;
    /** Le geste a-t-il commencé sur la photo, et non sur le fond du cadre ? */
    onImage: boolean;
  } | null>(null);

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

  /**
   * Amène un point de la photo au centre de la fenêtre. Le repère de position
   * s'en sert : y cliquer ou y glisser désigne un endroit de l'image, et
   * l'affichage doit s'y rendre.
   *
   * Le bornage évite un effet déroutant près des angles — viser le coin ne doit
   * pas faire apparaître de bande vide à côté de la photo.
   */
  const seekTo = useCallback(
    (center: Point) => {
      setOffset(
        clampOffset(offsetForCenter(center, displayed, scaleRef.current), scaleRef.current),
      );
    },
    [clampOffset, displayed],
  );

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

  /**
   * Un seul téléchargement de la variante `hd`, quelle que soit sa cause. Le
   * drapeau vit dans une ref et non dans un état : deux déclencheurs qui se
   * suivent — un agrandissement pendant un pincement — tomberaient tous deux
   * avant le rendu suivant et demanderaient deux fois le même fichier.
   */
  const hdRequestedRef = useRef(false);

  /**
   * Bascule sur la variante haute résolution, une fois pour toutes.
   *
   * Le rendu `full` suffit tant qu'on regarde la photo ajustée au cadre, et
   * `hd` pèse le double : rien n'est téléchargé avant que ses pixels manquent
   * vraiment. Une fois en place il y reste — revenir à `full` au retour au
   * cadrage ferait clignoter l'image à chaque aller-retour.
   */
  const requestHd = useCallback((): void => {
    if (!canZoom || hdRequestedRef.current) return;
    hdRequestedRef.current = true;

    const image = new Image();
    // Chargé et décodé hors écran : le passage à la haute résolution se fait
    // sur une image prête, sans à-coup visible. Sa largeur réelle est relevée
    // ici : c'est la seule mesure qui remplace l'estimation du plafond serveur.
    image.onload = () => {
      setRenderedWidth(image.naturalWidth);
      setHdReady(true);
    };
    // Un échec réseau ne condamne pas le zoom pour toute la durée de la photo :
    // le déclencheur suivant retentera.
    image.onerror = () => {
      hdRequestedRef.current = false;
    };
    image.src = hdSrc;
  }, [canZoom, hdSrc]);

  // Premier agrandissement dans la visionneuse.
  useEffect(() => {
    if (scale > 1 + FIT_EPSILON) requestHd();
  }, [scale, requestHd]);

  /**
   * Pincement natif de la page, le geste de zoom spontané sur téléphone.
   *
   * Aucun geste maison ne l'intercepte : il entrerait en conflit avec le
   * balayage de navigation, et le système le fait mieux. Mais le navigateur
   * re-rasterise alors la page à partir du rendu `full` (2560 px) — au-delà de
   * ~2× la photo devient molle alors que `hd` détient les pixels manquants.
   * Les charger dès que l'échelle visuelle décolle rend le pincement net sans
   * rien demander de plus à l'utilisateur.
   */
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport || !canZoom || hdReady) return;

    const onViewportChange = (): void => {
      if (viewport.scale > 1) requestHd();
    };

    // La page peut déjà être pincée à l'ouverture de la photo : aucun événement
    // ne viendrait le dire, seule l'échelle courante en témoigne.
    onViewportChange();
    // Les moteurs ne signalent pas le pincement de la même façon : le
    // changement d'échelle passe par `resize`, le déplacement à l'intérieur
    // d'une page déjà pincée par `scroll`. Les deux, donc.
    viewport.addEventListener('resize', onViewportChange);
    viewport.addEventListener('scroll', onViewportChange);
    return () => {
      viewport.removeEventListener('resize', onViewportChange);
      viewport.removeEventListener('scroll', onViewportChange);
    };
  }, [canZoom, hdReady, requestHd]);

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

  /**
   * Bascule entre cadrage écran et zoom, au point visé.
   *
   * Le repère est celui du conteneur, comme pour la molette : à l'échelle 1
   * l'image y est centrée, les deux centres coïncident.
   */
  const toggleZoomAt = (point: Point): void => {
    const element = containerRef.current;
    if (!canZoom || !element) return;

    if (scaleRef.current > 1 + FIT_EPSILON) {
      applyScale(1);
      onZoomedChange(false);
      return;
    }

    // Agrandit à l'endroit cliqué plutôt qu'au centre : on zoome sur ce qu'on
    // regarde, pas sur le milieu de la photo.
    const rect = element.getBoundingClientRect();
    applyScale(pixelScale, {
      x: point.x - rect.left - rect.width / 2,
      y: point.y - rect.top - rect.height / 2,
    });
    onZoomedChange(true);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;

    if (scale > 1 + FIT_EPSILON) {
      // La capture garantit de recevoir le relâchement même si le pointeur
      // quitte le cadre en cours de déplacement.
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    gestureRef.current = {
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      panFrom: { x: event.clientX - offset.x, y: event.clientY - offset.y },
      panning: false,
      // La capture ne prend effet qu'à l'événement suivant : ici, la cible est
      // encore l'élément réellement sous le pointeur.
      onImage: event.target === imageRef.current,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (scale <= 1 + FIT_EPSILON) return;

    gesture.panning = true;
    setOffset(
      clampOffset(
        { x: event.clientX - gesture.panFrom.x, y: event.clientY - gesture.panFrom.y },
        scale,
      ),
    );
  };

  /**
   * Fin du geste, et seul endroit où se décide le clic.
   *
   * Ce n'est pas un `onClick` sur l'image parce que, dès qu'elle est agrandie,
   * le conteneur capture le pointeur pour suivre le déplacement : le navigateur
   * adresse alors le `click` au capteur et non à l'image, si bien qu'il
   * n'atteignait jamais son gestionnaire — il fallait Échap pour revenir au
   * cadrage. Décider ici rend la même décision, quelle que soit la capture.
   */
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    // Effacé avant tout changement d'échelle : le rendu qui suit doit retrouver
    // la transition, sinon le retour au cadrage serait instantané et sec.
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    // Le fond du cadre n'est pas la photo : y relâcher ne bascule rien, pas plus
    // qu'avant. Seule la photo réagit au clic.
    if (!gesture.onImage) return;
    if (!isTap(gesture.origin, { x: event.clientX, y: event.clientY })) return;
    toggleZoomAt({ x: event.clientX, y: event.clientY });
  };

  // Geste interrompu par le navigateur — deuxième doigt, retour arrière par bord
  // d'écran : ni clic ni déplacement retenus, la capture est relâchée d'office.
  const onPointerCancel = (): void => {
    gestureRef.current = null;
  };

  const isZoomed = scale > 1 + FIT_EPSILON;

  // Aperçu, indicateur et message d'échec sont décidés ensemble : c'est leur
  // combinaison qui doit rester juste, pas chacun pris isolément.
  const overlay = previewOverlay({ loaded, failed, measured: displayed.width > 0 });

  return (
    <div
      ref={containerRef}
      className="relative flex size-full items-center justify-center overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={(event) => event.preventDefault()}
    >
      {/* Aperçu : la vignette est déjà en cache navigateur puisqu'elle vient
          d'être affichée dans la grille. Elle occupe l'espace exact du rendu
          final le temps que celui-ci arrive — quelques secondes quand la photo
          doit encore être téléchargée depuis Drive.

          Le flou reste mesuré : il masque la pixellisation de l'agrandissement,
          mais assez léger pour qu'on reconnaisse la photo et qu'on comprenne
          qu'elle se précise, au lieu d'y voir un rendu raté. */}
      {overlay.placeholder && (
        <img
          src={placeholderSrc}
          alt=""
          aria-hidden="true"
          className="absolute blur-md"
          style={{ width: displayed.width, height: displayed.height }}
        />
      )}

      {/* Sans cet indicateur, l'aperçu flou ne se lit pas comme une attente :
          on croit que la photo elle-même est floue. C'est exactement ce qui
          avait été rapporté comme « ouverture toute floue, aléatoirement ». */}
      {overlay.spinner && (
        <span
          role="status"
          aria-label="Chargement de la photo"
          className="absolute flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-ink-100"
        >
          <span
            className="size-3.5 animate-spin rounded-full border-2 border-ink-600 border-t-accent"
            aria-hidden="true"
          />
          Chargement…
        </span>
      )}

      <img
        ref={imageRef}
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
        className={`relative max-h-full max-w-full object-contain select-none ${
          loaded ? '' : 'opacity-0'
        } ${isZoomed ? 'cursor-grab active:cursor-grabbing' : canZoom ? 'cursor-zoom-in' : ''}`}
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
          // Aucune transition pendant le glisser : le déplacement doit coller
          // au curseur, pas le suivre avec du retard.
          transition: gestureRef.current?.panning ? 'none' : 'transform 120ms ease-out',
        }}
      />

      {isZoomed && displayed.width > 0 && (
        <Minimap
          displayed={displayed}
          container={container}
          scale={scale}
          offset={offset}
          src={placeholderSrc}
          onSeek={seekTo}
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

      {overlay.error && (
        <p className="text-sm text-ink-400">Cette image n'a pas pu être affichée.</p>
      )}
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
  onSeek,
}: {
  displayed: Box;
  container: Box;
  scale: number;
  offset: Point;
  src: string;
  /** Reçoit le point visé, en fractions `[0, 1]` de l'image. */
  onSeek: (center: Point) => void;
}): ReactElement {
  const MAX_EDGE = 132;
  const ratio = Math.min(MAX_EDGE / displayed.width, MAX_EDGE / displayed.height);
  const width = displayed.width * ratio;
  const height = displayed.height * ratio;

  const dragging = useRef(false);

  const viewWidth = visibleFraction(displayed.width, container.width, scale);
  const viewHeight = visibleFraction(displayed.height, container.height, scale);
  const center = viewCenter(offset, displayed, scale);

  /** Point sous le curseur, ramené en fractions de l'image. */
  const seekFromEvent = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek({
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    });
  };

  return (
    <div
      className="absolute right-4 bottom-4 cursor-crosshair overflow-hidden rounded border border-white/25 shadow-lg transition-colors hover:border-white/60"
      style={{ width, height }}
      role="img"
      aria-label="Repère de position : cliquer ou glisser pour se déplacer dans la photo"
      onPointerDown={(event) => {
        // Sans cette interruption, le conteneur démarrerait en plus son propre
        // déplacement : l'image partirait dans le sens du glissement pendant
        // que le repère la ramène ailleurs.
        event.stopPropagation();
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true;
        seekFromEvent(event);
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        event.stopPropagation();
        seekFromEvent(event);
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      // Ce qui protège réellement le repère est le `stopPropagation` de son
      // `onPointerDown` ci-dessus : sans lui, le conteneur armerait son geste et
      // basculerait le zoom au relâchement. Ces deux gardes-ci ne coûtent rien
      // et couvrent le double-clic, que le navigateur émet encore.
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <img src={src} alt="" draggable={false} className="size-full object-cover opacity-60" />
      <span
        className="pointer-events-none absolute border-2 border-white/90 bg-white/10"
        style={{
          width: `${viewWidth * 100}%`,
          height: `${viewHeight * 100}%`,
          left: `${(center.x - viewWidth / 2) * 100}%`,
          top: `${(center.y - viewHeight / 2) * 100}%`,
        }}
      />
    </div>
  );
}
