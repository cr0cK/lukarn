import { Fragment, type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';

/** Ce qu'une entrée de menu affiche : un libellé, une icône, un geste. */
export interface MenuEntry {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

interface ActionMenuProps {
  /** Groupes séparés par un filet. Les groupes vides sont ignorés. */
  groupes: MenuEntry[][];
  /**
   * Lignes de contexte en tête du menu, non cliquables. La première ressort,
   * les suivantes la précisent — un identifiant, puis l'adresse qui le signe.
   */
  entete?: string[];
  /** Nom accessible du bouton, s'il y a plusieurs menus sur la même page. */
  label?: string;
  /** Contenu du bouton. Les trois points par défaut, une pastille pour le compte. */
  trigger?: ReactNode;
  /** Habillage du bouton : la barre et la visionneuse n'ont pas le même fond. */
  triggerClassName?: string;
}

const TRIGGER_PAR_DEFAUT =
  'rounded-lg p-2 text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100';

/**
 * Le menu kebab des petits écrans, partagé par la barre supérieure et la
 * visionneuse.
 *
 * Un seul composant plutôt qu'un par emplacement : ce qui compte ici — fermer
 * au clic dehors, fermer à `Échap` en rendant le focus, fermer **avant**
 * d'exécuter l'action choisie — se réécrirait de travers la deuxième fois.
 *
 * Positionné en `absolute`, jamais en `fixed` : ses deux hôtes portent un
 * `backdrop-blur` ou vivent dans une pile de contextes, et `fixed` s'y
 * rapporterait à l'ancêtre filtré plutôt qu'à l'écran.
 */
export function ActionMenu({
  groupes,
  entete,
  label = 'Menu',
  trigger,
  triggerClassName = TRIGGER_PAR_DEFAUT,
}: ActionMenuProps): ReactElement {
  const [ouvert, setOuvert] = useState(false);
  const zone = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const remplis = groupes.filter((groupe) => groupe.length > 0);

  useEffect(() => {
    if (!ouvert) return;

    const surPointeur = (event: PointerEvent): void => {
      if (!zone.current?.contains(event.target as Node)) setOuvert(false);
    };
    const surTouche = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // Arrêter la propagation : dans la visionneuse, `Échap` ferme aussi la
      // photo, et un seul appui ne doit pas faire les deux.
      event.stopPropagation();
      setOuvert(false);
      // Rendre le focus au bouton : refermer au clavier ne doit pas renvoyer la
      // navigation en tête de page.
      bouton.current?.focus();
    };

    document.addEventListener('pointerdown', surPointeur);
    // En capture, pour passer avant les raccourcis de la visionneuse.
    document.addEventListener('keydown', surTouche, true);
    return () => {
      document.removeEventListener('pointerdown', surPointeur);
      document.removeEventListener('keydown', surTouche, true);
    };
  }, [ouvert]);

  return (
    <div ref={zone} className="relative shrink-0">
      <button
        ref={bouton}
        type="button"
        onClick={() => setOuvert((etat) => !etat)}
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={ouvert}
      >
        {trigger ?? (
          <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
            <circle cx="12" cy="5" r="1.75" />
            <circle cx="12" cy="12" r="1.75" />
            <circle cx="12" cy="19" r="1.75" />
          </svg>
        )}
      </button>

      {ouvert && (
        <div className="absolute top-full right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border border-ink-700 bg-ink-850 py-1 shadow-2xl">
          {/* Hors du `role="menu"`, qui n'admet que des `menuitem` : ces lignes
              ne se choisissent pas. `title` parce qu'une adresse un peu longue
              est tronquée plutôt que de faire grandir le menu. */}
          {entete && entete.length > 0 && (
            <>
              <div className="px-4 py-2">
                {entete.map((ligne, rang) => (
                  <p
                    key={ligne}
                    title={ligne}
                    className={
                      rang === 0 ? 'truncate text-sm text-ink-200' : 'truncate text-xs text-ink-400'
                    }
                  >
                    {ligne}
                  </p>
                ))}
              </div>
              <div className="mb-1 h-px bg-ink-700" />
            </>
          )}

          <div role="menu">
            {remplis.map((groupe, rang) => (
              <Fragment key={groupe[0]!.label}>
                {rang > 0 && <div role="separator" className="my-1 h-px bg-ink-700" />}
                {groupe.map((entree) => (
                  <button
                    key={entree.label}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      // Fermer d'abord : `onSelect` peut naviguer ou ouvrir un
                      // panneau, et un menu laissé ouvert se retrouverait
                      // par-dessus ce qu'il vient de déclencher.
                      setOuvert(false);
                      entree.onSelect();
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-200 transition-colors hover:bg-white/5 hover:text-ink-100"
                  >
                    <span className="shrink-0 text-ink-400">{entree.icon}</span>
                    {entree.label}
                  </button>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
