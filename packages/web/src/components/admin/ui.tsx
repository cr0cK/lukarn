import { type ReactElement, type ReactNode, useState } from 'react';
import { useT } from '../../lib/i18n';
import { PHONE_QUERY, useMediaQuery } from '../../lib/useMediaQuery';
import { PasswordInput } from '../PasswordInput';
import { Chevron } from './AdminNav';

/** Action outcome shown at the top of the administration page. */
export interface Notice {
  tone: 'ok' | 'error';
  text: string;
}

/** Reports an action outcome to the page. */
export type Notify = (notice: Notice) => void;

const BUTTON_VARIANTS = {
  default: 'border border-ink-600 text-ink-200 hover:bg-white/5',
  primary: 'bg-accent text-accent-ink hover:opacity-90',
  danger: 'border border-red-500/40 text-red-300 hover:bg-red-500/10',
  ghost: 'text-ink-300 hover:bg-white/5 hover:text-ink-100',
} as const;

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: keyof typeof BUTTON_VARIANTS;
  type?: 'button' | 'submit';
  /** Required when the visible label is insufficient outside its context. */
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

/**
 * Page block: a title, an optional description, an optional action and content.
 * Administration is built from these, and so is `/settings` — the reader's own
 * screen borrows the same primitives rather than growing a second look.
 */
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

/**
 * Administration row: description on one side, actions on the other.
 *
 * **Stacked below `xl`, in a row above it.** Side by side, only the description
 * block can shrink — buttons have `whitespace-nowrap` — and it fell to two
 * characters plus an ellipsis: "2…" for an album, an "administrator" badge cut
 * to "administ", or the `DriveSection` warning rendered one word per line. An
 * unreadable label no longer identifies anything.
 *
 * **`xl`, not `sm`**, because space remains scarce beyond phones: at `md`,
 * `AdminNav` becomes a column and takes 12 rem, so a four-button row still
 * clipped the title at 1024 px. Stacking costs one button height and preserves
 * the full title; common laptop widths (1280, 1366, 1440) stay above the
 * threshold and keep the row.
 *
 * Each caller still owns vertical alignment: a list row centres both blocks,
 * while a multiline comment keeps its button at the top. Two competing classes
 * in one string would be resolved by stylesheet order, not the order written here.
 */
export const ROW_CLASS = 'flex flex-col gap-3 xl:flex-row xl:gap-4';

/**
 * Row action group. In a row it aligns right; when stacked, it keeps button width
 * instead of stretching across the line.
 */
export const ROW_ACTIONS_CLASS = 'flex flex-wrap items-center gap-2 xl:justify-end';

const CONTROL_CLASS =
  'w-full rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-sm outline-none transition-colors placeholder:text-ink-400 focus:border-accent-dim disabled:opacity-60 read-only:text-ink-300';

/**
 * One setting as a **row**: its name on the left, what it currently reads on the
 * right, and a chevron that opens the field itself below.
 *
 * Below `md` only. A stacked label, field and hint is three lines of a phone
 * screen for a value nobody is changing today, and the settings section has
 * seven of them: the page became a form to scroll rather than a list to read.
 * As a row, the same seven settings are seven readable lines and the one being
 * changed is the only one taking room.
 *
 * It **discloses in place** rather than opening its own screen, because the
 * whole section is one form with one Save button — a row leading elsewhere would
 * have to save on its own, and a partial save is a different promise from the
 * one the button at the bottom makes.
 *
 * Open from the start when the value is empty: on a creation form every row
 * would otherwise be a closed row saying nothing, to be opened one at a time.
 */
export function SettingRow({
  label,
  value,
  alert = false,
  startOpen = false,
  children,
}: {
  label: string;
  /** The value as it currently reads. Empty means "not set", and opens the row. */
  value: string;
  /** Keeps the row open: an error nobody can see is an error nobody corrects. */
  alert?: boolean;
  /** Opens the row regardless — a field asking for focus is a field to show. */
  startOpen?: boolean;
  children: ReactNode;
}): ReactElement {
  const t = useT();
  const [open, setOpen] = useState(startOpen || value === '');
  const shown = open || alert;

  return (
    <div className="-mx-4 border-b border-ink-800 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={shown}
        className="flex min-h-12 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-white/5"
      >
        {/* The **label** keeps the room: it is what the eye scans down the list,
            and a truncated one no longer names anything. The value gives way
            first, capped at half the row — a long address reads in the field
            once the row is open, which is where it is edited anyway. */}
        <span className="min-w-0 flex-1 truncate text-sm text-ink-300">{label}</span>
        {/* Only while closed. Open, the field below **is** the value, and "Not
            set" printed beside an empty input someone is about to fill is a
            second answer to a question the input already asks. */}
        {!shown && (
          <span className="max-w-[50%] shrink-0 truncate text-right text-sm text-ink-100">
            {value || t('admin.notSet')}
          </span>
        )}
        {/* Quarter-turn down when open: the chevron says where the content is,
            and the same mark serves both states rather than two drawings. */}
        <span className={`shrink-0 transition-transform ${shown ? 'rotate-90' : ''}`}>
          <Chevron />
        </span>
      </button>

      {shown && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password' | 'email';
  hint?: ReactNode;
  error?: string | null;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  inputMode?: 'numeric' | 'decimal';
  onBlur?: () => void;
  /** Renders a `textarea`: an album description spans several lines. */
  multiline?: boolean;
}

/**
 * Input with label, help and error, all connected by `id`.
 *
 * **Two shapes.** From `md`, the label sits above the field, as it always has.
 * Below it, the same field lives inside a `SettingRow`: name on the left, value
 * on the right, opened by a chevron. The call sites are identical — every
 * administration form gets the list on a phone without a single one knowing.
 */
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
  const phone = useMediaQuery(PHONE_QUERY);
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

  const control = multiline ? (
    <textarea {...shared} rows={2} onChange={(event) => onChange(event.target.value)} />
  ) : type === 'password' ? (
    <PasswordInput {...shared} onChange={(event) => onChange(event.target.value)} />
  ) : (
    <input
      {...shared}
      type={type}
      inputMode={inputMode}
      onChange={(event) => onChange(event.target.value)}
    />
  );

  const messages = (
    <>
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
    </>
  );

  if (phone) {
    return (
      <SettingRow
        label={label}
        // Never the characters themselves for a password: the row is what a
        // shoulder reads first, and the field behind it already has its own
        // reveal button.
        value={type === 'password' && value ? '••••••••' : value}
        alert={Boolean(error)}
        startOpen={Boolean(autoFocus)}
      >
        {/* The row's own text is the label visually; the `<label>` stays in the
            document for the association `id` needs, hidden because a second
            copy two centimetres from the first names the field twice. */}
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        {control}
        {messages}
      </SettingRow>
    );
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm text-ink-300">
        {label}
      </label>
      {control}
      {messages}
    </div>
  );
}

/** One choice offered by a `SelectField`. */
export interface SelectOption {
  value: string;
  label: string;
  /**
   * Listed but not selectable. A setting whose second value is still being built
   * says so where it will appear, rather than arriving one day unannounced.
   */
  disabled?: boolean;
}

/**
 * Closed list of values, shaped like `TextField` and for the same reason.
 *
 * Every setting on a screen must be read the same way: a label above the control
 * from `md`, a `SettingRow` below it. A bare `<select>` beside two `TextField`s
 * would be the one control whose name sits somewhere else.
 *
 * The row shows the **label** of the current option, never its value: `fr` names
 * nothing to whoever is reading the list.
 */
export function SelectField({
  id,
  label,
  value,
  options,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  hint?: ReactNode;
}): ReactElement {
  const phone = useMediaQuery(PHONE_QUERY);
  const hintId = hint ? `${id}-hint` : undefined;
  const current = options.find((option) => option.value === value);

  const control = (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-describedby={hintId}
      // Capped rather than full-bleed like `TextField`, and the difference is
      // the control: a text field is as wide as what may be typed into it,
      // while a closed list is as wide as its longest option — "English" alone
      // across a 700 px column reads as a field somebody forgot to fill.
      //
      // `truncate` all the same: a select asks for the width of its longest
      // option, and a long one would push the field past the section on a phone.
      className={`${CONTROL_CLASS} truncate sm:max-w-xs`}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );

  const message = hint && (
    <p id={hintId} className="mt-1 text-xs text-ink-400">
      {hint}
    </p>
  );

  if (phone) {
    return (
      // `startOpen` is never set: a select always has a value, so the row always
      // has something to read, and opening every one of them would undo the list.
      <SettingRow label={label} value={current?.label ?? ''}>
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        {control}
        {message}
      </SettingRow>
    );
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm text-ink-300">
        {label}
      </label>
      {control}
      {message}
    </div>
  );
}

/** Checkbox with a clickable label and optional explanation. */
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

/** Server error applying to an entire form. */
export function FormError({ message }: { message: string | null }): ReactElement | null {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {message}
    </p>
  );
}
