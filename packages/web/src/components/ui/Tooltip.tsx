import { type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';

/** Placement of a custom styled `Tooltip` relative to its trigger. */
export type TooltipSide = 'bottom' | 'top';

/** Props for the custom styled `Tooltip` wrapper. */
export interface TooltipProps {
  /** Text shown inside the tooltip bubble on hover or keyboard focus. */
  label: string;
  /** Vertical side where the bubble appears (default: `'bottom'`). */
  side?: TooltipSide;
  children: ReactNode;
}

/**
 * Custom styled tooltip bubble (`bg-[#24242b] border-[#454552] text-xs`) that replaces
 * native OS `title` tooltips on toolbar icon buttons.
 */
export function Tooltip({ label, side = 'bottom', children }: TooltipProps): ReactElement {
  const positionClass = side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5';

  return (
    <span className="group/tooltip relative inline-flex">
      {children}
      {label && (
        <span
          role="tooltip"
          className={`pointer-events-none invisible absolute left-1/2 z-50 -translate-x-1/2 rounded-md border border-[#454552] bg-[#24242b] px-2 py-1 text-xs font-medium whitespace-nowrap text-ink-100 opacity-0 shadow-lg transition-opacity duration-150 group-focus-within/tooltip:visible group-focus-within/tooltip:opacity-100 group-hover/tooltip:visible group-hover/tooltip:opacity-100 light:border-zinc-800 light:bg-zinc-900 light:text-zinc-50 ${positionClass}`}
        >
          {label}
        </span>
      )}
    </span>
  );
}

/** Visual tone when an `IconButton` is in its active state. */
export type IconButtonActiveTone = 'default' | 'gold' | 'accent';

/** Surface style for an `IconButton`. */
export type IconButtonSurface = 'outline' | 'ghost' | 'stage';

/** Props for the homogeneous `36x36` (`size-9`) `IconButton` primitive. */
export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'title' | 'children'
> {
  /** Accessible name and custom tooltip text. */
  label: string;
  /** Vector `<svg>` icon rendered inside the button. */
  children: ReactNode;
  /** Marks the button as toggled on (`aria-pressed` or open popover). */
  active?: boolean;
  /** Active highlight color (default: `'default'`, `'gold'` for favorites, `'accent'` for brand). */
  activeTone?: IconButtonActiveTone;
  /** Surface variant: `'outline'` for `AppTopBar`, `'ghost'` for subtle rows, `'stage'` for `LightboxChrome`. */
  surface?: IconButtonSurface;
  /** Optional numeric badge rendered in the top-right corner when `> 0`. */
  badgeCount?: number;
  /** Optional badge tone (`'accent'` for unread comments, `'gold'` for favorites count). */
  badgeTone?: 'accent' | 'gold' | 'neutral';
  /** Optional emerald dot in the top-right corner indicating active subscription. */
  statusDot?: boolean;
  /** Tooltip side (default: `'bottom'`). */
  tooltipSide?: TooltipSide;
  /** Suppresses the visual tooltip bubble when a menu or popover is already open. */
  hideTooltip?: boolean;
}

const SURFACE_CLASSES: Record<IconButtonSurface, string> = {
  outline:
    'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50 light:border-zinc-200 light:bg-white light:text-zinc-700 light:shadow-2xs light:hover:bg-zinc-100 light:hover:text-zinc-900',
  ghost: 'border border-transparent bg-transparent text-ink-300 hover:bg-tint hover:text-ink-100',
  stage: 'border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/15 hover:text-white',
};

const ACTIVE_TONE_CLASSES: Record<IconButtonActiveTone, string> = {
  default:
    'border-zinc-700 bg-zinc-800 text-zinc-50 light:border-zinc-300 light:bg-zinc-200 light:text-zinc-900',
  gold: 'border-amber-500/40 bg-amber-500/15 text-amber-400 light:border-amber-400 light:bg-amber-50 light:text-amber-600',
  accent: 'border-accent/40 bg-accent-soft text-accent',
};

const BADGE_TONE_CLASSES: Record<'accent' | 'gold' | 'neutral', string> = {
  accent: 'bg-accent text-accent-ink',
  gold: 'bg-amber-500 text-zinc-950',
  neutral: 'bg-zinc-700 text-zinc-100 light:bg-zinc-200 light:text-zinc-900',
};

/**
 * Homogeneous `36x36` (`size-9 rounded-full`) vector icon button with custom styled tooltip,
 * active state styling, and optional count badge or emerald status dot.
 */
export function IconButton({
  label,
  children,
  active = false,
  activeTone = 'default',
  surface = 'outline',
  badgeCount,
  badgeTone = 'accent',
  statusDot = false,
  tooltipSide = 'bottom',
  hideTooltip = false,
  className = '',
  type = 'button',
  ...rest
}: IconButtonProps): ReactElement {
  const baseClass = active ? ACTIVE_TONE_CLASSES[activeTone] : SURFACE_CLASSES[surface];
  const showCount = typeof badgeCount === 'number' && badgeCount > 0;

  const button = (
    <button
      type={type}
      aria-label={label}
      className={`relative inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${baseClass} ${className}`}
      {...rest}
    >
      {children}
      {showCount && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-xs leading-none font-semibold ${BADGE_TONE_CLASSES[badgeTone]}`}
        >
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      )}
      {!showCount && statusDot && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0.5 right-0.5 size-2 rounded-full bg-emerald-400 ring-2 ring-ink-900"
        />
      )}
    </button>
  );

  if (hideTooltip) return button;
  return (
    <Tooltip label={label} side={tooltipSide}>
      {button}
    </Tooltip>
  );
}

/** Vector star icon (`<svg>`) for Favorites controls (never a raw Unicode `★` character). */
export function StarIcon({
  filled = false,
  className = 'size-4',
}: {
  filled?: boolean;
  className?: string;
}): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

/** Vector speech-bubble icon (`<svg>`) for Recent Comments / Activity controls. */
export function CommentIcon({ className = 'size-4' }: { className?: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** Vector bell icon (`<svg>`) for Notifications / Follow controls (never a raw Unicode `🔔`). */
export function BellIcon({
  filled = false,
  className = 'size-4',
}: {
  filled?: boolean;
  className?: string;
}): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

/** Vector vertical three-dots (`⋮`) icon (`<svg>`) for secondary and mobile navigation menus. */
export function KebabIcon({ className = 'size-4' }: { className?: string }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  );
}

/**
 * Vector Info (`i`) icon (`<svg>`) with an explicit `<circle cx="12" cy="8" r="1" />` dot
 * so the dot never disappears when `strokeLinecap` is omitted or scaled.
 */
export function InfoIcon({ className = 'size-4' }: { className?: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
