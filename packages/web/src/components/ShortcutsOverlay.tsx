import { type ReactElement, useEffect } from 'react';

const GROUPS: { title: string; shortcuts: [string, string][] }[] = [
  {
    title: 'Albums',
    shortcuts: [
      ['/', 'Rechercher un album, un lieu, une photo'],
      ['↑ ↓', 'Parcourir les suggestions'],
      ['Entrée', 'Ouvrir la suggestion'],
      ['Échap', 'Fermer la liste, puis vider le champ'],
    ],
  },
  {
    title: 'Grille',
    shortcuts: [
      ['← ↑ ↓ →', 'Se déplacer entre les photos'],
      ['Entrée', 'Ouvrir en plein écran'],
      ['Début / Fin', 'Première / dernière photo'],
      ['Échap', 'Revenir aux albums'],
    ],
  },
  {
    title: 'Visionneuse',
    shortcuts: [
      ['← →', 'Photo précédente / suivante'],
      ['Échap', 'Quitter le zoom, puis fermer'],
      ['F', 'Plein écran'],
      ['I', 'Informations et EXIF'],
      ['C', 'Commentaires'],
      ['D', "Télécharger l'original"],
      ['Z', 'Zoom à 100 %'],
      ['L', 'Masquer / afficher la légende'],
      ['H', "Masquer l'habillage, rien que la photo"],
      ['Molette', 'Zoom progressif'],
      ['Glisser', "Se déplacer dans l'image, ou dans le repère en bas à droite"],
      ['Espace', 'Lecture / pause vidéo'],
    ],
  },
];

/** Aide-mémoire des raccourcis, ouverte avec `?`. */
export function ShortcutsOverlay({ onClose }: { onClose: () => void }): ReactElement {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === '?') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Raccourcis clavier"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-ink-700 bg-ink-850 p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-medium">Raccourcis clavier</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-400 transition-colors hover:text-ink-100"
            aria-label="Fermer"
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
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-3 text-xs tracking-wide text-ink-400 uppercase">{group.title}</h3>
              <dl className="space-y-2">
                {group.shortcuts.map(([keys, description]) => (
                  <div key={keys} className="flex items-baseline gap-3">
                    <dt className="w-24 shrink-0">
                      <kbd className="rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-ink-200">
                        {keys}
                      </kbd>
                    </dt>
                    <dd className="text-sm text-ink-300">{description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
