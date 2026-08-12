import { type InputHTMLAttributes, type ReactElement, useState } from 'react';
import { useT } from '../lib/i18n';

/** Everything an `input` accepts except `type`, which this component decides. */
type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * Password field with an eye button that reveals its characters.
 *
 * A hidden typo is indistinguishable from a forgotten password: without this
 * button, the only recourse is to clear and start again, on the mobile keyboard
 * where the typo is most likely. Each mount starts hidden — never leave a secret
 * visible behind.
 */
export function PasswordInput({ className = '', ...props }: PasswordInputProps): ReactElement {
  const t = useT();
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="relative">
      {/* `pr-11` reserves room for the button: without it, a long password runs
          underneath and its ending becomes unreadable just when it is revealed. */}
      <input {...props} type={revealed ? 'text' : 'password'} className={`${className} pr-11`} />
      <button
        type="button"
        onClick={() => setRevealed((shown) => !shown)}
        disabled={props.disabled}
        // The label announces what the click **will do**, like bar controls:
        // "Show" on a hidden field.
        aria-label={t(revealed ? 'password.hide' : 'password.show')}
        title={t(revealed ? 'password.hide' : 'password.show')}
        // Keep it away from the edge rather than using `inset-y-0`: the keyboard
        // focus ring extends 2 px and would be clipped by the field edge.
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
