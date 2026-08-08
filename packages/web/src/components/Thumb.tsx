import { THUMB_SIZES, type MediaItem, type ThumbSize } from '@gdv/shared';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { mediaUrl } from '../api/client';
import { formatDuration } from '../lib/format';
import { releaseIfDetached } from '../lib/imageRelease';

/**
 * Plus petite variante qui couvre la taille d'affichage réelle, densité de
 * l'écran comprise. Demander systématiquement du 1280 saturerait la bande
 * passante sur une grille de 200 vignettes.
 */
/**
 * Réessais d'une vignette en échec, et leur cadence.
 *
 * Deux suffisent : ils couvrent la saturation passagère d'une grille froide,
 * sans transformer une vraie panne en boucle. Le délai double, et une part
 * aléatoire le disperse — trente vignettes qui échouent ensemble ne doivent pas
 * repartir ensemble.
 */
const THUMB_RETRY_ATTEMPTS = 2;
const THUMB_RETRY_BASE_MS = 800;
const THUMB_RETRY_JITTER_MS = 600;

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
  /** Incrémenté à chaque réessai ; sert de `key` pour remonter le `<img>`. */
  const [attempt, setAttempt] = useState(0);
  const image = useRef<HTMLImageElement>(null);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Le nœud est capté à l'exécution de l'effet : au moment du nettoyage, React a
  // déjà remis la ref à `null`. `attempt` est en dépendance parce qu'un réessai
  // remonte l'`<img>` : sans lui, on libérerait l'ancien nœud, déjà détaché,
  // en laissant le nouveau poursuivre sa requête.
  useEffect(() => {
    const node = image.current;
    return () => releaseIfDetached(node);
  }, [attempt]);

  useEffect(() => () => clearTimeout(retry.current), []);

  /**
   * Un échec de vignette est le plus souvent **transitoire** : Drive limite le
   * débit, la ligne sature, le serveur rend 503. Renoncer au premier refus
   * laisserait une tuile vide jusqu'au prochain rechargement de page, alors que
   * la seconde d'après serait passée.
   *
   * Le délai est **dispersé** : une grille froide échoue par paquets, et des
   * réessais synchrones repartiraient tous ensemble saturer les six mêmes
   * connexions. Passé le dernier essai, la tuile sobre reste — c'est alors une
   * vraie panne, et l'annoncer vaut mieux que boucler.
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
   * Une vidéo a un aperçu quand Drive en produit un (D92) — c'est ce que dit
   * `hasPreview`, et c'est la seule question que la tuile a à poser : la règle
   * photo/vidéo se décide côté serveur. Sans aperçu, ou après trois échecs, la
   * tuile sobre reste.
   */
  const showImage = item.hasPreview && !failed;

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
      {showImage && (
        <img
          // Remonter l'élément est ce qui relance la requête : l'URL ne change
          // pas, et un 503 n'ayant pas d'en-tête de cache, le navigateur repart
          // bien vers le serveur.
          key={attempt}
          ref={image}
          src={mediaUrl.thumb(item.id, pickThumbSize(width), item.version)}
          alt=""
          width={width}
          height={height}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          // La taille est déjà réservée par le layout : la vignette se contente
          // de remplir sa case, sans jamais déplacer ses voisines.
          className={`size-full object-cover ${loaded ? 'fade-in' : 'opacity-0'}`}
          onLoad={() => setLoaded(true)}
          onError={onError}
        />
      )}

      {/* Vidéo sans aperçu Drive, ou dont la vignette a échoué : le fond sobre
          d'avant, sur lequel le badge de lecture reste la seule marque. */}
      {isVideo && !showImage && <div className="size-full bg-ink-800" />}

      {failed && !isVideo && (
        <div className="flex size-full items-center justify-center px-2 text-center text-[11px] text-ink-400">
          Aperçu indisponible
        </div>
      )}

      {/* Le badge se pose **par-dessus** l'aperçu : c'est lui qui distingue une
          vidéo d'une photo au premier coup d'œil, et le disque sombre est ce
          qui le garde lisible sur une image claire. Le triangle est décalé
          d'un pixel : centré géométriquement, il paraît penché à gauche. */}
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
