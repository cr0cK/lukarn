import type { MediaDetail } from '@gdv/shared';
import type { ReactElement } from 'react';
import { CommentsPanel } from './CommentsPanel';
import { ExifPanel } from './ExifPanel';

/** Onglet affiché par le panneau latéral de la visionneuse. */
export type PanelTab = 'info' | 'comments';

/**
 * Panneau latéral de la visionneuse : métadonnées et commentaires, sous un seul
 * cadre à deux onglets.
 *
 * Deux `aside` distincts se seraient disputé la même place, chacun avec son
 * en-tête et son bouton de fermeture, et basculer de l'un à l'autre aurait
 * décalé l'image deux fois. Un cadre unique règle les deux : la photo se
 * rétrécit une fois, et l'onglet inactif reste à un clic.
 *
 * Sur écran large, ce rétrécissement est littéral — le panneau occupe une
 * colonne du flux. C'est ce qui permet de le laisser ouvert : en surimpression,
 * il recouvrait la flèche « Suivant ». Le zoom n'a rien à en savoir,
 * `ZoomableImage` mesurant son conteneur par `ResizeObserver`.
 */
export function SidePanel({
  albumId,
  mediaId,
  mediaName,
  detail,
  tab,
  onTabChange,
  onClose,
}: {
  albumId: string;
  mediaId: string;
  mediaName: string;
  detail: MediaDetail | undefined;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  onClose: () => void;
}): ReactElement {
  return (
    <aside
      // Deux régimes selon la largeur. À partir de `md`, le panneau est un
      // élément du flux : la zone photo rétrécit d'autant, les flèches de
      // navigation restent atteignables, et le panneau peut donc rester ouvert
      // d'une photo à l'autre. En dessous, il reprend la surimpression — 320 px
      // prélevés sur un écran de téléphone ne laisseraient rien à voir.
      className="absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-ink-700 bg-ink-900/95 backdrop-blur-sm md:relative md:z-0 md:w-80 md:shrink-0 md:bg-ink-900 md:backdrop-blur-none lg:w-96"
      aria-label="Informations et commentaires"
    >
      <header className="flex items-start justify-between gap-4 border-b border-ink-800 px-5 py-4">
        <h3 className="min-w-0 text-sm font-medium break-words text-ink-100">{mediaName}</h3>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-ink-400 transition-colors hover:text-ink-100"
          aria-label="Fermer le panneau (Échap)"
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
      </header>

      <div role="tablist" aria-label="Sections du panneau" className="flex border-b border-ink-800">
        <Tab selected={tab === 'info'} onSelect={() => onTabChange('info')} controls="panel-info">
          Infos
        </Tab>
        <Tab
          selected={tab === 'comments'}
          onSelect={() => onTabChange('comments')}
          controls="panel-comments"
        >
          Commentaires
          {/* Le compteur vient du détail du média, déjà chargé : afficher « 3 »
              avant même d'ouvrir l'onglet est ce qui donne envie de le lire. */}
          {detail && detail.commentCount > 0 && (
            <span className="ml-1.5 rounded-full bg-ink-700 px-1.5 py-0.5 text-[0.7rem] text-ink-200">
              {detail.commentCount}
            </span>
          )}
        </Tab>
      </div>

      {tab === 'info' ? (
        <div id="panel-info" role="tabpanel" className="flex-1 overflow-y-auto">
          <ExifPanel detail={detail} />
        </div>
      ) : (
        // Pas de `overflow-y-auto` ici : le panneau de commentaires gère
        // lui-même son défilement, pour garder son formulaire ancré en bas.
        <div id="panel-comments" role="tabpanel" className="flex min-h-0 flex-1 flex-col">
          <CommentsPanel albumId={albumId} mediaId={mediaId} />
        </div>
      )}
    </aside>
  );
}

function Tab({
  selected,
  onSelect,
  controls,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  controls: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={controls}
      onClick={onSelect}
      className={`flex-1 border-b-2 px-4 py-2.5 text-sm transition-colors ${
        selected
          ? 'border-accent text-ink-100'
          : 'border-transparent text-ink-400 hover:text-ink-200'
      }`}
    >
      {children}
    </button>
  );
}
