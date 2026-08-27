import type { AlbumDay, ShareItem } from '@lukarn/shared';
import {
  type ReactElement,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { errorText, mediaUrl, type Scope } from '../api/client';
import { useCommentCounts, useMediaDetail, useUpdateAlbum } from '../api/hooks';
import { useCaptionHidden } from '../lib/caption';
import { useT, type Translate } from '../lib/i18n';
import { dayKey, dayLabel } from '../lib/justify';
import { unreadCount, useSeenComments } from '../lib/seenComments';
import { isTyping } from '../lib/typing';
import { GUTTER_PX } from '../lib/swipeTrack';
import { COARSE_POINTER_QUERY, PHONE_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import { placeLabelOf } from '../lib/useGridLayout';
import { SETTLE_EASING, useSwipeTrack } from '../lib/useSwipe';
import { canPlayVideoType, chooseVideoSource } from '../lib/videoSource';
import { SHARED_MEDIA } from '../lib/viewTransition';
import { ActionMenu } from './ActionMenu';
import { MediaCaption } from './MediaCaption';
import { Sheet, type SheetStop } from './Sheet';
import { PanelBody, SidePanel, type PanelTab } from './SidePanel';
import { ZoomableImage } from './ZoomableImage';

/**
 * Photos preloaded in the navigation direction and the other way. Keep the
 * total modest: each render missing from the server cache requires downloading
 * the original from Drive, and saturating the queue would slow the current photo.
 */
const PRELOAD_AHEAD = 4;
const PRELOAD_BEHIND = 1;

/**
 * Delay between attempts while a video's prepared version is unavailable.
 *
 * Twenty seconds because transcoding takes minutes and the queue handles one
 * video at a time: polling more often would not make it arrive sooner, while
 * polling less often would leave someone facing a message after the file had
 * been ready for a minute.
 */
const PLAYABLE_RETRY_MS = 20_000;

/**
 * The viewer's sheet, below `md`: the toolbar at rest, the panel pulled up.
 *
 * The resting stop is `'auto'` — one row of controls, measured, because what the
 * photo *says* moved up into the header (D260814e) and only what acts on it is
 * left down here.
 *
 * `0.85` and not `1`: a strip of photo stays visible above the panel, which is
 * what says the photo is still there and that the sheet can be pushed back down.
 * A full-height panel is a page, and a page needs a Back button.
 */
const VIEWER_SHEET_STOPS: readonly SheetStop[] = ['auto', 0.85];

/**
 * The same sheet for a **video**, which has no resting stop.
 *
 * Native playback controls live at the bottom of the element, and a caption
 * resting there would cover play, pause and the progress bar — the reason the
 * caption already pushes instead of overlaying on video. So on a video the
 * caption stays in the flow as it is, and the sheet carries the panel alone.
 */
const VIDEO_SHEET_STOPS: readonly SheetStop[] = [0.85];

interface LightboxProps {
  /**
   * Where the photographs and their threads come from: an album, or a share link.
   * The viewer never learns which — everything it asks for goes through this
   * (D260825e).
   */
  scope: Scope;
  /**
   * Album title at the start of the context trail. The viewer is a view in its
   * own right — a shared link can lead there without showing the grid — and
   * without the title the photo no longer says which album it comes from.
   */
  albumTitle: string;
  items: ShareItem[];
  index: number;
  /**
   * Album total, not `items.length`: the list grows page by page, so progress
   * calculated from it moved backwards on each load — "40 / 50" became
   * "40 / 100" while someone was browsing.
   */
  total: number;
  /** Annotated days, carrying day context into the image. */
  days: Map<string, AlbumDay>;
  /** Current album cover, to identify the photo already used as such. */
  coverId: string | null;
  /**
   * Administrator: only they can set the cover and describe a photo. One boolean
   * for both — these are the two affordances the viewer reserves for the
   * administrator, and two always-equal flags would eventually diverge.
   */
  isAdmin: boolean;
  /**
   * Open side-panel tab, `null` when closed. Controlled by the page because it
   * lives in the URL, allowing direct arrival at a conversation from the
   * activity drawer or an email.
   */
  panel: PanelTab | null;
  onPanelChange: (panel: PanelTab | null) => void;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Called near the end of the list to load the next page. */
  onNeedMore: () => void;
}

/**
 * Full-screen viewer.
 *
 * Fully keyboard-controlled; the mouse is only a shortcut. Adjacent media are
 * preloaded so ←/→ continues without a black screen, and page scrolling is
 * frozen while open.
 *
 * The header **locates** the photo — album, day and place; the bottom bar
 * (`MediaCaption`) **tells its story** — what someone wrote about it and its day,
 * at every width. The exact timestamp remains in the `i` panel with the filename.
 */
export function Lightbox({
  scope,
  albumTitle,
  items,
  index,
  total,
  days,
  coverId,
  isAdmin,
  panel,
  onPanelChange,
  onIndexChange,
  onClose,
  onNeedMore,
}: LightboxProps): ReactElement | null {
  const t = useT();
  const item = items[index];
  const isVideo = item?.kind === 'video';
  /**
   * Video source. The actual codec decides: this browser uses the server-prepared
   * version, while another that decodes HEVC — Safari or an iPhone — keeps the
   * full-quality original (D6).
   *
   * Detection from D98 remains the safeguard behind this choice, not only for
   * videos without a known codec: a browser claiming to support a format but
   * failing to play it still reaches that path.
   */
  const transcoded =
    isVideo && chooseVideoSource(item?.videoCodec ?? null, canPlayVideoType) === 'transcoded';
  const [zoomed, setZoomed] = useState(false);
  /**
   * Playback failure. Video-specific: photos hold their own failure in
   * `ZoomableImage`. Without this state, a video that never arrives — Drive
   * unavailable, token revoked or an unsupported codec — would leave the
   * `poster` displayed, which looks like a frozen image (D79, D98).
   */
  const [failed, setFailed] = useState(false);
  /** Direction of the latest move, used to orient preloading. */
  const [direction, setDirection] = useState(1);
  /**
   * Caption bar. Hiding is a display setting retained between visits; editor
   * opening is controlled here because the viewer listens for `Escape`.
   */
  const { hidden: captionHidden, setHidden: setCaptionHidden } = useCaptionHidden();
  const [editingCaption, setEditingCaption] = useState(false);
  /**
   * Hidden chrome: no header or arrows, only the photo.
   *
   * Separate from hiding the caption, with non-overlapping scopes: `l` puts away
   * bottom text, while `h` hides everything the viewer places over the image.
   * The state follows the viewing session rather than the photo, but unlike the
   * caption it is not retained between visits: reopening without a single cue
   * would leave anyone who forgot the shortcut facing a silent image.
   *
   * **It starts hidden on a touch screen.** A phone opening a photo should show
   * the photo, as every native viewer does; the header, arrows and caption are
   * one tap away and the eye button in the corner is the affordance that says
   * so. With a cursor the chrome stays: hover already names every control, the
   * arrows are how a mouse navigates, and there is no screen edge to reclaim.
   */
  const [bare, setBare] = useState(() => window.matchMedia(COARSE_POINTER_QUERY).matches);
  const phone = useMediaQuery(PHONE_QUERY);
  const coarse = useMediaQuery(COARSE_POINTER_QUERY);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  /**
   * Loaded as soon as a photo is displayed, not only when the panel opens.
   *
   * Two reasons. The "Info" panel then opens with its rows already present
   * instead of a spinner for an unanticipated round trip. This request also
   * counts the photo as opened (D260809h): tied to the panel, telemetry would
   * measure opened panels while claiming to count viewed photos.
   *
   * The cost is one request per photo actually displayed — D21's asymmetric
   * preloading covers images, not detail, so neighbours are not requested.
   * Beside rendering the image itself, two indexed reads are negligible.
   */
  const { data: detail } = useMediaDetail(scope, item ? item.id : null);

  // The album a caption would be written in, absent when a link is showing this
  // photograph. `MediaCaption` folds it into its own permission rather than taking
  // an administrator's word for it.
  const albumId = scope.kind === 'album' ? scope.albumId : null;

  const setCover = useUpdateAlbum();
  // Do not carry failure to the next photo: the message would refer to an image
  // unrelated to the action that failed.
  const resetCoverError = setCover.reset;
  useEffect(() => resetCoverError(), [index, resetCoverError]);

  /**
   * "Comments" button badge. The total comes from one album-wide call and the
   * browser reading marker: see `lib/seenComments.ts`.
   */
  const { data: commentCounts } = useCommentCounts(scope);
  const { seen, markSeen } = useSeenComments(scope);
  const mediaId = item?.id;
  const mediaVersion = item?.version;
  // A link has no album-wide counts to ask for, so the count travelling with this
  // photograph's detail stands in. One number per photograph opened rather than one
  // per album, which is the whole reason the album path asks for them in bulk.
  const commentTotal =
    (mediaId === undefined ? undefined : commentCounts?.counts[mediaId]) ??
    detail?.commentCount ??
    0;
  const unread = unreadCount(commentTotal, mediaId ? seen[mediaId] : 0);

  /**
   * Watches for the prepared version and restores the player when it arrives.
   *
   * Without this, the waiting message would remain until the photo was reopened.
   * Preparation is anticipated and eventually completes (D6), but nobody
   * waiting there would know — precisely the person who wanted this video.
   *
   * Request **one byte with `Range`** instead of reloading the element: it would
   * flash on every attempt — poster, then message — for the same response. The
   * 404 appears in the console either way because browsers log every rejected
   * request; that is the only noise and says exactly what is happening. Setting
   * `failed` back to false remounts the element, whose `autoPlay` continues alone.
   */
  useEffect(() => {
    if (!mediaId || !transcoded || !failed) return;

    const controller = new AbortController();
    const url = mediaUrl.playable(mediaId, mediaVersion, scope);

    const probe = async (): Promise<void> => {
      try {
        const response = await fetch(url, {
          headers: { Range: 'bytes=0-0' },
          signal: controller.signal,
        });
        if (response.ok) setFailed(false);
      } catch {
        // Interrupted attempt or disconnected network: the next one retries. A
        // polling failure must not replace the message with an error — nothing
        // is broken; the video is simply not ready yet.
      }
    };

    const timer = setInterval(() => void probe(), PLAYABLE_RETRY_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [mediaId, mediaVersion, transcoded, failed]);

  useEffect(() => {
    // Until counts arrive everything is zero: marking here would clear the
    // reading marker before reconstructing it incorrectly when real totals arrive.
    if (!mediaId || commentCounts === undefined) return;

    // An open panel counts as read. A total falling **below** the marker — through
    // deletion or moderation — must lower it too, or the next message would
    // remain invisible until it filled the gap.
    if (panel === 'comments' || commentTotal < (seen[mediaId] ?? 0)) {
      markSeen(mediaId, commentTotal);
    }
  }, [panel, mediaId, commentTotal, commentCounts, seen, markSeen]);

  /** Opens the panel on this tab, or closes it when already there. */
  const togglePanel = useCallback(
    (tab: PanelTab) => {
      onPanelChange(panel === tab ? null : tab);
    },
    [panel, onPanelChange],
  );

  /**
   * A click outside closes the panel like any drawer.
   *
   * Handle it during **capture**, not bubbling: `ZoomableImage` lower in the tree
   * decides zoom toggling on pointer release. During bubbling, both actions would
   * run together — the panel would close *and* the photo would zoom. Stopping on
   * pointer down reserves the first click for closing; the next zooms normally.
   *
   * Exclude buttons in this area. Navigation arrows live there, and treating
   * them as "outside" would close the panel on every photo, precisely what its
   * own column fixed. The zoom position indicator has `role="img"` and is also
   * excluded — it cannot defend itself because capture runs before its target.
   */
  const dismissPanelOnOutsideClick = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!panel) return;
      if ((event.target as HTMLElement).closest('button, [role="img"]')) return;
      onPanelChange(null);
      event.stopPropagation();
    },
    [panel, onPanelChange],
  );

  const goTo = useCallback(
    (next: number) => {
      // `Home` on the first media, `End` on the last or an arrow at an edge: the
      // requested index is already displayed. Without this guard, `setFailed(false)`
      // would clear an unplayable video's message with no replacement — nothing
      // remounts, so no playback event will restore it.
      if (next < 0 || next >= items.length || next === index) return;
      setDirection(next >= index ? 1 : -1);
      setZoomed(false);
      setFailed(false);
      // An editor left open would write to the photo just left: the field remounts
      // with the new photo, but the current action does not.
      setEditingCaption(false);
      onIndexChange(next);
    },
    [index, items.length, onIndexChange],
  );

  /**
   * A video whose image track this browser cannot decode. Sound plays, the
   * player believes it is running and nothing reports failure: this happens with
   * HEVC in Chromium, where the container and audio track are valid. Detecting
   * it requires inspecting what arrived rather than awaiting an error that will
   * never come (D98).
   */
  const checkVideoTrack = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    if (event.currentTarget.videoWidth === 0) setFailed(true);
  }, []);

  // Disable while zoomed, when a finger pans the image, and on videos, where it
  // would cross native playback controls.
  const swipe = useSwipeTrack({
    index,
    count: items.length,
    onNavigate: (towards) => goTo(index + towards),
    enabled: !zoomed && !isVideo,
  });

  // Freeze page scrolling behind the viewer — otherwise the wheel would scroll
  // the grid beneath the image.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // The container takes focus on opening to receive keys and returns it to the
  // grid on closing.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    containerRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  /**
   * Preloads adjacent photos so ←/→ continues without waiting.
   *
   * Preloading is asymmetric and follows navigation direction: someone moving
   * forwards almost always continues forwards. With the same number of requests,
   * looking further ahead than behind makes browsing much smoother, especially
   * because every initial render requires the server to download the original
   * from Drive.
   *
   * Request order is deliberate: nearest first, so the immediately adjacent
   * photo is not queued behind more distant neighbours.
   */
  useEffect(() => {
    const ahead = direction >= 0 ? PRELOAD_AHEAD : PRELOAD_BEHIND;
    const behind = direction >= 0 ? PRELOAD_BEHIND : PRELOAD_AHEAD;

    const targets: number[] = [];
    for (let distance = 1; distance <= Math.max(ahead, behind); distance++) {
      if (distance <= ahead) targets.push(index + distance);
      if (distance <= behind) targets.push(index - distance);
    }

    const pending = targets
      .map((position) => items[position])
      .filter((neighbour) => neighbour?.kind === 'photo')
      .map((neighbour) => {
        const image = new Image();
        image.src = mediaUrl.full(neighbour!.id, neighbour!.version, scope);
        return image;
      });

    return () => {
      // During fast navigation, abort obsolete downloads to free connections for
      // the photo actually displayed.
      for (const image of pending) image.src = '';
    };
  }, [index, items, direction, scope]);

  useEffect(() => {
    if (index >= items.length - PRELOAD_AHEAD - 2) onNeedMore();
  }, [index, items.length, onNeedMore]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current?.requestFullscreen?.().catch(() => {
        /* Rejected by the browser: the viewer remains in CSS full-screen mode. */
      });
    }
  }, []);

  const download = useCallback(() => {
    if (!item) return;
    // Use a synthetic anchor rather than window.open to avoid popup blocking and
    // let the browser manage download progress.
    const anchor = document.createElement('a');
    anchor.href = mediaUrl.download(item.id, item.version, scope);
    anchor.download = item.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [item, scope]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Allow browser shortcuts (Ctrl+R, Cmd+W…).
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // The comments panel contains an input. Without this guard, typing "info"
      // would move through photos and open the panel beneath the fingers. Escape
      // remains active: it is the exit and must also work from the field.
      if (event.key !== 'Escape' && isTyping(event.target)) return;

      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          // Escape unwinds the latest open layer instead of closing everything:
          // leave the editor, then zoom, then the panel, then the viewer. The editor
          // comes first because it alone may contain active input: otherwise Escape
          // from the field would close the viewer over unsaved text.
          if (editingCaption) setEditingCaption(false);
          else if (zoomed) setZoomed(false);
          else if (panel) onPanelChange(null);
          else onClose();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          goTo(index - 1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          goTo(index + 1);
          break;
        case 'Home':
          event.preventDefault();
          goTo(0);
          break;
        case 'End':
          event.preventDefault();
          goTo(items.length - 1);
          break;
        case 'i':
        case 'I':
          event.preventDefault();
          togglePanel('info');
          break;
        case 'c':
        case 'C':
          event.preventDefault();
          togglePanel('comments');
          break;
        case 'f':
        case 'F':
          event.preventDefault();
          toggleFullscreen();
          break;
        case 'd':
        case 'D':
          event.preventDefault();
          download();
          break;
        case 'z':
        case 'Z':
          event.preventDefault();
          setZoomed((value) => !value);
          break;
        case 'l':
        case 'L':
          event.preventDefault();
          setCaptionHidden(!captionHidden);
          break;
        case 'h':
        case 'H':
          event.preventDefault();
          setBare((value) => !value);
          break;
        case ' ': {
          // Space scrolls the page by default; here it controls the video.
          event.preventDefault();
          const video = videoRef.current;
          if (video) void (video.paused ? video.play() : video.pause());
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    index,
    items.length,
    zoomed,
    panel,
    editingCaption,
    captionHidden,
    setCaptionHidden,
    goTo,
    onClose,
    onPanelChange,
    toggleFullscreen,
    download,
    togglePanel,
  ]);

  if (!item) return null;

  // Deliberately use the same functions as the grid: a viewer computing its own
  // day label would eventually announce a different date from the section
  // header that was clicked.
  const day = days.get(dayKey(item.takenAt));
  const dayPlace = placeLabelOf(day);
  // `total` may lag behind the list when an album syncs while being browsed: the
  // counter must never show "60 / 50".
  const count = Math.max(total, items.length);

  // Describe actions once and render them in two ways: aligned icons from `sm`
  // upwards, labelled rows in the menu below. Duplicating them would eventually
  // leave a shortcut, icon or active state inconsistent between the two.
  const isCover = item.id === coverId;

  const actions: {
    /**
     * Stable name, used to split this list between the phone's action row and its
     * overflow menu. Matching on `label` would break the day somebody translates
     * it, and silently: the menu would simply hold one entry more.
     */
    key: 'info' | 'zoom' | 'download' | 'fullscreen' | 'bare' | 'cover';
    label: string;
    /** Absent for an action without a shortcut: see "Set as cover". */
    shortcut?: string;
    icon: ReactNode;
    active?: boolean;
    onSelect: () => void;
  }[] = [
    {
      key: 'info',
      label: t('viewer.information'),
      shortcut: 'i',
      active: panel === 'info',
      onSelect: () => togglePanel('info'),
      icon: (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 7.5v.5" />
        </>
      ),
    },
    ...(isVideo
      ? []
      : [
          {
            key: 'zoom' as const,
            label: t(zoomed ? 'viewer.zoomOut' : 'viewer.zoomIn'),
            shortcut: 'z',
            active: zoomed,
            onSelect: () => setZoomed((value) => !value),
            icon: (
              <>
                <circle cx="11" cy="11" r="7" />
                <path d={zoomed ? 'M8 11h6M20 20l-3.5-3.5' : 'M8 11h6M11 8v6M20 20l-3.5-3.5'} />
              </>
            ),
          },
        ]),
    {
      key: 'download',
      label: t('viewer.download'),
      shortcut: 'd',
      onSelect: download,
      icon: <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />,
    },
    {
      key: 'fullscreen',
      label: t('viewer.fullscreen'),
      shortcut: 'f',
      onSelect: toggleFullscreen,
      icon: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
    },
    {
      key: 'bare',
      label: t('viewer.hideChrome'),
      shortcut: 'h',
      onSelect: () => setBare(true),
      // Use a crossed-out eye: it represents what disappears, not what remains.
      icon: (
        <>
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
          <circle cx="12" cy="12" r="2.5" />
          <path d="m4 20 16-16" />
        </>
      ),
    },
    // Reserved for administrators and never available on video: its preview
    // belongs to Drive (D92), which may not provide one — and the cover is the
    // only image whose absence is visible from the home page without a fallback.
    //
    // Unlike the other four, no keyboard shortcut: this is done once per album,
    // not a playback command, and the `?` reference is for everyone.
    //
    // No shortcut for returning to automatic selection either — that is the
    // /admin button. Reconfirming the current cover is therefore not a wasted
    // click: it may have been selected by default, and this pins it so the next
    // synchronised photo no longer replaces it.
    //
    // `scope.kind === 'album'` beside `isAdmin` because the mutation needs an album
    // identifier and a link carries none. Both conditions are true of the same
    // person in practice; the compiler is what makes the second one stated.
    ...(isAdmin && !isVideo && scope.kind === 'album'
      ? [
          {
            key: 'cover' as const,
            label: t(isCover ? 'viewer.cover' : 'viewer.setCover'),
            active: isCover,
            onSelect: () => setCover.mutate({ albumId: scope.albumId, body: { coverId: item.id } }),
            icon: (
              <>
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="m6 16 4-4 3 3 2-2 3 3" />
              </>
            ),
          },
        ]
      : []),
  ];

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
      className="fixed inset-0 z-50 flex outline-none"
    >
      {/* Photo column. It **shrinks** when the panel enters the flow (from
          `md`): as an overlay, the panel covered the "Next" arrow and had to be
          closed for every photo. `min-w-0` is essential — without it, content
          imposes its width and the panel overflows the screen.

          **`theme-dark` here and nowhere else in this file**: the stage is the
          one surface that does not follow the reader's theme. A photograph is
          judged against what surrounds it, and a white ground shifts every
          exposure in it — which is why the ground carries `ink-950` while the
          panel beside it, the sheets it opens and the menus above it stay
          chrome and turn light with the rest of the application (D260815d).
          The gradients and the white text in this column are painted over the
          photo itself, and are correct for the same reason. */}
      <div className="theme-dark relative flex min-w-0 flex-1 flex-col bg-ink-950">
        {/* The veil makes the header readable: without it, light text over an
            overexposed sky cannot be read. It covers two lines — album and day,
            then place — mirroring the bottom bar, and its transparent base keeps
            the transition soft instead of placing a black band over the photo. */}
        <header
          hidden={bare}
          className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/85 via-black/55 to-transparent pb-8"
        >
          {/* Attach it to the top edge like a loading bar: it remains readable
              without cutting into the photo. Lower down, it crossed the image —
              a coloured line through the middle of a composition. */}
          <div
            className="h-0.5 w-full bg-white/15"
            role="progressbar"
            aria-valuenow={index + 1}
            aria-valuemin={1}
            aria-valuemax={count}
            aria-label={t('viewer.progress')}
          >
            <div
              className="h-full bg-accent transition-[width] duration-200"
              style={{ width: `${((index + 1) / count) * 100}%` }}
            />
          </div>

          {/* Put the numeric ratio **beneath the bar**, centred, rather than in
              the title row. Two ways of saying the same thing used to sit at
              opposite ends of the screen: the line showed position without the
              total, while the number gave the count without the position.
              Together they explain one another, and the top row returns to the
              title the width permanently occupied by "900 / 900".

              **Outside the flow**, crucially: in the flow it added fifteen pixels
              to a header over the photo, exactly what had just been reclaimed.
              It fits in the band already occupied by the gradient between the
              line and first title row — a bar that costs height to say "25 of
              900" is not worth it.

              `pointer-events-none`: placed above the row, it would otherwise
              capture a click meant for the title.

              `aria-hidden`: the bar already carries `aria-valuenow` and
              `aria-valuemax`; a screen reader would announce the same thing
              twice a few words apart. */}
          <p
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-1 text-center text-[11px] leading-none text-ink-400 tabular-nums"
          >
            {index + 1} / {count}
          </p>

          {/* `items-start`: everything aligns with the **first line** of text.
              Top offsets below place the title and icon centres on the same
              horizontal — 6 px below `sm` (32 px button), 8 px above it (36 px).

              Side margins account for the notch: in landscape on an iPhone
              launched from the home screen, it covers the Close button exactly.
              Apply them here rather than to the header so the gradient and
              progress bar still reach the edge. */}
          <div className="flex items-start gap-1 py-2 pl-[calc(0.5rem_+_env(safe-area-inset-left))] pr-[calc(0.5rem_+_env(safe-area-inset-right))] sm:gap-2 sm:py-3 sm:pl-[calc(1rem_+_env(safe-area-inset-left))] sm:pr-[calc(1rem_+_env(safe-area-inset-right))]">
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-full p-1.5 text-ink-200 transition-colors sm:p-2 hover:bg-white/10 hover:text-white"
              aria-label={t('viewer.close')}
              title={t('viewer.close')}
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>

            <div className="min-w-0 flex-1 pt-1.5 sm:pt-2">
              {/* The header **locates** the photo, while the bottom bar **tells
                  its story**: album and day here, what somebody wrote there. The
                  filename occupied this space in bold without telling anyone
                  anything — `IMG_0004.jpg` says neither where nor when — and hid
                  the album, the only information truly missing on arrival from a
                  shared link. It remains atop the `i` panel with its technical data.

                  Truncate the **album title**, never the date: on a phone, the
                  line cannot fit both, and "Germany – Black Forest · Toda…"
                  sacrifices precisely the information being provided. Hence
                  `truncate` only on the album and `shrink-0` on the short,
                  bounded date. */}
              <p className="flex min-w-0 items-baseline text-sm leading-5 font-semibold text-ink-100">
                {albumTitle && (
                  <>
                    <span className="truncate">{albumTitle}</span>
                    <span className="shrink-0 px-1.5 text-ink-400">·</span>
                  </>
                )}
                <span className="shrink-0">{dayLabel(dayKey(item.takenAt), t)}</span>
              </p>
              {/* Place gets its own line now that the first is full. The day note
                  moved to the bottom bar (D84): it is written by hand like the
                  photo description, and both are read together or not at all. */}
              {dayPlace && (
                <p className="truncate text-xs leading-4 text-ink-300" title={dayPlace}>
                  {dayPlace}
                </p>
              )}

              {/* Below `md`, what somebody **wrote** joins what situates the
                  photo, instead of waiting at the other end of the screen under
                  a row of buttons (D260814e). The bottom then carries the
                  toolbar and nothing else.

                  It ignores `captionHidden` here: the tap that hides the chrome
                  already puts this away, and `l` has no key to press on a phone
                  — someone who had collapsed the strip on a desktop would have
                  found no way to bring it back. */}
              {phone && (
                <MediaCaption
                  key={item.id}
                  albumId={albumId}
                  mediaId={item.id}
                  description={item.description}
                  day={day?.description ?? null}
                  editable={isAdmin}
                  hidden={false}
                  onHiddenChange={setCaptionHidden}
                  editing={editingCaption}
                  onEditingChange={setEditingCaption}
                  overlay={false}
                  variant="header"
                />
              )}
            </div>

            {/* **Nothing actionable up here below `md`.** The header identifies
                the photo and offers the way out; everything that acts on it sits
                in the sheet's action row, at the edge the thumb is already on
                (D260814d). From `md` the row returns: a cursor reaches the top of
                the screen as easily as the bottom, and hover names every icon.

                Comments never enters the overflow menu even there: its icon
                carries the unread badge, the only sign that a photo has a
                conversation, and a badge inside a closed menu signals nothing. */}
            <div className="hidden shrink-0 items-center gap-0.5 md:flex md:gap-2">
              <IconButton
                label={commentsLabel(commentTotal, unread, t)}
                active={panel === 'comments'}
                onClick={() => togglePanel('comments')}
                badge={<CommentBadge total={commentTotal} unread={unread} />}
              >
                <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />
              </IconButton>

              {actions.map((action) => (
                <IconButton
                  key={action.label}
                  label={
                    action.shortcut
                      ? t('viewer.shortcut', action.label, action.shortcut)
                      : action.label
                  }
                  active={action.active}
                  onClick={action.onSelect}
                >
                  {action.icon}
                </IconButton>
              ))}
            </div>
          </div>
        </header>

        {/* `touch-action` decides whether both finger gestures in this column
            complete: swiping between photos and panning an enlarged photo. With
            the default `auto`, the browser may interpret a drag as scrolling; it
            decides after one or two `pointermove` events, emits `pointercancel`
            and kills both gestures midway — which feels like lag rather than an
            interruption. `setPointerCapture` changes nothing: it guarantees the
            remaining events, not the survival of the gesture.

            Use `none` rather than `pinch-zoom`: the two-finger pinch now belongs
            to `ZoomableImage`, which scales the **photo** and fetches the 4096 px
            variant, where the browser's own page zoom magnified pixels already
            rendered (D260814d). Nothing is lost by taking it: the viewer is
            `fixed` over a frozen body, so there is no page left to pan or scroll
            here. Set it on the column rather than in `ZoomableImage` because the
            rule is shared by everything in it and descendants inherit it by
            intersection (D77).

            Except on video, whose native playback controls handle touch
            themselves — swiping is already disabled there. */}
        <div
          className={`relative flex flex-1 items-center justify-center overflow-hidden ${
            isVideo ? '' : 'touch-none'
          }`}
          {...swipe.handlers}
          onPointerDownCapture={dismissPanelOnOutsideClick}
        >
          {/* The rail: three photos move together beneath the finger, and that
              movement teaches the gesture. It carries nothing else — no arrows,
              caption or error message: viewer chrome remains still while
              browsing, as in any native viewer (D260809e).

              At rest, `offset` is zero and the transition is disabled: the
              transform then has no effect and the tree is exactly as before the rail. */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              transform: `translate3d(${swipe.offset}px, 0, 0)`,
              transition: swipe.settleMs
                ? `transform ${swipe.settleMs}ms ${SETTLE_EASING}`
                : 'none',
            }}
          >
            {/* Mount only for the duration of the gesture. Their render comes
                from neighbour preloading and therefore the browser cache: they
                appear without another request. Keeping them outside a swipe
                would decode two more full-screen images per photo viewed. */}
            {swipe.active && <SwipeNeighbour item={items[index - 1]} side="left" scope={scope} />}
            {swipe.active && <SwipeNeighbour item={items[index + 1]} side="right" scope={scope} />}

            {isVideo && failed ? (
              <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
                <p className="text-sm text-ink-300">{t('viewer.videoFailed')}</p>
                {/* Name the format rather than saying "an error occurred": it is
                  almost always a codec this browser cannot decode (D79), while
                  the file remains perfectly playable elsewhere. Without the
                  download, the video would simply be lost.

                  When the codec is known to be unsupported here, a playable
                  version is also known to be on its way and the viewer watches
                  for it: the message says what will happen without asking for a
                  return or reload (D6). */}
                <p className="text-xs text-ink-400">
                  {t(transcoded ? 'viewer.videoTranscoding' : 'viewer.videoUnsupported')}
                </p>
                <button
                  type="button"
                  onClick={download}
                  className="rounded border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition-colors hover:border-ink-600 hover:text-ink-100"
                >
                  {t('viewer.downloadShort')}
                </button>
              </div>
            ) : isVideo ? (
              <video
                ref={videoRef}
                key={item.id}
                src={
                  transcoded
                    ? mediaUrl.playable(item.id, item.version, scope)
                    : mediaUrl.original(item.id, item.version, scope)
                }
                // Use the same thumbnail as the grid, already in the disk cache
                // and often the browser cache: the black waiting rectangle
                // disappears without another request (D92).
                poster={
                  item.hasPreview ? mediaUrl.thumb(item.id, 1280, item.version, scope) : undefined
                }
                controls
                autoPlay
                playsInline
                className="max-h-full max-w-full"
                // At this point a decodable video track must have produced a
                // frame: zero `videoWidth` means the browser retained only sound.
                // It raises no error — the container and audio track are valid —
                // so `error` alone would leave the `poster` in place, looking like
                // a frozen image (D98).
                onLoadedData={checkVideoTrack}
                onPlaying={checkVideoTrack}
                onError={() => setFailed(true)}
              />
            ) : (
              <ZoomableImage
                // Remounting the component for each photo resets zoom and framing
                // without resetting them manually.
                key={item.id}
                src={mediaUrl.full(item.id, item.version, scope)}
                hdSrc={mediaUrl.hd(item.id, item.version, scope)}
                placeholderSrc={mediaUrl.thumb(item.id, 320, item.version, scope)}
                alt={item.name}
                naturalWidth={item.width}
                naturalHeight={item.height}
                zoomed={zoomed}
                onZoomedChange={setZoomed}
                // A tap shows or hides the chrome on a touch screen; zoom moves
                // to a double tap. With a cursor, `undefined` keeps one click
                // zooming — there is nothing hidden for it to reveal.
                onTap={coarse ? () => setBare((value) => !value) : undefined}
                // Only the photo the grid was opened on: during a swipe the rail
                // mounts its neighbours, and three images sharing one transition
                // name would silently cancel the animation.
                sharedName={swipe.active ? undefined : SHARED_MEDIA}
              />
            )}
          </div>

          {/* The only way back once everything is hidden, so it must be found
              without searching: in the corner where the actions were. Without
              it, exit would rely on `h` or `Escape`, offering nothing to anyone
              touching the screen. */}
          {bare && (
            <button
              type="button"
              onClick={() => setBare(false)}
              title={t('viewer.showChrome')}
              aria-label={t('viewer.showChrome')}
              className="absolute top-[calc(0.5rem_+_env(safe-area-inset-top))] right-[calc(0.5rem_+_env(safe-area-inset-right))] z-10 rounded-full bg-black/40 p-2 text-ink-200 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                <circle cx="12" cy="12" r="2.5" />
              </svg>
            </button>
          )}

          {/* A rejected cover change — expired session or role removed meanwhile
              — must be visible: the button returns to its original state, and
              without this message failure would look like no click. It disappears
              on the next photo or attempt.

              Use `bottom-28`, not `bottom-6`: the caption bar now occupies the
              bottom of the column, and an error message below it would be covered
              by the text it is meant to interrupt. */}
          {setCover.isError && (
            <p
              role="alert"
              className="absolute inset-x-4 bottom-28 mx-auto max-w-md rounded-lg bg-red-950/90 px-3 py-2 text-center text-xs text-red-200 shadow-lg"
            >
              {errorText(setCover.error, t('viewer.coverFailed'))}
            </p>
          )}
        </div>

        {/* Siblings of the column rather than the media area, so their `top-1/2`
            uses the full, unchanging screen height. Inside the media area they
            followed its height — reduced by the caption bar when it enters the
            flow on video, and increased when the bar carries a description or
            day note. Arrows then moved by tens of pixels between media and as the
            caption expanded, forcing the mouse to be repositioned each time.

            Hide while zoomed: dragging then pans the image and arrows would fall
            beneath the pointer. Also hide with the chrome — "only the photo"
            does not stop at text. The ←/→ keys and swipe continue: hide what is
            visible, not what is controlled. */}
        {!zoomed && !bare && (
          <NavButton
            side="left"
            disabled={index === 0}
            onClick={() => goTo(index - 1)}
            label={t('viewer.previous')}
          />
        )}
        {!zoomed && !bare && (
          <NavButton
            side="right"
            disabled={index === items.length - 1}
            onClick={() => goTo(index + 1)}
            label={t('viewer.next')}
          />
        )}

        {/* Hide while zoomed like navigation arrows: the finger pans the image
            and the bar would fall beneath it.

            `key` on the media: expansion resets between photos because it relates
            to specific text, not the next one.

            On video, `overlay={false}`: the bar enters the flow and the column
            loses that much space — the only place where it pushes instead of
            overlaying, because native playback controls live at the element's bottom.

            Also hidden by `h`, not merely collapsed like `l`: "only the photo"
            does not stop at the top of the screen, and the "Show caption" button
            left by `l` is still something overlaid on it.

            Below `md` it is not here at all: the texts moved into the header,
            beside the album and the date (D260814e). A video used to be the one
            phone exception — its native controls sit at the bottom of the
            element, so nothing may rest there — and moving the caption up
            removed the exception with the problem. */}
        {!phone && !zoomed && !bare && (
          <MediaCaption
            key={item.id}
            albumId={albumId}
            mediaId={item.id}
            description={item.description}
            day={day?.description ?? null}
            editable={isAdmin}
            hidden={captionHidden}
            onHiddenChange={setCaptionHidden}
            editing={editingCaption}
            onEditingChange={setEditingCaption}
            overlay={!isVideo}
          />
        )}
      </div>

      {/* From `md`, the panel is a column in the flow: the photo shrinks once and
          the panel can stay open from one photo to the next. */}
      {!phone && panel && (
        <SidePanel
          scope={scope}
          mediaId={item.id}
          mediaName={item.name}
          detail={detail}
          day={days.get(dayKey(item.takenAt))}
          tab={panel}
          onTabChange={onPanelChange}
          onClose={() => onPanelChange(null)}
        />
      )}

      {/* Below `md`, **one** sheet carries both. At rest it is the caption; pulled
          up it becomes the panel, which is the honest shape of the relationship —
          "what this photo is" and "everything about this photo" are the same
          subject at two depths, and they were two separate full-screen surfaces
          for no reason a finger could discover. */}
      {phone && isVideo && panel && (
        <Sheet
          stops={VIDEO_SHEET_STOPS}
          stop={0}
          onStopChange={() => onPanelChange(null)}
          label={t('panel.label')}
        >
          <PanelBody
            scope={scope}
            mediaId={item.id}
            detail={detail}
            day={days.get(dayKey(item.takenAt))}
            tab={panel}
            onTabChange={onPanelChange}
          />
        </Sheet>
      )}

      {phone && !isVideo && !zoomed && !bare && (
        <Sheet
          stops={VIEWER_SHEET_STOPS}
          stop={panel ? 1 : 0}
          layerFrom={1}
          onStopChange={(next) => {
            if (next < 0) {
              onPanelChange(null);
              setCaptionHidden(true);
            } else if (next === 0) onPanelChange(null);
            // Open on Info: it is what the sheet was already showing, one level
            // deeper. Comments are one tap away and carry their own count.
            else onPanelChange(panel ?? 'info');
          }}
          label={t('panel.label')}
          peek={
            <SheetActions
              panel={panel}
              onPanel={(next) => onPanelChange(next)}
              commentTotal={commentTotal}
              unread={unread}
              overflow={actions.filter((action) => action.key !== 'info')}
              onDownload={download}
              t={t}
            />
          }
        >
          {/* Mounted only at the taller stop: the comments tab carries a form
              with a draft in it, and keeping it alive behind a resting caption
              would hold that draft for every photo scrolled past. */}
          {panel && (
            <PanelBody
              scope={scope}
              mediaId={item.id}
              detail={detail}
              day={days.get(dayKey(item.takenAt))}
              tab={panel}
              onTabChange={onPanelChange}
              // The action row above already carries Info and Comments.
              tabs={false}
            />
          )}
        </Sheet>
      )}
    </div>
  );
}

/**
 * The viewer's actions, below `md`: a row at the top of the sheet.
 *
 * They used to live in the top bar — a corner of the screen a thumb reaches by
 * shifting its grip, over a photo the whole point was to look at. Down here they
 * sit where the hand already is, and the same row **is** the panel's tab strip:
 * Info and Comments open the sheet on their tab and then show which one is
 * showing, instead of a second pair of tabs a centimetre below (D260814d).
 *
 * Only those two are tabs. Download acts and returns nothing, and the rest go
 * behind one overflow menu rather than four more targets in a 390 px row.
 */
function SheetActions({
  panel,
  onPanel,
  commentTotal,
  unread,
  overflow,
  onDownload,
  t,
}: {
  panel: PanelTab | null;
  onPanel: (panel: PanelTab | null) => void;
  commentTotal: number;
  unread: number;
  overflow: { label: string; icon: ReactNode; active?: boolean; onSelect: () => void }[];
  onDownload: () => void;
  t: Translate;
}): ReactElement {
  return (
    <div className="flex items-center gap-1 border-b border-ink-800 px-2 pb-2">
      {/* `flex-[2]` for two children against Download's one: without it the pair
          shares a single unit and Download gets a slot twice their width, which
          reads as a gap somebody forgot to close. */}
      <div role="tablist" aria-label={t('panel.sections')} className="flex flex-[2] gap-1">
        <SheetAction
          tab
          selected={panel === 'info'}
          label={t('panel.info')}
          onSelect={() => onPanel(panel === 'info' ? null : 'info')}
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 7.5v.5" />
        </SheetAction>

        <SheetAction
          tab
          selected={panel === 'comments'}
          label={t('panel.comments')}
          announce={commentsLabel(commentTotal, unread, t)}
          badge={<CommentBadge total={commentTotal} unread={unread} />}
          onSelect={() => onPanel(panel === 'comments' ? null : 'comments')}
        >
          <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />
        </SheetAction>
      </div>

      <SheetAction label={t('viewer.downloadShort')} onSelect={onDownload}>
        <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />
      </SheetAction>

      <ActionMenu
        label={t('viewer.actions')}
        triggerClassName="flex min-h-12 min-w-12 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-tint hover:text-ink-100"
        groupes={[
          overflow.map((action) => ({
            // Omit the keyboard shortcut: this menu opens by touch, where "(f)"
            // is one more syllable to read and no key to press.
            label: action.label,
            icon: (
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                {action.icon}
              </svg>
            ),
            onSelect: action.onSelect,
          })),
        ]}
      />
    </div>
  );
}

/** One control in that row: a 48 px target, its name under the icon. */
function SheetAction({
  label,
  announce,
  onSelect,
  selected = false,
  tab = false,
  badge,
  children,
}: {
  label: string;
  /** Accessible name when the visible one omits what the badge carries. */
  announce?: string;
  onSelect: () => void;
  selected?: boolean;
  tab?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      role={tab ? 'tab' : undefined}
      aria-selected={tab ? selected : undefined}
      aria-label={announce}
      onClick={onSelect}
      className={`flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-[0.6875rem] leading-none transition-colors ${
        selected ? 'bg-accent-soft text-ink-100' : 'text-ink-300 hover:bg-tint'
      }`}
    >
      <span className="relative">
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {children}
        </svg>
        {badge}
      </span>
      {label}
    </button>
  );
}

/**
 * Adjacent photo on the rail during a swipe.
 *
 * It exists only to be seen arriving: purely decorative, therefore `aria-hidden`
 * and without handlers — the real photo will replace it immediately with its
 * zoom, caption and panel.
 *
 * Use the same `full` render as the viewer, not the thumbnail: neighbour
 * preloading just cached it, so the rail triggers no request. A video has only
 * its Drive preview to show (D92), and without one the rail slides over empty
 * space — correctly, because there is nothing to display until the video opens.
 */
function SwipeNeighbour({
  item,
  side,
  scope,
}: {
  item: ShareItem | undefined;
  side: 'left' | 'right';
  scope?: Scope;
}): ReactElement | null {
  if (!item) return null;

  const src =
    item.kind === 'video'
      ? item.hasPreview
        ? mediaUrl.thumb(item.id, 1280, item.version, scope)
        : null
      : mediaUrl.full(item.id, item.version, scope);

  return (
    <div
      aria-hidden="true"
      className="absolute inset-y-0 flex w-full items-center justify-center"
      style={
        side === 'left'
          ? { right: `calc(100% + ${GUTTER_PX}px)` }
          : { left: `calc(100% + ${GUTTER_PX}px)` }
      }
    >
      {src && (
        <img src={src} alt="" draggable={false} className="max-h-full max-w-full select-none" />
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  active = false,
  badge,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  /** Badge over the icon. It must remain `aria-hidden`: its information belongs
      in `label`, or a screen reader announces a bare number. */
  badge?: React.ReactNode;
  children: React.ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      // Tighter padding on small screens: five icons plus the cross left roughly
      // forty pixels for the date, so it was always truncated.
      className={`relative rounded-full p-1.5 transition-colors sm:p-2 hover:bg-white/10 hover:text-white ${
        active ? 'bg-white/15 text-white' : 'text-ink-200'
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
      {badge}
    </button>
  );
}

/**
 * "Comments" button badge.
 *
 * Two distinct states answer two different questions: a quiet dot says "there
 * is a conversation here", while a coloured number says "it has changed since
 * your last visit". Combining them would demand attention for a photo whose
 * messages have all been read.
 */
function CommentBadge({ total, unread }: { total: number; unread: number }): ReactElement | null {
  if (total === 0) return null;

  if (unread === 0) {
    return (
      <span
        aria-hidden="true"
        className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-ink-300"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      // Cap at "9+": beyond that the number overflows the icon, and knowing
      // whether twelve or seventeen messages are unread changes no action.
      className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[0.625rem] leading-4 font-semibold text-accent-ink tabular-nums"
    >
      {unread > 9 ? '9+' : unread}
    </span>
  );
}

/**
 * Accessible button label: it carries the badge information because the badge
 * is purely visual.
 */
function commentsLabel(total: number, unread: number, t: Translate): string {
  if (total === 0) return t('viewer.comments');
  if (unread === 0) return t('viewer.commentsCount', total);
  return t('viewer.commentsUnread', total, unread);
}

function NavButton({
  side,
  disabled,
  onClick,
  label,
}: {
  side: 'left' | 'right';
  disabled: boolean;
  onClick: () => void;
  label: string;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      // Match bar buttons: nothing at rest, a light veil on hover. A permanent
      // background weighed down the image even though these buttons sit on it,
      // not on chrome.
      className={`absolute top-1/2 -translate-y-1/2 rounded-full p-3 text-ink-200 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-0 ${
        side === 'left' ? 'left-4' : 'right-4'
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={side === 'left' ? 'M15 18 9 12l6-6' : 'm9 18 6-6-6-6'} />
      </svg>
    </button>
  );
}
