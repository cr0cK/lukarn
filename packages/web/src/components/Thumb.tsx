import { THUMB_SIZES, type ShareItem, type ThumbSize } from '@lukarn/shared';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { mediaUrl, type Scope } from '../api/client';
import { formatDuration } from '../lib/format';
import { useT } from '../lib/i18n';
import { releaseIfDetached } from '../lib/imageRelease';
import { MEDIA_ID_ATTRIBUTE } from '../lib/viewTransition';

/**
 * Smallest variant covering the actual display size, including screen density.
 * Always requesting 1280 would saturate bandwidth on a grid of 200 thumbnails.
 */
/**
 * Retry count and timing for a failed thumbnail.
 *
 * Two are enough: they cover temporary saturation on a cold grid without turning
 * a real failure into a loop. The delay doubles and a random component spreads
 * it — thirty thumbnails failing together must not restart together.
 */
const THUMB_RETRY_ATTEMPTS = 2;
const THUMB_RETRY_BASE_MS = 800;
const THUMB_RETRY_JITTER_MS = 600;

export function pickThumbSize(displayWidth: number, dpr = window.devicePixelRatio || 1): ThumbSize {
  const needed = displayWidth * Math.min(dpr, 2);
  return THUMB_SIZES.find((size) => size >= needed) ?? THUMB_SIZES[THUMB_SIZES.length - 1]!;
}

interface ThumbProps {
  item: ShareItem;
  width: number;
  height: number;
  scope?: Scope;
  /** `true` for the thumbnail beneath the keyboard cursor. */
  selected?: boolean;
  onOpen: () => void;
  /** Immediate loading for the first rows, deferred for the rest. */
  eager?: boolean;
}

export function Thumb({
  item,
  width,
  height,
  scope,
  selected = false,
  onOpen,
  eager = false,
}: ThumbProps): ReactElement {
  const t = useT();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Incremented on every retry; used as `key` to remount the `<img>`. */
  const [attempt, setAttempt] = useState(0);
  const image = useRef<HTMLImageElement>(null);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Capture the node when the effect runs: by cleanup, React has already reset
  // the ref to `null`. `attempt` is a dependency because a retry remounts the
  // `<img>`: without it, the old detached node would be released while the new
  // one continued its request.
  useEffect(() => {
    const node = image.current;
    return () => releaseIfDetached(node);
  }, [attempt]);

  useEffect(() => () => clearTimeout(retry.current), []);

  /**
   * A thumbnail failure is usually **temporary**: Drive rate-limits, the line
   * saturates and the server returns 503. Giving up after the first refusal would
   * leave an empty tile until the next page load even though the following
   * second would have succeeded.
   *
   * The delay is **jittered**: a cold grid fails in batches, and synchronised
   * retries would all saturate the same six connections again. After the final
   * attempt, the plain tile remains — this is then a real failure, better shown
   * than looped.
   */
  const onError = (): void => {
    if (attempt >= THUMB_RETRY_ATTEMPTS) {
      setFailed(true);
      return;
    }
    const wait = THUMB_RETRY_BASE_MS * 2 ** attempt + Math.random() * THUMB_RETRY_JITTER_MS;
    retry.current = setTimeout(() => setAttempt((value) => value + 1), wait);
  };

  const isVideo = item.kind === 'video';
  const duration = formatDuration(item.durationMs);
  /**
   * A video has a preview when Drive produces one (D92) — `hasPreview` says so,
   * and that is the only question the tile asks: the photo/video rule is decided
   * server-side. Without a preview, or after three failures, the plain tile remains.
   */
  const showImage = item.hasPreview && !failed;

  return (
    <button
      type="button"
      onClick={onOpen}
      // The tile the viewer grows out of is found by this attribute rather than
      // by a ref: the grid is virtualised, and a ref per cell would have to
      // survive the rows being unmounted while scrolling.
      {...{ [MEDIA_ID_ATTRIBUTE]: item.id }}
      // Arrow keys navigate on the container: remove thumbnails from tab order
      // to avoid duplicating the keyboard path.
      tabIndex={-1}
      aria-label={item.name}
      className={`group absolute overflow-hidden bg-ink-850 transition-[outline-color] ${
        selected ? 'outline outline-2 outline-offset-2 outline-accent' : 'outline-none'
      }`}
      style={{ width, height, transform: 'translateZ(0)' }}
    >
      {showImage && (
        <img
          // Remounting the element restarts the request: the URL does not change,
          // and because a 503 has no cache header the browser returns to the server.
          key={attempt}
          ref={image}
          src={mediaUrl.thumb(item.id, pickThumbSize(width), item.version, scope)}
          alt=""
          width={width}
          height={height}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          // The layout has already reserved the size: the thumbnail merely fills
          // its slot without ever moving neighbours.
          className={`size-full object-cover ${loaded ? 'fade-in' : 'opacity-0'}`}
          onLoad={() => setLoaded(true)}
          onError={onError}
        />
      )}

      {/* Video without a Drive preview, or whose thumbnail failed: retain the
          previous plain background, with the play badge as the only mark. */}
      {isVideo && !showImage && <div className="size-full bg-ink-800" />}

      {failed && !isVideo && (
        <div className="flex size-full items-center justify-center px-2 text-center text-[11px] text-ink-400">
          {t('thumb.unavailable')}
        </div>
      )}

      {/* Place the badge **over** the preview: it distinguishes video from photo
          at a glance, and the dark disc keeps it readable on a light image. The
          triangle is offset by one pixel because geometric centring makes it
          appear to lean left. */}
      {isVideo && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-black/45">
            <svg
              viewBox="0 0 24 24"
              className="size-5 translate-x-px text-white"
              fill="currentColor"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>
      )}

      {duration && (
        <span className="pointer-events-none absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
          {duration}
        </span>
      )}

      <span className="pointer-events-none absolute inset-0 bg-white/0 transition-colors group-hover:bg-white/8" />
    </button>
  );
}
