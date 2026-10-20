import {
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useState,
} from 'react';
import { AVAILABLE_LOCALES, LOCALE_NAMES, useT } from '../../lib/i18n';
import { PHONE_QUERY, useMediaQuery } from '../../lib/useMediaQuery';
import { PasswordInput } from '../PasswordInput';
import { Chevron } from './AdminNav';

/** Action outcome shown at the top of the administration page or inside a `Toast`. */
export interface Notice {
  tone: 'ok' | 'error';
  text: string;
}

/** Reports an action outcome to the page. */
export type Notify = (notice: Notice) => void;

/**
 * `shadcn/ui` v4 (`zinc`) + dynamic `--color-accent` pill button variants (D260813 / D260813c).
 *
 * - `primary`: dynamic instance `--color-accent` and `--color-accent-ink`.
 * - `secondary`: soft borderless `zinc` fill (`#27272a` in dark, `#f4f4f5` in light).
 * - `outline` / `default`: crisp `zinc` border (`border-zinc-800 bg-zinc-900` in dark,
 *   `border-zinc-200 bg-white shadow-2xs` in light).
 * - `danger`: destructive outline (`border-red-500/30 text-red-400` in dark,
 *   `border-red-200 text-red-600` in light).
 * - `ghost`: borderless hover tint.
 */
export const BUTTON_VARIANTS = {
  default:
    'border border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50 light:border-zinc-200 light:bg-white light:text-zinc-900 light:shadow-2xs light:hover:bg-zinc-100',
  outline:
    'border border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50 light:border-zinc-200 light:bg-white light:text-zinc-900 light:shadow-2xs light:hover:bg-zinc-100',
  primary: 'bg-accent text-accent-ink hover:bg-accent-dim',
  secondary:
    'bg-zinc-800 text-zinc-50 hover:bg-zinc-700 light:bg-zinc-100 light:text-zinc-900 light:hover:bg-zinc-200',
  danger:
    'border border-red-500/30 text-red-400 hover:bg-red-500/10 light:border-red-200 light:text-red-600 light:hover:bg-red-50',
  ghost: 'text-ink-300 hover:bg-tint hover:text-ink-100',
} as const;

/** Pill button size presets (`text-sm` minimum floor across all text buttons). */
export const BUTTON_SIZES = {
  md: 'h-9 px-3.5 text-sm font-medium',
  sm: 'h-8 px-3 text-sm font-medium',
  icon: 'size-9 p-0 text-sm font-medium',
} as const;

/** Props for the pill `Button` primitive. */
export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
  type?: 'button' | 'submit';
  /** Required when the visible label is insufficient outside its context. */
  ariaLabel?: string;
  title?: string;
  className?: string;
}

/**
 * Pill button (`rounded-full`) combining dynamic `--color-accent` for `primary`
 * with `shadcn/ui` v4 (`zinc`) `secondary`, `outline`, `danger`, and `ghost` variants.
 */
export function Button({
  children,
  onClick,
  disabled = false,
  variant = 'default',
  size = 'md',
  type = 'button',
  ariaLabel,
  title,
  className = '',
}: ButtonProps): ReactElement {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_SIZES[size]} ${BUTTON_VARIANTS[variant]} ${className}`.trim()}
    >
      {children}
    </button>
  );
}

/**
 * Page block: a title (`<h2>` at `text-xl font-semibold tracking-tight`), an optional
 * `text-sm` description, an optional top-right primary CTA (`action`), and content.
 *
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
    <section className="rounded-2xl border border-zinc-800 bg-ink-850/60 light:border-zinc-200 light:bg-white">
      <header className="flex items-start justify-between gap-4 border-b border-zinc-800/80 px-5 py-4 light:border-zinc-200">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-ink-100">{title}</h2>
          {description && <p className="mt-1 text-sm text-ink-400">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
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

/**
 * Shared class for `<input>`, `<select>`, and `<textarea>` controls.
 *
 * Uses the dedicated elevated input surface tokens (`--color-input: #222226`,
 * `--color-input-hover: #27272c`, `--color-input-border: #3a3a42` in dark mode;
 * crisp white in light mode) so fields stand out clearly above `--color-ink-850`
 * cards instead of sinking into black.
 *
 * `text-base md:text-sm`: `16px` below `md` prevents iOS Safari from auto-zooming
 * the viewport on focus, while `14px` (`md:text-sm`) matches the desktop body scale.
 */
export const FIELD_CLASS =
  'w-full rounded-lg border border-input-border bg-input px-3 py-2 text-base md:text-sm text-ink-100 outline-none transition-colors placeholder:text-ink-400 hover:bg-input-hover focus:border-accent disabled:opacity-60 read-only:text-ink-300';

const CONTROL_CLASS = FIELD_CLASS;

/** Standardized form `<label>` (`text-sm font-medium text-ink-200`). */
export function Label({
  htmlFor,
  children,
  className = '',
}: {
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <label
      htmlFor={htmlFor}
      className={`mb-1.5 block text-sm font-medium text-ink-200 ${className}`.trim()}
    >
      {children}
    </label>
  );
}

/** Bare elevated `<input>` primitive using `FIELD_CLASS`. */
export function Input({
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement>): ReactElement {
  return <input className={`${FIELD_CLASS} ${className}`.trim()} {...rest} />;
}

/** Bare elevated `<select>` primitive using `FIELD_CLASS`. */
export function Select({
  className = '',
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>): ReactElement {
  return (
    <select className={`${FIELD_CLASS} ${className}`.trim()} {...rest}>
      {children}
    </select>
  );
}

/** Bare elevated `<textarea>` primitive using `FIELD_CLASS`. */
export function Textarea({
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactElement {
  return <textarea className={`${FIELD_CLASS} ${className}`.trim()} {...rest} />;
}

/** Visual variants for `<Badge>` pills (`text-xs whitespace-nowrap`). */
export const BADGE_VARIANTS = {
  default:
    'border border-zinc-700/80 bg-zinc-800/80 text-zinc-200 light:border-zinc-200 light:bg-zinc-100 light:text-zinc-800',
  accent: 'border border-accent/30 bg-accent-soft text-accent',
  emerald:
    'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 light:border-emerald-200 light:bg-emerald-50 light:text-emerald-700',
  amber:
    'border border-amber-500/30 bg-amber-500/10 text-amber-300 light:border-amber-200 light:bg-amber-50 light:text-amber-700',
  red: 'border border-red-500/30 bg-red-500/10 text-red-300 light:border-red-200 light:bg-red-50 light:text-red-700',
  outline: 'border border-zinc-800 text-ink-300 light:border-zinc-200 light:text-zinc-700',
} as const;

/**
 * Non-breaking status or role pill (`text-xs font-medium whitespace-nowrap`).
 *
 * Uses `whitespace-nowrap` so role pills (`Admin`, `Visiteur`, `Commentateur`) never wrap
 * mid-word across two lines inside mobile cards or table cells.
 */
export function Badge({
  variant = 'default',
  children,
  className = '',
}: {
  variant?: keyof typeof BADGE_VARIANTS;
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${BADGE_VARIANTS[variant]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}

/**
 * Clean `rounded-2xl` surface card without nested bordered sub-boxes.
 *
 * When `divide` is true, internal sections are separated by `1px` dividers
 * (`divide-y divide-zinc-800 light:divide-zinc-200`).
 */
export function Card({
  divide = false,
  children,
  className = '',
}: {
  divide?: boolean;
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div
      className={`rounded-2xl border border-zinc-800 bg-ink-850/60 light:border-zinc-200 light:bg-white ${
        divide ? 'divide-y divide-zinc-800 light:divide-zinc-200' : ''
      } ${className}`.trim()}
    >
      {children}
    </div>
  );
}

/**
 * Toggle switch (`w-9 h-5 rounded-full`) using dynamic `bg-accent` when checked
 * and `bg-zinc-800` (dark) / `bg-zinc-200` (light) when unchecked.
 */
export function Switch({
  id,
  checked,
  onChange,
  label,
  hint,
  ariaLabel,
  disabled = false,
}: {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  hint?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
}): ReactElement {
  const hintId = id && hint ? `${id}-hint` : undefined;

  const button = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-describedby={hintId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-accent' : 'bg-zinc-800 light:bg-zinc-200'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block size-4 rounded-full bg-white shadow-xs transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );

  if (!label) return button;

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        {id ? (
          <label
            htmlFor={id}
            className={`block text-sm font-medium ${
              disabled ? 'cursor-not-allowed text-ink-400' : 'cursor-pointer text-ink-100'
            }`}
          >
            {label}
          </label>
        ) : (
          <span className="block text-sm font-medium text-ink-100">{label}</span>
        )}
        {hint && (
          <p id={hintId} className="mt-0.5 text-sm text-ink-400">
            {hint}
          </p>
        )}
      </div>
      {button}
    </div>
  );
}

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
        className="flex min-h-12 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-tint"
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
  /**
   * `datetime-local` for a link's expiry: the only date this interface asks somebody
   * to choose, and a text field would put the parsing on the person typing.
   */
  type?: 'text' | 'password' | 'email' | 'datetime-local';
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
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  hint?: ReactNode;
  /** While a form is submitting, so one live control is not left among frozen ones. */
  disabled?: boolean;
}): ReactElement {
  const phone = useMediaQuery(PHONE_QUERY);
  const hintId = hint ? `${id}-hint` : undefined;
  const current = options.find((option) => option.value === value);

  const control = (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
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

/**
 * The supported languages as options, each written in the language it names.
 *
 * One list for the three screens that offer a language — the reader's own settings,
 * and the two places an invitation is sent from. Built here rather than repeated at
 * each call site, since the day a third language ships is the day the copy that was
 * missed shows two.
 *
 * The labels never go through a catalogue: "Français" is spelt the same on an English
 * screen, and translating it would show "French" to somebody looking for their own
 * language in a list they cannot read.
 */
export function localeOptions(): SelectOption[] {
  return AVAILABLE_LOCALES.map((code) => ({ value: code, label: LOCALE_NAMES[code] }));
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

/**
 * One option of an exclusive choice, as a card carrying its own explanation.
 *
 * A bare radio with a label beside it cannot say what the option means, and every
 * exclusive choice in administration is between two things whose difference has to
 * be read before it is made: the wildcard against a selection of albums, a password
 * against an invitation. Callers pass one `name` to the group so the browser makes
 * them exclusive — the form then has no invalid state to validate afterwards.
 */
export function Choice({
  name,
  id,
  checked,
  onSelect,
  label,
  hint,
  disabled = false,
}: {
  /** Shared by every option of the group, and what makes them exclusive. */
  name: string;
  id: string;
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint: ReactNode;
  disabled?: boolean;
}): ReactElement {
  return (
    <label
      htmlFor={id}
      className={`flex gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      } ${checked ? 'border-accent-dim bg-accent/5' : 'border-ink-700 hover:bg-tint'}`}
    >
      <input
        id={id}
        name={name}
        type="radio"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        aria-describedby={`${id}-hint`}
        className="mt-0.5 size-4 shrink-0 accent-accent"
      />
      <span className="min-w-0">
        <span className="block text-sm text-ink-100">{label}</span>
        <span id={`${id}-hint`} className="block text-xs text-ink-400">
          {hint}
        </span>
      </span>
    </label>
  );
}

/** Server error applying to an entire form. */
export function FormError({ message }: { message: string | null }): ReactElement | null {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300 light:border-red-200 light:bg-red-50 light:text-red-700"
    >
      {message}
    </p>
  );
}
