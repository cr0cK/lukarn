import type { MediaItem } from '@gdv/shared';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { mediaUrl } from '../api/client';
import { useMediaDetail } from '../api/hooks';
import { formatDateTime } from '../lib/format';
import { useSwipe } from '../lib/useSwipe';
import { SidePanel, type PanelTab } from './SidePanel';
import { ZoomableImage } from './ZoomableImage';

/**
 * Photos préchargées dans le sens de navigation, et dans l'autre. Le total
 * reste modeste : chaque rendu absent du cache serveur coûte le téléchargement
 * de l'original depuis Drive, et saturer la file ralentirait la photo courante.
 */
const PRELOAD_AHEAD = 4;
const PRELOAD_BEHIND = 1;

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
  const isVideo = item?.kind === 'video';
  /** `null` = panneau fermé ; sinon l'onglet visible. */
  const [panel, setPanel] = useState<PanelTab | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  /** Sens du dernier déplacement : oriente le préchargement. */
  const [direction, setDirection] = useState(1);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { data: detail } = useMediaDetail(albumId, panel && item ? item.id : null);

  /** Ouvre le panneau sur cet onglet, ou le referme s'il y est déjà. */
  const togglePanel = useCallback((tab: PanelTab) => {
    setPanel((current) => (current === tab ? null : tab));
  }, []);

  const goTo = useCallback(
    (next: number) => {
      // `Début` sur le premier média, `Fin` sur le dernier, une flèche à une
      // extrémité : l'index demandé est déjà celui affiché. Sans ce garde-fou,
      // `setLoaded(false)` attendrait un chargement qui ne viendra pas — aucun
      // élément n'est remonté, donc aucun `loadeddata` n'est émis, et le
      // tourniquet de la vidéo tourne indéfiniment.
      if (next < 0 || next >= items.length || next === index) return;
      setDirection(next >= index ? 1 : -1);
      setZoomed(false);
      setLoaded(false);
      onIndexChange(next);
    },
    [index, items.length, onIndexChange],
  );

  // Désactivé pendant le zoom, où le doigt sert à se déplacer dans l'image, et
  // sur une vidéo, où il traverserait les contrôles natifs de lecture.
  const swipe = useSwipe((towards) => goTo(index + towards), !zoomed && !isVideo);

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

  /**
   * Précharge les photos voisines pour que ←/→ enchaîne sans attente.
   *
   * Le préchargement est asymétrique et suit le sens de navigation : quelqu'un
   * qui avance continue presque toujours d'avancer. À nombre de requêtes égal,
   * pousser plus loin devant que derrière rend le parcours nettement plus
   * fluide, ce qui compte d'autant plus que chaque première génération demande
   * au serveur de télécharger l'original depuis Drive.
   *
   * L'ordre des requêtes est délibéré : les plus proches d'abord, pour que la
   * photo immédiatement suivante ne soit pas mise en file derrière des voisines
   * plus lointaines.
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
        image.src = mediaUrl.full(neighbour!.id, neighbour!.version);
        return image;
      });

    return () => {
      // Navigation rapide : abandonner les téléchargements devenus inutiles
      // libère les connexions pour la photo réellement affichée.
      for (const image of pending) image.src = '';
    };
  }, [index, items, direction]);

  useEffect(() => {
    if (index >= items.length - PRELOAD_AHEAD - 2) onNeedMore();
  }, [index, items.length, onNeedMore]);

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
    anchor.href = mediaUrl.download(item.id, item.version);
    anchor.download = item.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [item]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Laisse passer les raccourcis navigateur (Ctrl+R, Cmd+W…).
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // Le panneau des commentaires contient un champ de saisie. Sans ce garde,
      // écrire « info » ferait défiler les photos et ouvrirait le panneau sous
      // les doigts. Échap reste écouté : c'est la sortie de secours, et elle
      // doit marcher aussi depuis le champ.
      const target = event.target;
      if (
        event.key !== 'Escape' &&
        target instanceof HTMLElement &&
        (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)
      ) {
        return;
      }

      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          // Échap défait la dernière couche ouverte plutôt que de tout fermer :
          // sortir du zoom, puis du panneau, puis de la visionneuse.
          if (zoomed) setZoomed(false);
          else if (panel) setPanel(null);
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
  }, [index, items.length, zoomed, panel, goTo, onClose, toggleFullscreen, download, togglePanel]);

  if (!item) return null;

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
          active={panel === 'info'}
          onClick={() => togglePanel('info')}
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 7.5v.5" />
        </IconButton>

        <IconButton
          label="Commentaires (c)"
          active={panel === 'comments'}
          onClick={() => togglePanel('comments')}
        >
          <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />
        </IconButton>

        {!isVideo && (
          <IconButton
            label={zoomed ? 'Revenir à la taille écran (z)' : 'Zoomer (z)'}
            active={zoomed}
            onClick={() => setZoomed((value) => !value)}
          >
            <circle cx="11" cy="11" r="7" />
            <path d={zoomed ? 'M8 11h6M20 20l-3.5-3.5' : 'M8 11h6M11 8v6M20 20l-3.5-3.5'} />
          </IconButton>
        )}

        <IconButton label="Télécharger l'original (d)" onClick={download}>
          <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />
        </IconButton>

        <IconButton label="Plein écran (f)" onClick={toggleFullscreen}>
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </IconButton>
      </header>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden" {...swipe}>
        {isVideo ? (
          <video
            ref={videoRef}
            key={item.id}
            src={mediaUrl.original(item.id, item.version)}
            controls
            autoPlay
            playsInline
            className="max-h-full max-w-full"
            onLoadedData={() => setLoaded(true)}
          />
        ) : (
          <ZoomableImage
            // Remonter le composant à chaque photo réinitialise zoom et cadrage
            // sans avoir à les remettre à zéro à la main.
            key={item.id}
            src={mediaUrl.full(item.id, item.version)}
            hdSrc={mediaUrl.hd(item.id, item.version)}
            placeholderSrc={mediaUrl.thumb(item.id, 320, item.version)}
            alt={item.name}
            naturalWidth={item.width}
            naturalHeight={item.height}
            zoomed={zoomed}
            onZoomedChange={setZoomed}
            onLoadedChange={setLoaded}
          />
        )}

        {!loaded && isVideo && (
          <span className="absolute size-8 animate-spin rounded-full border-2 border-ink-700 border-t-accent" />
        )}

        {/* Masquées pendant le zoom : le glisser sert alors à se déplacer dans
            l'image, et les flèches tomberaient sous le curseur. */}
        {!zoomed && (
          <NavButton
            side="left"
            disabled={index === 0}
            onClick={() => goTo(index - 1)}
            label="Précédent (←)"
          />
        )}
        {!zoomed && (
          <NavButton
            side="right"
            disabled={index === items.length - 1}
            onClick={() => goTo(index + 1)}
            label="Suivant (→)"
          />
        )}
      </div>

      {panel && (
        <SidePanel
          albumId={albumId}
          mediaId={item.id}
          mediaName={item.name}
          detail={detail}
          tab={panel}
          onTabChange={setPanel}
          onClose={() => setPanel(null)}
        />
      )}
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
      // Même traitement que les boutons de la barre : rien au repos, un voile
      // clair au survol. Un fond permanent alourdissait l'image alors que ces
      // deux boutons sont posés dessus, pas sur un chrome.
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
