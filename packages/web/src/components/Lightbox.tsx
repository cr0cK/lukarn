import type { AlbumDay, MediaItem } from '@gdv/shared';
import { type ReactElement, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { errorText, mediaUrl } from '../api/client';
import { useCommentCounts, useMediaDetail, useUpdateAlbum } from '../api/hooks';
import { useCaptionHidden } from '../lib/caption';
import { dayKey, dayLabel } from '../lib/justify';
import { previewOverlay } from '../lib/preview';
import { unreadCount, useSeenComments } from '../lib/seenComments';
import { isTyping } from '../lib/typing';
import { placeLabelOf } from '../lib/useGridLayout';
import { useSwipe } from '../lib/useSwipe';
import { ActionMenu } from './ActionMenu';
import { MediaCaption } from './MediaCaption';
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
  /**
   * Titre de l'album, en tête du fil de contexte. La visionneuse est une vue à
   * part entière — on y arrive par un lien partagé, sans avoir vu la grille —
   * et sans lui la photo ne dit plus de quel album elle vient.
   */
  albumTitle: string;
  items: MediaItem[];
  index: number;
  /**
   * Total de l'album, et non `items.length` : la liste grandit page après page,
   * si bien qu'une progression calculée dessus reculait à chaque chargement —
   * « 40 / 50 » redevenait « 40 / 100 » sous les yeux de qui feuillette.
   */
  total: number;
  /** Journées annotées, pour porter le contexte du jour jusque dans l'image. */
  days: Map<string, AlbumDay>;
  /** Description de l'album, troisième et dernière ligne du bandeau de légende. */
  albumDescription: string | null;
  /** Couverture actuelle de l'album, pour signaler la photo qui l'est déjà. */
  coverId: string | null;
  /**
   * Administrateur : lui seul peut désigner la couverture et décrire une photo.
   * Un booléen pour les deux — ce sont les deux affordances que la visionneuse
   * réserve à l'administrateur, et deux drapeaux toujours égaux finiraient par
   * ne plus l'être.
   */
  isAdmin: boolean;
  /**
   * Onglet ouvert du panneau latéral, `null` s'il est fermé. Piloté par la page
   * parce qu'il vit dans l'URL : c'est ce qui permet d'arriver directement sur
   * une conversation depuis le tiroir d'activité ou depuis un email.
   */
  panel: PanelTab | null;
  onPanelChange: (panel: PanelTab | null) => void;
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
 *
 * L'en-tête **situe** la photo — l'album, la journée, le lieu ; le bandeau bas
 * (`MediaCaption`) **la raconte** — ce que quelqu'un a écrit sur elle et sur son
 * jour, à toutes les largeurs. L'horodatage exact, lui, reste dans le panneau
 * `i` où il vivait déjà, avec le nom du fichier.
 */
export function Lightbox({
  albumId,
  albumTitle,
  items,
  index,
  total,
  days,
  albumDescription,
  coverId,
  isAdmin,
  panel,
  onPanelChange,
  onIndexChange,
  onClose,
  onNeedMore,
}: LightboxProps): ReactElement | null {
  const item = items[index];
  const isVideo = item?.kind === 'video';
  const [zoomed, setZoomed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  /**
   * Lecture impossible. Propre à la vidéo : la photo tient son propre échec
   * dans `ZoomableImage`. Sans cet état, une vidéo qui n'arrive pas — Drive
   * indisponible, jeton révoqué, ou codec que le navigateur ne décode pas —
   * laisse `loaded` à `false` et le tourniquet tourne indéfiniment sur un écran
   * noir muet.
   */
  const [failed, setFailed] = useState(false);
  /** Sens du dernier déplacement : oriente le préchargement. */
  const [direction, setDirection] = useState(1);
  /**
   * Bandeau de légende. Le masquage est un réglage d'affichage, retenu d'une
   * visite à l'autre ; l'ouverture de l'éditeur est pilotée ici parce que c'est
   * la visionneuse qui écoute `Échap`.
   */
  const { hidden: captionHidden, setHidden: setCaptionHidden } = useCaptionHidden();
  const [editingCaption, setEditingCaption] = useState(false);
  /**
   * Habillage escamoté : plus d'en-tête ni de flèches, rien que la photo.
   *
   * Distinct du masquage de la légende, et les deux portées ne se recouvrent
   * pas : `l` range le texte du bas, `h` range tout ce que la visionneuse pose
   * sur l'image. L'état ne suit pas la photo, on le règle une fois pour
   * regarder — mais il n'est pas retenu d'une visite à l'autre, contrairement à
   * la légende : une visionneuse qui rouvrirait sans un seul repère laisserait
   * qui a oublié le raccourci devant une image muette.
   */
  const [bare, setBare] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { data: detail } = useMediaDetail(albumId, panel && item ? item.id : null);

  const setCover = useUpdateAlbum();
  // L'échec ne doit pas suivre jusqu'à la photo suivante : le message y
  // désignerait une image qui n'a rien à voir avec l'action qui a échoué.
  const resetCoverError = setCover.reset;
  useEffect(() => resetCoverError(), [index, resetCoverError]);

  /**
   * Pastille du bouton « Commentaires ». Le total vient d'un appel unique pour
   * l'album, le repère de lecture du navigateur : voir `lib/seenComments.ts`.
   */
  const { data: commentCounts } = useCommentCounts(albumId);
  const { seen, markSeen } = useSeenComments(albumId);
  const mediaId = item?.id;
  const commentTotal = (mediaId && commentCounts?.counts[mediaId]) || 0;
  const unread = unreadCount(commentTotal, mediaId ? seen[mediaId] : 0);

  useEffect(() => {
    // Tant que les compteurs ne sont pas là, tout vaut zéro : marquer ici
    // effacerait le repère de lecture pour le reconstituer faux à l'arrivée
    // des vrais totaux.
    if (!mediaId || commentCounts === undefined) return;

    // Le panneau ouvert vaut lecture. Et un total retombé **sous** le repère
    // — suppression, masquage par la modération — doit le faire redescendre :
    // sinon le message suivant resterait invisible tant qu'il n'aurait pas
    // comblé l'écart.
    if (panel === 'comments' || commentTotal < (seen[mediaId] ?? 0)) {
      markSeen(mediaId, commentTotal);
    }
  }, [panel, mediaId, commentTotal, commentCounts, seen, markSeen]);

  /** Ouvre le panneau sur cet onglet, ou le referme s'il y est déjà. */
  const togglePanel = useCallback(
    (tab: PanelTab) => {
      onPanelChange(panel === tab ? null : tab);
    },
    [panel, onPanelChange],
  );

  /**
   * Un clic hors du panneau le referme, comme n'importe quel tiroir.
   *
   * Posé en **capture** et non en bulle : le basculement du zoom se décide au
   * relâchement du pointeur dans `ZoomableImage`, plus bas dans l'arbre. En
   * bulle, les deux gestes se déclencheraient ensemble — le panneau se fermerait
   * *et* la photo zoomerait. Interrompre dès la descente laisse le premier clic
   * à la fermeture ; le suivant zoome normalement.
   *
   * Les boutons de cette zone sont exclus. Les flèches de navigation y vivent,
   * et les traiter comme un « dehors » refermerait le panneau à chaque photo :
   * précisément ce qu'on venait de corriger en lui donnant sa propre colonne.
   * Le repère de position du zoom porte `role="img"` et s'exclut de même — il ne
   * peut pas se défendre lui-même, une capture s'exécutant avant sa cible.
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
      // `Début` sur le premier média, `Fin` sur le dernier, une flèche à une
      // extrémité : l'index demandé est déjà celui affiché. Sans ce garde-fou,
      // `setLoaded(false)` attendrait un chargement qui ne viendra pas — aucun
      // élément n'est remonté, donc aucun `loadeddata` n'est émis, et le
      // tourniquet de la vidéo tourne indéfiniment.
      if (next < 0 || next >= items.length || next === index) return;
      setDirection(next >= index ? 1 : -1);
      setZoomed(false);
      setLoaded(false);
      setFailed(false);
      // Un éditeur resté ouvert écrirait sur la photo qu'on vient de quitter :
      // le champ est remonté avec la nouvelle photo, pas le geste en cours.
      setEditingCaption(false);
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
      if (event.key !== 'Escape' && isTyping(event.target)) return;

      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          // Échap défait la dernière couche ouverte plutôt que de tout fermer :
          // sortir de l'éditeur, puis du zoom, puis du panneau, puis de la
          // visionneuse. L'éditeur passe en premier parce que c'est la seule
          // couche qui contienne une saisie en cours : sans lui, Échap depuis le
          // champ fermerait la visionneuse par-dessus un texte non enregistré.
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

  /**
   * Même règle que la photo, sans l'aperçu flou : une vidéo n'a pas de rendu
   * serveur, donc rien à montrer en attendant — d'où `measured: false`. La
   * combinaison est décidée là plutôt qu'en JSX parce qu'elle échoue en
   * silence : un tourniquet laissé sur un échec ne casse rien, il fait
   * seulement croire que ça charge encore.
   */
  const videoOverlay = previewOverlay({ loaded, failed, measured: false });

  // Les mêmes fonctions que la grille, délibérément : une visionneuse qui
  // calculerait son libellé de jour de son côté finirait par annoncer une autre
  // date que l'en-tête de section d'où l'on vient de cliquer.
  const day = days.get(dayKey(item.takenAt));
  const dayPlace = placeLabelOf(day);
  // `total` peut être en retard sur la liste — un album synchronisé pendant
  // qu'on le feuillette : le compteur ne doit jamais afficher « 60 / 50 ».
  const count = Math.max(total, items.length);

  // Les actions sont décrites une fois et rendues de deux façons : en icônes
  // alignées à partir de `sm`, en lignes libellées dans le menu en dessous. Les
  // dupliquer laisserait un raccourci, une icône ou un état actif se désaccorder
  // entre les deux.
  const isCover = item.id === coverId;

  const actions: {
    label: string;
    /** Absent pour une action sans raccourci : voir « Définir comme couverture ». */
    shortcut?: string;
    icon: ReactNode;
    active?: boolean;
    onSelect: () => void;
  }[] = [
    {
      label: 'Informations',
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
            label: zoomed ? 'Revenir à la taille écran' : 'Zoomer',
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
      label: "Télécharger l'original",
      shortcut: 'd',
      onSelect: download,
      icon: <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />,
    },
    {
      label: 'Plein écran',
      shortcut: 'f',
      onSelect: toggleFullscreen,
      icon: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
    },
    {
      label: "Masquer l'habillage",
      shortcut: 'h',
      onSelect: () => setBare(true),
      // Un œil barré : c'est ce qui disparaît, pas ce qui reste.
      icon: (
        <>
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
          <circle cx="12" cy="12" r="2.5" />
          <path d="m4 20 16-16" />
        </>
      ),
    },
    // Réservée à l'administrateur, et jamais sur une vidéo : le pipeline ne
    // décode pas de vignette vidéo, un album en couverture resterait vide.
    //
    // Pas de raccourci clavier, contrairement aux quatre autres : c'est un
    // geste qu'on fait une fois par album, pas une commande de lecture, et
    // l'aide-mémoire `?` s'adresse à tout le monde.
    //
    // Aucun raccourci non plus pour revenir à l'automatique — c'est le bouton
    // de /admin. Reconfirmer la photo déjà en couverture n'est donc pas un
    // clic perdu : elle l'était peut-être par défaut, et cela la fixe, si bien
    // que la prochaine photo synchronisée ne la remplacera plus.
    ...(isAdmin && !isVideo
      ? [
          {
            label: isCover ? "Couverture de l'album" : 'Définir comme couverture',
            active: isCover,
            onSelect: () => setCover.mutate({ albumId, body: { coverId: item.id } }),
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
      className="fixed inset-0 z-50 flex bg-ink-950 outline-none"
    >
      {/* Colonne de la photo. Elle **rétrécit** quand le panneau entre dans le
          flux (à partir de `md`) : posé en surimpression, celui-ci recouvrait la
          flèche « Suivant », si bien qu'il fallait le refermer à chaque photo.
          `min-w-0` est indispensable — sans lui, le contenu impose sa largeur
          et c'est le panneau qui déborde de l'écran. */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Le voile est ce qui rend l'en-tête lisible : sans lui, du texte clair
            sur un ciel surexposé ne se lit pas du tout. Il couvre deux lignes —
            album et jour, puis le lieu —, symétrique de celui du bandeau bas, et
            sa base transparente garde la transition douce plutôt que de poser
            une barre noire au bord de la photo. */}
        <header
          hidden={bare}
          className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/85 via-black/55 to-transparent pb-8"
        >
          {/* Collée au bord haut, comme une barre de chargement : elle reste
              lisible sans mordre sur la photo. Plus bas, elle traversait
              l'image — un trait de couleur au milieu d'un cadrage. */}
          <div
            className="h-0.5 w-full bg-white/15"
            role="progressbar"
            aria-valuenow={index + 1}
            aria-valuemin={1}
            aria-valuemax={count}
            aria-label="Progression dans l'album"
          >
            <div
              className="h-full bg-accent transition-[width] duration-200"
              style={{ width: `${((index + 1) / count) * 100}%` }}
            />
          </div>

          {/* `items-start` : tout se cale sur la **première ligne** de texte.
              Les retraits hauts ci-dessous sont calculés pour que le nom du
              fichier, le compteur et le centre des icônes tombent sur la même
              horizontale — 6 px sous `sm` (bouton de 32), 8 px au-delà (36).

              Les marges latérales tiennent compte de l'encoche : en paysage, sur
              un iPhone posé sur l'écran d'accueil, elle recouvre exactement le
              bouton Fermer. Elles sont posées ici et non sur l'en-tête, pour que
              le dégradé et la barre de progression aillent bien jusqu'au bord. */}
          <div className="flex items-start gap-1 py-2 pl-[calc(0.5rem_+_env(safe-area-inset-left))] pr-[calc(0.5rem_+_env(safe-area-inset-right))] sm:gap-2 sm:py-3 sm:pl-[calc(1rem_+_env(safe-area-inset-left))] sm:pr-[calc(1rem_+_env(safe-area-inset-right))]">
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-full p-1.5 text-ink-200 transition-colors sm:p-2 hover:bg-white/10 hover:text-white"
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

            <div className="min-w-0 flex-1 pt-1.5 sm:pt-2">
              {/* L'en-tête **situe** la photo, le bandeau bas **la raconte** :
                  ici l'album et la journée, là ce que quelqu'un a écrit. Le nom
                  de fichier occupait cette place en gras sans rien apprendre à
                  personne — `IMG_0004.jpg` ne dit ni où ni quand — et masquait
                  l'album, seule information qui manque vraiment quand on arrive
                  par un lien partagé. Il reste en tête du panneau `i`, auprès
                  des données techniques qu'il accompagne.

                  C'est le **titre d'album** qui se tronque, jamais la date : sur
                  un téléphone, la ligne ne tient pas les deux, et un
                  « Allemagne – Forêt Noire · Aujo… » sacrifie précisément ce
                  qu'on cherchait à donner. D'où le `truncate` sur le seul album
                  et un `shrink-0` sur la date, qui est courte et bornée. */}
              <p className="flex min-w-0 items-baseline text-sm leading-5 font-semibold text-ink-100">
                {albumTitle && (
                  <>
                    <span className="truncate">{albumTitle}</span>
                    <span className="shrink-0 px-1.5 text-ink-400">·</span>
                  </>
                )}
                <span className="shrink-0">{dayLabel(dayKey(item.takenAt))}</span>
              </p>
              {/* Le lieu prend sa propre ligne, la première étant désormais
                  pleine. La note du jour, elle, est descendue dans le bandeau
                  bas (D84) : elle est écrite à la main, comme la description de
                  la photo, et les deux se lisent ensemble ou pas du tout. */}
              {dayPlace && (
                <p className="truncate text-xs leading-4 text-ink-300" title={dayPlace}>
                  {dayPlace}
                </p>
              )}
            </div>

            {/* Même retrait que le bloc de texte : le compteur tombe sur la
                ligne du nom de fichier, pas entre deux lignes. */}
            <span className="shrink-0 pt-1.5 text-xs leading-5 text-ink-300 tabular-nums sm:pt-2">
              {index + 1} / {count}
            </span>

            {/* Les commentaires restent **toujours** en ligne, contrairement aux
                autres actions : leur icône porte la pastille des non-lus, et
                c'est le seul signe qu'une photo a été commentée. Rangée dans le
                menu, elle ne signalerait plus rien. */}
            <div className="flex shrink-0 items-center gap-0.5 sm:gap-2">
              <IconButton
                label={commentsLabel(commentTotal, unread)}
                active={panel === 'comments'}
                onClick={() => togglePanel('comments')}
                badge={<CommentBadge total={commentTotal} unread={unread} />}
              >
                <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />
              </IconButton>

              {/* À partir de `sm`, la place est là : tout s'aligne. */}
              <div className="hidden items-center gap-0.5 sm:flex sm:gap-2">
                {actions.map((action) => (
                  <IconButton
                    key={action.label}
                    label={action.shortcut ? `${action.label} (${action.shortcut})` : action.label}
                    active={action.active}
                    onClick={action.onSelect}
                  >
                    {action.icon}
                  </IconButton>
                ))}
              </div>

              <div className="sm:hidden">
                <ActionMenu
                  label="Actions de la photo"
                  triggerClassName="rounded-full p-1.5 text-ink-200 transition-colors hover:bg-white/10 hover:text-white"
                  groupes={[
                    actions.map((action) => ({
                      // Sans le raccourci clavier : ce menu ne s'ouvre qu'au
                      // toucher, où « (i) » n'est qu'une syllabe de plus à lire.
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
            </div>
          </div>
        </header>

        {/* `touch-action` décide si les deux gestes au doigt de cette colonne
            aboutissent : le balayage d'une photo à l'autre, et le déplacement
            dans une photo agrandie. Avec la valeur par défaut `auto`, le
            navigateur garde le droit de lire le glissement comme un
            défilement ; il tranche en ce sens au bout d'un ou deux
            `pointermove`, émet `pointercancel`, et les deux gestes meurent en
            route — ce qui se ressent comme une lenteur plutôt que comme une
            interruption. `setPointerCapture` n'y change rien : il garantit de
            recevoir la suite des événements, pas que le geste survive.

            `pinch-zoom` plutôt que `none` : il ne retire que le défilement à un
            doigt, et laisse le pincement à deux doigts, qui reste le geste de
            zoom spontané sur téléphone. Posé ici plutôt que dans
            `ZoomableImage` parce que la règle est la même pour toute la colonne
            et qu'un descendant en hérite par intersection (D77).

            Sauf sur une vidéo, dont les contrôles natifs de lecture ont leur
            propre traitement du toucher — le balayage y est déjà désactivé. */}
        <div
          className={`relative flex flex-1 items-center justify-center overflow-hidden ${
            isVideo ? '' : 'touch-pinch-zoom'
          }`}
          {...swipe}
          onPointerDownCapture={dismissPanelOnOutsideClick}
        >
          {isVideo && videoOverlay.error ? (
            <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
              <p className="text-sm text-ink-300">Cette vidéo n'a pas pu être lue.</p>
              {/* Le format en cause plutôt qu'un « une erreur est survenue » :
                  c'est presque toujours un codec que ce navigateur ne décode
                  pas (D79), et le fichier reste parfaitement lisible ailleurs.
                  Sans le téléchargement, la vidéo serait simplement perdue. */}
              <p className="text-xs text-ink-400">
                Son format n'est peut-être pas lisible par ce navigateur. Le fichier d'origine reste
                téléchargeable.
              </p>
              <button
                type="button"
                onClick={download}
                className="rounded border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition-colors hover:border-ink-600 hover:text-ink-100"
              >
                Télécharger
              </button>
            </div>
          ) : isVideo ? (
            <video
              ref={videoRef}
              key={item.id}
              src={mediaUrl.original(item.id, item.version)}
              controls
              autoPlay
              playsInline
              className="max-h-full max-w-full"
              onLoadedData={() => setLoaded(true)}
              onError={() => setFailed(true)}
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

          {isVideo && videoOverlay.spinner && (
            <span className="absolute size-8 animate-spin rounded-full border-2 border-ink-700 border-t-accent" />
          )}

          {/* Masquées pendant le zoom : le glisser sert alors à se déplacer dans
            l'image, et les flèches tomberaient sous le curseur. Masquées aussi
            quand l'habillage est escamoté — « rien que la photo » ne s'arrête
            pas au texte. Les touches ←/→ et le balayage, eux, continuent : on
            escamote ce qui se voit, pas ce qui se pilote. */}
          {!zoomed && !bare && (
            <NavButton
              side="left"
              disabled={index === 0}
              onClick={() => goTo(index - 1)}
              label="Précédent (←)"
            />
          )}
          {!zoomed && !bare && (
            <NavButton
              side="right"
              disabled={index === items.length - 1}
              onClick={() => goTo(index + 1)}
              label="Suivant (→)"
            />
          )}

          {/* Le seul retour possible une fois tout escamoté, et il doit se
              trouver sans le chercher : au coin, à la place qu'occupaient les
              actions. Sans lui, la sortie ne tiendrait qu'à `h` ou à `Échap`,
              c'est-à-dire à rien pour qui touche l'écran. */}
          {bare && (
            <button
              type="button"
              onClick={() => setBare(false)}
              title="Afficher l'habillage (h)"
              aria-label="Afficher l'habillage (h)"
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

          {/* Une couverture refusée — session expirée, rôle retiré entre-temps —
              doit se voir : le bouton reprend son état d'origine, et sans ce
              message rien ne distinguerait l'échec de l'absence de clic. Il
              part à la photo suivante, ou à la tentative suivante.

              `bottom-28` et non `bottom-6` : le bandeau de légende occupe
              désormais le bas de la colonne, et un message d'erreur posé
              dessous serait recouvert par le texte qu'il doit interrompre. */}
          {setCover.isError && (
            <p
              role="alert"
              className="absolute inset-x-4 bottom-28 mx-auto max-w-md rounded-lg bg-red-950/90 px-3 py-2 text-center text-xs text-red-200 shadow-lg"
            >
              {errorText(setCover.error, "La couverture n'a pas pu être enregistrée.")}
            </p>
          )}
        </div>

        {/* Masqué pendant le zoom, comme les flèches de navigation : le doigt y
            sert à se déplacer dans l'image, et le bandeau tomberait dessous.

            `key` sur le média : le dépliement se remet à plat d'une photo à
            l'autre, il répond à un texte précis et pas au suivant.

            Sur une vidéo, `overlay={false}` : le bandeau entre dans le flux et
            la colonne prend d'autant — c'est le seul endroit où il pousse au
            lieu de recouvrir, les contrôles natifs de lecture vivant au bas de
            la balise.

            Escamoté aussi par `h`, et pas seulement replié comme le fait `l` :
            « rien que la photo » ne s'arrête pas au haut de l'écran, et le
            bouton « Afficher la légende » que `l` laisse en place est encore
            quelque chose de posé dessus. */}
        {!zoomed && !bare && (
          <MediaCaption
            key={item.id}
            albumId={albumId}
            mediaId={item.id}
            description={item.description}
            day={day?.description ?? null}
            album={albumDescription}
            editable={isAdmin}
            hidden={captionHidden}
            onHiddenChange={setCaptionHidden}
            editing={editingCaption}
            onEditingChange={setEditingCaption}
            overlay={!isVideo}
          />
        )}
      </div>

      {panel && (
        <SidePanel
          albumId={albumId}
          mediaId={item.id}
          mediaName={item.name}
          detail={detail}
          day={days.get(dayKey(item.takenAt))}
          tab={panel}
          onTabChange={onPanelChange}
          onClose={() => onPanelChange(null)}
        />
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
  /** Pastille superposée à l'icône. Elle doit rester `aria-hidden` : ce qu'elle
      dit appartient à `label`, sinon un lecteur d'écran annonce un chiffre nu. */
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
      // Padding resserré sur petit écran : cinq icônes plus la croix laissaient
      // une quarantaine de pixels à la date, qui était donc toujours tronquée.
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
 * Pastille du bouton « Commentaires ».
 *
 * Deux états distincts, parce qu'ils répondent à deux questions différentes :
 * un point sobre dit « il y a une conversation ici », un chiffre en couleur dit
 * « elle a bougé depuis ton dernier passage ». Les confondre reviendrait à
 * réclamer l'attention pour une photo dont on a déjà tout lu.
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
      // Plafonné à « 9+ » : au-delà, le chiffre déborde de l'icône, et savoir
      // s'il y a douze ou dix-sept messages non lus ne change aucun geste.
      className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[0.625rem] leading-4 font-semibold text-ink-950 tabular-nums"
    >
      {unread > 9 ? '9+' : unread}
    </span>
  );
}

/**
 * Libellé accessible du bouton : c'est lui qui porte l'information de la
 * pastille, celle-ci étant purement visuelle.
 */
function commentsLabel(total: number, unread: number): string {
  if (total === 0) return 'Commentaires (c)';
  if (unread === 0) return `Commentaires : ${total} (c)`;
  return `Commentaires : ${total}, dont ${unread} non ${unread > 1 ? 'lus' : 'lu'} (c)`;
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
