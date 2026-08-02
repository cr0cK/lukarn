import { THUMB_SIZES, type MediaItem, type ThumbSize } from '@gdv/shared';
import { type ReactElement, useState } from 'react';
import { mediaUrl } from '../api/client';
import { formatDuration } from '../lib/format';

/**
 * Plus petite variante qui couvre la taille d'affichage réelle, densité de
 * l'écran comprise. Demander systématiquement du 1280 saturerait la bande
 * passante sur une grille de 200 vignettes.
 */
export function pickThumbSize(displayWidth: number, dpr = window.devicePixelRatio || 1): ThumbSize {
  const needed = displayWidth * Math.min(dpr, 2);
  return THUMB_SIZES.find((size) => size >= needed) ?? THUMB_SIZES[THUMB_SIZES.length - 1]!;
}

interface ThumbProps {
  item: MediaItem;
  width: number;
  height: number;
  /** `true` pour la vignette sous le curseur clavier. */
  selected?: boolean;
  onOpen: () => void;
  /** Chargement immédiat pour les premières lignes, différé pour le reste. */
  eager?: boolean;
}

export function Thumb({
  item,
  width,
  height,
  selected = false,
  onOpen,
  eager = false,
}: ThumbProps): ReactElement {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // Les vidéos n'ont pas de rendu image côté serveur : elles s'affichent comme
  // une tuile sobre portant leur durée.
  const isVideo = item.kind === 'video';
  const duration = formatDuration(item.durationMs);

  return (
    <button
      type="button"
      onClick={onOpen}
      // La navigation se fait aux flèches sur le conteneur : les vignettes
      // sortent de l'ordre de tabulation pour ne pas doubler le parcours clavier.
      tabIndex={-1}
      aria-label={item.name}
      className={`group absolute overflow-hidden bg-ink-850 transition-[outline-color] ${
        selected ? 'outline outline-2 outline-offset-2 outline-accent' : 'outline-none'
      }`}
      style={{ width, height, transform: 'translateZ(0)' }}
    >
      {!isVideo && !failed && (
        <img
          src={mediaUrl.thumb(item.id, pickThumbSize(width))}
          alt=""
          width={width}
          height={height}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          // La taille est déjà réservée par le layout : la vignette se contente
          // de remplir sa case, sans jamais déplacer ses voisines.
          className={`size-full object-cover ${loaded ? 'fade-in' : 'opacity-0'}`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}

      {isVideo && (
        <div className="flex size-full items-center justify-center bg-ink-800">
          <svg viewBox="0 0 24 24" className="size-10 text-ink-400" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      )}

      {failed && !isVideo && (
        <div className="flex size-full items-center justify-center px-2 text-center text-[11px] text-ink-400">
          Aperçu indisponible
        </div>
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
