import type { MediaItem } from '@gdv/shared';
import {
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { mediaUrl } from '../api/client';
import { useMediaDetail } from '../api/hooks';
import { formatDateTime } from '../lib/format';
import { ExifPanel } from './ExifPanel';

const ZOOM_SCALE = 2.5;
/** Nombre de médias préchargés de part et d'autre du média courant. */
const PRELOAD_RADIUS = 2;

interface LightboxProps {
  albumId: string;
  items: MediaItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Appelé près de la fin de la liste, pour charger la page suivante. */
  onNeedMore: () => void;
}

/**
 * Visionneuse plein écran.
 *
 * Se pilote entièrement au clavier ; la souris n'est qu'un raccourci. Les
 * médias voisins sont préchargés pour que ←/→ enchaîne sans écran noir, et le
 * défilement de la page est gelé le temps de l'ouverture.
 */
export function Lightbox({
  albumId,
  items,
  index,
  onIndexChange,
  onClose,
  onNeedMore,
}: LightboxProps): ReactElement | null {
  const item = items[index];
  const [showInfo, setShowInfo] = useState(false);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { data: detail } = useMediaDetail(albumId, showInfo && item ? item.id : null);

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= items.length) return;
      setZoom(null);
      setLoaded(false);
      onIndexChange(next);
    },
    [items.length, onIndexChange],
  );

  // Gèle le défilement de la page derrière la visionneuse — sans ça, la molette
  // ferait défiler la grille sous l'image.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Le conteneur prend le focus à l'ouverture pour recevoir les touches, et le
  // rend à la grille à la fermeture.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    containerRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  // Précharge les voisins : à l'arrivée sur la photo suivante, l'image est déjà
  // dans le cache du navigateur.
  useEffect(() => {
    for (let offset = -PRELOAD_RADIUS; offset <= PRELOAD_RADIUS; offset++) {
      const neighbour = items[index + offset];
      if (!neighbour || offset === 0 || neighbour.kind !== 'photo') continue;
      const image = new Image();
      image.src = mediaUrl.full(neighbour.id);
    }

    if (index >= items.length - 5) onNeedMore();
  }, [index, items, onNeedMore]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current?.requestFullscreen?.().catch(() => {
        /* refusé par le navigateur : la visionneuse reste en plein écran CSS */
      });
    }
  }, []);

  const download = useCallback(() => {
    if (!item) return;
    // Ancre synthétique plutôt que window.open : évite le blocage de popup et
    // laisse le navigateur gérer la barre de téléchargement.
    const anchor = document.createElement('a');
    anchor.href = mediaUrl.download(item.id);
    anchor.download = item.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [item]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Laisse passer les raccourcis navigateur (Ctrl+R, Cmd+W…).
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          if (zoom) setZoom(null);
          else if (showInfo) setShowInfo(false);
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
          setShowInfo((value) => !value);
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
          setZoom((value) => (value ? null : { x: 50, y: 50 }));
          break;
        case ' ': {
          // L'espace fait défiler la page par défaut : ici il pilote la vidéo.
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
  }, [index, items.length, zoom, showInfo, goTo, onClose, toggleFullscreen, download]);

  if (!item) return null;

  const isVideo = item.kind === 'video';

  const onMouseMove = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!zoom) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setZoom({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    });
  };

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
      className="fixed inset-0 z-50 flex flex-col bg-ink-950 outline-none"
    >
      <header className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 text-ink-200 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Fermer (Échap)"
          title="Fermer (Échap)"
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

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink-100">{item.name}</p>
          <p className="text-xs text-ink-400">
            {formatDateTime(item.takenAt)} · {index + 1} / {items.length}
          </p>
        </div>

        <IconButton
          label="Informations (i)"
          active={showInfo}
          onClick={() => setShowInfo((v) => !v)}
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 7.5v.5" />
        </IconButton>

        <IconButton label="Télécharger l'original (d)" onClick={download}>
          <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />
        </IconButton>

        <IconButton label="Plein écran (f)" onClick={toggleFullscreen}>
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </IconButton>
      </header>

      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        onMouseMove={onMouseMove}
        onDoubleClick={() => setZoom((value) => (value ? null : { x: 50, y: 50 }))}
      >
        {isVideo ? (
          <video
            ref={videoRef}
            key={item.id}
            src={mediaUrl.original(item.id)}
            controls
            autoPlay
            playsInline
            className="max-h-full max-w-full"
            onLoadedData={() => setLoaded(true)}
          />
        ) : (
          <img
            key={item.id}
            src={mediaUrl.full(item.id)}
            alt={item.name}
            className={`max-h-full max-w-full object-contain lightbox-enter ${
              zoom ? 'cursor-zoom-out' : 'cursor-zoom-in'
            } ${loaded ? '' : 'opacity-0'}`}
            style={
              zoom
                ? {
                    transform: `scale(${ZOOM_SCALE})`,
                    transformOrigin: `${zoom.x}% ${zoom.y}%`,
                  }
                : undefined
            }
            onLoad={() => setLoaded(true)}
            onClick={() => setZoom((value) => (value ? null : { x: 50, y: 50 }))}
            draggable={false}
          />
        )}

        {!loaded && (
          <span className="absolute size-8 animate-spin rounded-full border-2 border-ink-700 border-t-accent" />
        )}

        <NavButton
          side="left"
          disabled={index === 0}
          onClick={() => goTo(index - 1)}
          label="Précédent (←)"
        />
        <NavButton
          side="right"
          disabled={index === items.length - 1}
          onClick={() => goTo(index + 1)}
          label="Suivant (→)"
        />
      </div>

      {showInfo && <ExifPanel detail={detail} onClose={() => setShowInfo(false)} />}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`rounded-full p-2 transition-colors hover:bg-white/10 hover:text-white ${
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
    </button>
  );
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
      className={`absolute top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-3 text-ink-100 transition-opacity hover:bg-black/60 disabled:pointer-events-none disabled:opacity-0 ${
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
