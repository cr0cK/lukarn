import type { ReactElement, ReactNode } from 'react';

/** Message d'issue d'une action, affiché en haut de la page d'administration. */
export interface Notice {
  tone: 'ok' | 'error';
  text: string;
}

/** Signale une issue d'action à la page. */
export type Notify = (notice: Notice) => void;

const BUTTON_VARIANTS = {
  default: 'border border-ink-600 text-ink-200 hover:bg-white/5',
  primary: 'bg-accent text-ink-950 hover:opacity-90',
  danger: 'border border-red-500/40 text-red-300 hover:bg-red-500/10',
  ghost: 'text-ink-300 hover:bg-white/5 hover:text-ink-100',
} as const;

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: keyof typeof BUTTON_VARIANTS;
  type?: 'button' | 'submit';
  /** Obligatoire quand le libellé visible ne suffit pas hors contexte. */
  ariaLabel?: string;
  title?: string;
}

export function Button({
  children,
  onClick,
  disabled = false,
  variant = 'default',
  type = 'button',
  ariaLabel,
  title,
}: ButtonProps): ReactElement {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_VARIANTS[variant]}`}
    >
      {children}
    </button>
  );
}

/** Bloc de la page d'administration : un titre, une action facultative, du contenu. */
export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="rounded-xl border border-ink-800 bg-ink-850/50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-850 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-ink-400">{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

const CONTROL_CLASS =
  'w-full rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-sm outline-none transition-colors placeholder:text-ink-400 focus:border-accent-dim disabled:opacity-60 read-only:text-ink-300';

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
  hint?: ReactNode;
  error?: string | null;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  inputMode?: 'numeric' | 'decimal';
  onBlur?: () => void;
  /** Rend un `textarea` : la description d'un album tient sur plusieurs lignes. */
  multiline?: boolean;
}

/** Champ de saisie avec son libellé, son aide et son erreur, tous reliés par `id`. */
export function TextField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  hint,
  error,
  placeholder,
  autoComplete,
  autoFocus,
  disabled,
  readOnly,
  inputMode,
  onBlur,
  multiline = false,
}: TextFieldProps): ReactElement {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  const shared = {
    id,
    value,
    placeholder,
    autoComplete,
    autoFocus,
    disabled,
    readOnly,
    onBlur,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    className: `${CONTROL_CLASS} ${error ? 'border-red-500/60' : ''}`,
  };

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm text-ink-300">
        {label}
      </label>
      {multiline ? (
        <textarea {...shared} rows={2} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          {...shared}
          type={type}
          inputMode={inputMode}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-400">
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-ink-400">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Case à cocher avec libellé cliquable et explication facultative. */
export function Checkbox({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}): ReactElement {
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div>
      <label
        htmlFor={id}
        className={`flex items-center gap-2.5 text-sm ${
          disabled ? 'cursor-not-allowed text-ink-400' : 'cursor-pointer text-ink-200'
        }`}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={hintId}
          onChange={(event) => onChange(event.target.checked)}
          className="size-4 shrink-0 accent-accent"
        />
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mt-1 ml-6 text-xs text-ink-400">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Erreur renvoyée par le serveur pour un formulaire entier. */
export function FormError({ message }: { message: string | null }): ReactElement | null {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {message}
    </p>
  );
}
