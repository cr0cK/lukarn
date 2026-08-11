import { type InputHTMLAttributes, type ReactElement, useState } from 'react';

/** Tout ce qu'accepte un `input`, sauf son `type` — c'est le composant qui le décide. */
type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * Champ de mot de passe assorti d'un œil qui en montre les caractères.
 *
 * Une faute de frappe à l'aveugle ne se distingue pas d'un mot de passe oublié :
 * sans ce bouton, le seul recours est d'effacer et de recommencer, au clavier
 * mobile où la faute est la plus probable. L'état repart masqué à chaque
 * montage — on ne laisse pas un secret en clair derrière soi.
 */
export function PasswordInput({ className = '', ...props }: PasswordInputProps): ReactElement {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="relative">
      {/* `pr-11` réserve la place du bouton : sans lui, un mot de passe long
          passe dessous et la fin de la saisie devient illisible au moment même
          où on demande à la voir. */}
      <input {...props} type={revealed ? 'text' : 'password'} className={`${className} pr-11`} />
      <button
        type="button"
        onClick={() => setRevealed((shown) => !shown)}
        disabled={props.disabled}
        // Le libellé annonce ce que le clic **fera**, comme les contrôles de la
        // barre : « Afficher » sur un champ masqué.
        aria-label={revealed ? 'Hide the password' : 'Show the password'}
        title={revealed ? 'Hide the password' : 'Show the password'}
        // Décollé du bord plutôt que collé à `inset-y-0` : l'anneau de focus au
        // clavier déborde de 2 px, il serait rogné par le bord du champ.
        className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-ink-400 transition-colors hover:text-ink-100 disabled:opacity-60"
      >
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
          {revealed ? (
            <>
              <path d="M10.6 6.2A10.6 10.6 0 0 1 12 6c6.5 0 10 6 10 6a18.5 18.5 0 0 1-3.2 3.9" />
              <path d="M6.6 7.7A18.2 18.2 0 0 0 2 12s3.5 6 10 6a10.3 10.3 0 0 0 3.6-.6" />
              <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
              <path d="m3 3 18 18" />
            </>
          ) : (
            <>
              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}
