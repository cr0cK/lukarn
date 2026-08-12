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
import { useT } from '../lib/i18n';
import { previewOverlay } from '../lib/preview';
import { releaseIfDetached } from '../lib/imageRelease';

/** Beyond this, only sensor grain remains visible. */
const MAX_SCALE = 8;
/** Below this difference, zoom is inactive (rounding tolerance). */
const FIT_EPSILON = 0.01;
const WHEEL_SENSITIVITY = 0.0015;

interface ZoomableImageProps {
  /** Full-screen render (2560 px), displayed immediately. */
  src: string;
  /**
   * High-resolution render (4096 px), loaded only on first enlargement — from
   * the viewer or the page's native pinch.
   */
  hdSrc: string;
  /** Thumbnail already in browser cache, displayed while `src` loads. */
  placeholderSrc: string;
  alt: string;
  /**
   * Original file dimensions from the index. They cap zoom but do not determine
   * it: the served render may contain fewer pixels.
   */
  naturalWidth: number | null;
  naturalHeight: number | null;
  /** Controlled from the viewer (`z` key). */
  zoomed: boolean;
  onZoomedChange: (zoomed: boolean) => void;
}

interface Box {
  width: number;
  height: number;
}

/** Image size once fitted in the frame, without enlargement. */
function fitInside(image: Box, container: Box): Box {
  if (image.width <= 0 || image.height <= 0 || container.width <= 0 || container.height <= 0) {
    return { width: 0, height: 0 };
  }
  const ratio = Math.min(container.width / image.width, container.height / image.height, 1);
  return { width: image.width * ratio, height: image.height * ratio };
}

/**
 * Zoomable viewer image.
 *
 * Zoom examines a photo rather than enlarging what is already displayed: a
 * simple `scale()` on the full-screen render (capped at 2560 px) would merely
 * stretch rasterised pixels. On first enlargement, switch to the `hd` variant
 * (4096 px), which contains detail lost by the screen render — whether the
 * enlargement comes from the viewer or the page's native pinch, where the
 * browser rasterises from the same screen pixels.
 *
 * Scale 1 is the image fitted to the frame; "100%" scale (`pixelScale`) is where
 * one pixel in the available render occupies one screen pixel — not the original
 * file dimensions, which the `hd` render does not always reach. Pan is bounded
 * so the image can never leave the frame.
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
}: ZoomableImageProps): ReactElement {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [container, setContainer] = useState<Box>({ width: 0, height: 0 });
  const [intrinsic, setIntrinsic] = useState<Box>({
    width: naturalWidth ?? 0,
    height: naturalHeight ?? 0,
  });
  /**
   * Width of the render actually loaded, measured on the element. The server
   * caps the longest `hd` side: without this measurement, a 6000 px photo would
   * show "100%" while only 4096 pixels are available to paint.
   */
  const [renderedWidth, setRenderedWidth] = useState(0);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [hdReady, setHdReady] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * Active pointer gesture. It serves two purposes: panning the enlarged image
   * and deciding on release whether the pointer selected a point — a click — or
   * moved the image.
   */
  const gestureRef = useRef<{
    pointerId: number;
    /** Position on press, the reference for deciding click or drag. */
    origin: Point;
    /** Pointer position minus current offset: the basis for movement. */
    panFrom: Point;
    /** True once the image has moved beneath the pointer; disables transition. */
    panning: boolean;
    /** Whether the gesture began on the photo rather than the frame background. */
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
   * Scale where one render pixel occupies one screen pixel. This is the `z` key
   * target: the first useful level, and often the only one wanted.
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

  /** Maximum pan before the frame extends beyond the image. */
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
   * Current scale and framing read without creating a dependency. Calculate
   * updates from these values rather than inside a state updater: a `setState`
   * triggered from another updater is a side effect React does not run reliably.
   */
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);
  scaleRef.current = scale;
  offsetRef.current = offset;

  /**
   * Brings a point in the photo to the centre of the window. The position
   * indicator uses it: clicking or dragging there selects a location in the
   * image, and the display must move to it.
   *
   * Bounds avoid a confusing effect near corners — aiming at one must not reveal
   * an empty band beside the photo.
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

      // Anchor zoom on the target point: detail beneath the pointer must not move
      // away during enlargement.
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

  // React to viewer intent (`z` key) without rerunning on every wheel step, which
  // would immediately return the image to native scale.
  useEffect(() => {
    if (zoomed && scaleRef.current <= 1 + FIT_EPSILON) applyScale(pixelScale);
    else if (!zoomed && scaleRef.current > 1 + FIT_EPSILON) applyScale(1);
  }, [zoomed, pixelScale, applyScale]);

  /**
   * Download the `hd` variant once regardless of cause. Keep the flag in a ref,
   * not state: two consecutive triggers — an enlargement during a pinch — could
   * both occur before the next render and request the same file twice.
   */
  const hdRequestedRef = useRef(false);

  /**
   * Switches to the high-resolution variant once and for all.
   *
   * The `full` render is enough while the photo is fitted to the frame, while
   * `hd` weighs twice as much: download nothing until its pixels are genuinely
   * needed. Once in place it stays — returning to `full` when fitted would flash
   * the image on every round trip.
   */
  /** The downloading `hd` render, so it can be aborted when leaving the photo. */
  const hdImageRef = useRef<HTMLImageElement | null>(null);

  const requestHd = useCallback((): void => {
    if (!canZoom || hdRequestedRef.current) return;
    hdRequestedRef.current = true;

    const image = new Image();
    hdImageRef.current = image;
    // Load and decode off-screen so switching to high resolution uses a ready
    // image without a visible jolt. Record its actual width here: this is the
    // only measurement replacing the estimated server cap.
    image.onload = () => {
      setRenderedWidth(image.naturalWidth);
      setHdReady(true);
    };
    // A network failure must not disable zoom for the lifetime of the photo: the
    // next trigger retries.
    image.onerror = () => {
      hdRequestedRef.current = false;
    };
    image.src = hdSrc;
  }, [canZoom, hdSrc]);

  // First enlargement in the viewer.
  useEffect(() => {
    if (scale > 1 + FIT_EPSILON) requestHd();
  }, [scale, requestHd]);

  /**
   * Aborts renders for the photo just left.
   *
   * The viewer remounts this component for every photo (`key={item.id}`), and
   * removing an `<img>` from the DOM **does not stop** its request: the browser
   * completes a megabyte `full` nobody awaits. Measured after moving through
   * twenty-five photos with arrows and closing — twenty-four `full` requests
   * still running, sixty grid thumbnails queued behind them on the six
   * connections of an HTTP/1.1 origin and therefore black for thirty seconds.
   * This matches what the grid already does for thumbnails.
   *
   * Abort `hd` too, though rarer: it starts only on zoom but weighs twice as much,
   * and leaving just after enlargement is exactly what happens when the photo
   * was not worth a closer look.
   */
  useEffect(() => {
    const node = imageRef.current;
    return () => {
      releaseIfDetached(node);
      hdImageRef.current?.removeAttribute('src');
    };
  }, [src]);

  /**
   * Native page pinch, the natural zoom gesture on a phone.
   *
   * No custom gesture intercepts it: that would conflict with navigation swipe,
   * and the system handles it better. But the browser then rasterises the page
   * again from the `full` render (2560 px) — beyond ~2× the photo softens while
   * `hd` holds the missing pixels. Loading them as visual scale rises keeps the
   * pinch sharp without further action from the user.
   */
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport || !canZoom || hdReady) return;

    const onViewportChange = (): void => {
      if (viewport.scale > 1) requestHd();
    };

    // The page may already be pinched when the photo opens: no event would report
    // it, only current scale reveals it.
    onViewportChange();
    // Engines report pinch differently: scale changes through `resize`, movement
    // within an already pinched page through `scroll`. Listen to both.
    viewport.addEventListener('resize', onViewportChange);
    viewport.addEventListener('scroll', onViewportChange);
    return () => {
      viewport.removeEventListener('resize', onViewportChange);
      viewport.removeEventListener('scroll', onViewportChange);
    };
  }, [canZoom, hdReady, requestHd]);

  /**
   * Wheel zoom.
   *
   * Register the listener manually with `passive: false`: React registers `wheel`
   * handlers as passive, making `preventDefault()` ineffective and allowing the
   * browser to scroll or zoom over the viewer.
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

      // Exponential progression: each step multiplies scale, giving the same feel
      // near the initial framing and at maximum zoom.
      const next = scaleRef.current * Math.exp(-event.deltaY * WHEEL_SENSITIVITY);
      applyScale(next, focus);
      onZoomedChange(next > 1 + FIT_EPSILON);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [canZoom, applyScale, onZoomedChange]);

  /**
   * Toggles between fitted view and zoom at the target point.
   *
   * Coordinates belong to the container as with the wheel: at scale 1 the image
   * is centred there, so both centres coincide.
   */
  const toggleZoomAt = (point: Point): void => {
    const element = containerRef.current;
    if (!canZoom || !element) return;

    if (scaleRef.current > 1 + FIT_EPSILON) {
      applyScale(1);
      onZoomedChange(false);
      return;
    }

    // Enlarge at the clicked location rather than the centre: zoom into what is
    // being viewed, not the middle of the photo.
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
      // Capture guarantees receiving release even if the pointer leaves the frame
      // during movement.
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    gestureRef.current = {
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      panFrom: { x: event.clientX - offset.x, y: event.clientY - offset.y },
      panning: false,
      // Capture takes effect only on the next event: here the target is still the
      // element actually beneath the pointer.
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
   * End of the gesture and the only place where a click is decided.
   *
   * This is not an image `onClick` because once enlarged, the container captures
   * the pointer to follow movement: the browser then sends `click` to the
   * capturer, not the image, so its handler never ran — Escape was required to
   * return to fitted view. Deciding here works regardless of capture.
   */
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    // Clear before any scale change: the following render must restore transition,
    // or returning to fitted view would be instant and abrupt.
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    // The frame background is not the photo: releasing there toggles nothing,
    // just as before. Only the photo responds to a click.
    if (!gesture.onImage) return;
    if (!isTap(gesture.origin, { x: event.clientX, y: event.clientY })) return;
    toggleZoomAt({ x: event.clientX, y: event.clientY });
  };

  // Gesture interrupted by the browser — second finger or edge-swipe back:
  // retain neither click nor movement; capture is released automatically.
  const onPointerCancel = (): void => {
    gestureRef.current = null;
  };

  const isZoomed = scale > 1 + FIT_EPSILON;

  // Decide preview, indicator and failure message together: their combination
  // must remain correct, not each one in isolation.
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
      {/* Preview: the thumbnail is already in browser cache after being displayed
          in the grid. It occupies the final render's exact space until it arrives
          — a few seconds when the photo still needs downloading from Drive.

          Keep blur measured: it masks enlargement pixelation but remains light
          enough to recognise the photo and see it sharpening rather than mistake
          it for a failed render. */}
      {overlay.placeholder && (
        <img
          src={placeholderSrc}
          alt=""
          aria-hidden="true"
          className="absolute blur-md"
          style={{ width: displayed.width, height: displayed.height }}
        />
      )}

      {/* Without this indicator, a blurred preview does not read as waiting: the
          photo itself appears blurred. This was exactly reported as "sometimes
          opening completely blurred". */}
      {overlay.spinner && (
        <span
          role="status"
          aria-label={t('zoom.loadingPhoto')}
          className="absolute flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-ink-100"
        >
          <span
            className="size-3.5 animate-spin rounded-full border-2 border-ink-600 border-t-accent"
            aria-hidden="true"
          />
          {t('common.loading')}
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
          setRenderedWidth(image.naturalWidth);
          // Fall back when the index does not know file dimensions: use those of
          // the received render. Zoom will be more limited but still present.
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
          // No transition while dragging: movement must stick to the pointer, not
          // follow it with delay.
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
          {/* State that the served render is smaller than the file: otherwise
              "100%" on a 6000 px photo would imply viewing its pixels when only
              4096 are available. */}
          {limited && ` · ${t('zoom.limited', availableWidth, naturalWidth ?? 0)}`}
          {!hdReady && ` · ${t('zoom.loadingHd')}`}
        </span>
      )}

      {overlay.error && <p className="text-sm text-ink-400">{t('zoom.failed')}</p>}
    </div>
  );
}

/**
 * Position indicator while zooming: the whole photo reduced, with a frame around
 * the visible area. Without it, orientation is lost as soon as the enlarged
 * image is panned.
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
  /** Receives the target point as image fractions `[0, 1]`. */
  onSeek: (center: Point) => void;
}): ReactElement {
  const t = useT();
  const MAX_EDGE = 132;
  const ratio = Math.min(MAX_EDGE / displayed.width, MAX_EDGE / displayed.height);
  const width = displayed.width * ratio;
  const height = displayed.height * ratio;

  const dragging = useRef(false);

  const viewWidth = visibleFraction(displayed.width, container.width, scale);
  const viewHeight = visibleFraction(displayed.height, container.height, scale);
  const center = viewCenter(offset, displayed, scale);

  /** Point beneath the pointer, converted to image fractions. */
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
      aria-label={t('zoom.locator')}
      onPointerDown={(event) => {
        // Without this stop, the container would also start its own movement: the
        // image would follow the drag while the indicator sent it elsewhere.
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
      // The indicator is actually protected by `stopPropagation` in its
      // `onPointerDown` above: without it, the container would arm its gesture
      // and toggle zoom on release. These two guards cost nothing and cover the
      // double-click the browser still emits.
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
