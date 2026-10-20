import { type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../../api/hooks';
import { useT } from '../../lib/i18n';
import { useHideOnScroll } from '../../lib/useHideOnScroll';
import { AccountIcon, AccountMenu } from '../AccountMenu';
import { Brand } from '../Brand';
import { BellIcon, CommentIcon, IconButton, StarIcon } from './Tooltip';

/** Favorites (`[★]`) button descriptor for `AppTopBar`. */
export interface AppTopBarFavoritesControl {
  /** Whether the favorites filter is currently active on the grid. */
  active: boolean;
  /** Number of favorited photos in the current scope (shown as badge when `> 0`). */
  count: number;
  /** Accessible label and custom tooltip text. */
  label: string;
  /** Toggles the favorites filter (or opens identification on an unverified share). */
  onToggle: () => void;
}

/** Recent comments feed (`[💬]`) button descriptor for `AppTopBar`. */
export interface AppTopBarCommentsControl {
  /** Whether the public `ActivitySheet` is currently open. */
  open?: boolean;
  /** Number of unread comments (shown as badge when `> 0`). */
  unread: number;
  /** Accessible label and custom tooltip text. */
  label: string;
  /** Opens or toggles the public `ActivitySheet` (never redirects to `/admin/activity`). */
  onToggle: () => void;
}

/** Notifications / Follow (`[🔔]`) button descriptor for `AppTopBar`. */
export interface AppTopBarNotificationsControl {
  /** Whether the notification preferences popover is currently open. */
  open?: boolean;
  /** Whether the current viewer is subscribed to photo or comment notifications. */
  subscribed?: boolean;
  /** Accessible label and custom tooltip text. */
  label: string;
  /** Opens either the notification preferences popover or the share identification modal. */
  onToggle: () => void;
  /** Optional anchored popover rendered directly beneath the `[🔔]` button when `open` is true. */
  popover?: ReactNode;
}

/** Props for the unified `AppTopBar` layout primitive. */
export interface AppTopBarProps {
  /** Primary page, album, share, or section title (`min-w-0 truncate`). */
  title: string;
  /** Optional concise subtitle below the title (`text-xs text-ink-400`). */
  subtitle?: ReactNode;
  /** Shows a back arrow button on the left. */
  back?: boolean;
  /** Destination route for the back arrow (default: `'/'`). */
  backTo?: string;
  /**
   * Whether the brand mark links back to `'/'` when `back` is false.
   * Set to `false` on `/s/:token` so share visitors are not routed to `/login`.
   */
  linkBrand?: boolean;
  /** Inline search field rendered on `>= md`. */
  search?: ReactNode;
  /** View / sort / group control slot. */
  viewSlot?: ReactNode;
  /** Primary action slot (e.g. `Share` pill button). */
  primaryAction?: ReactNode;
  /** Homogeneous `36x36` `[★]` Favorites SVG icon button. */
  favorites?: AppTopBarFavoritesControl;
  /** Homogeneous `36x36` `[💬]` Recent Comments SVG icon button. */
  commentsFeed?: AppTopBarCommentsControl;
  /** Homogeneous `36x36` `[🔔]` Notifications / Follow SVG icon button. */
  notifications?: AppTopBarNotificationsControl;
  /** Secondary `[⋮]` kebab slot (Admin actions on AlbumPage or mobile section menu on SettingsShell). */
  kebabSlot?: ReactNode;
  /** Additional custom controls on the right side of the bar. */
  rightSlot?: ReactNode;
  /** Whether to show the signed-in account menu on `>= md` (default: `true` for account sessions). */
  showAccountMenu?: boolean;
}

const ACCOUNT_TRIGGER_CLASS =
  'flex size-9 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-zinc-50 light:border-zinc-200 light:bg-white light:text-zinc-700 light:shadow-2xs light:hover:bg-zinc-100';

/**
 * Unified responsive top bar shared across Home (`/`), Album (`/album/:id`),
 * Share (`/s/:token`), and Settings/Administration (`/settings`, `/admin/*`).
 *
 * Enforces homogeneous `36x36` (`size-9 rounded-full`) vector SVG icon buttons with
 * custom tooltips for `[★]` (Favorites), `[💬]` (Recent Comments), `[🔔]` (Notifications),
 * and `[⋮]` (Kebab menu).
 */
export function AppTopBar({
  title,
  subtitle,
  back = false,
  backTo = '/',
  linkBrand = true,
  search,
  viewSlot,
  primaryAction,
  favorites,
  commentsFeed,
  notifications,
  kebabSlot,
  rightSlot,
  showAccountMenu = true,
}: AppTopBarProps): ReactElement {
  const { data: user } = useMe();
  const t = useT();
  const hidden = useHideOnScroll();
  const hasAccountSession = Boolean(user && user.username !== null);

  return (
    <header
      className={`sticky top-0 z-30 border-b border-ink-700 bg-ink-800/85 pt-[env(safe-area-inset-top)] backdrop-blur-md transition-transform duration-200 md:translate-y-0 ${
        hidden ? '-translate-y-full' : ''
      }`}
    >
      <div className="mx-auto flex min-h-16 max-w-[2000px] items-center gap-x-2 px-4 py-2 sm:gap-x-3 sm:px-6 md:py-3">
        {back && (
          <Link
            to={backTo}
            aria-label={t('topbar.back')}
            className="-ml-1 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-ink-300 transition-colors hover:bg-tint hover:text-ink-100"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 18 9 12l6-6" />
            </svg>
          </Link>
        )}

        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {back || !linkBrand ? (
            <Brand size="sm" />
          ) : (
            <Link to="/" aria-label={t('topbar.home')} className="shrink-0">
              <Brand size="sm" />
            </Link>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight text-ink-100">
              {title}
            </h1>
            {subtitle && <div className="truncate text-xs text-ink-400">{subtitle}</div>}
          </div>
        </div>

        {search && <div className="hidden min-w-0 md:block md:basis-80">{search}</div>}

        <div
          className={`flex shrink-0 items-center gap-1.5 sm:gap-2 ${
            search ? 'md:flex-1 md:justify-end' : ''
          }`}
        >
          {viewSlot}
          {primaryAction}

          {favorites && (
            <IconButton
              label={favorites.label}
              active={favorites.active}
              activeTone="gold"
              aria-pressed={favorites.active}
              badgeCount={favorites.count}
              badgeTone="gold"
              onClick={favorites.onToggle}
            >
              <StarIcon filled={favorites.active} />
            </IconButton>
          )}

          {commentsFeed && (
            <IconButton
              label={commentsFeed.label}
              active={Boolean(commentsFeed.open)}
              aria-expanded={commentsFeed.open}
              badgeCount={commentsFeed.unread}
              badgeTone="accent"
              onClick={commentsFeed.onToggle}
            >
              <CommentIcon />
            </IconButton>
          )}

          {notifications && (
            <div className="relative">
              <IconButton
                label={notifications.label}
                active={Boolean(notifications.open)}
                aria-expanded={notifications.open}
                statusDot={Boolean(notifications.subscribed)}
                hideTooltip={Boolean(notifications.open)}
                onClick={notifications.onToggle}
              >
                <BellIcon filled={Boolean(notifications.subscribed)} />
              </IconButton>
              {notifications.open && notifications.popover}
            </div>
          )}

          {kebabSlot}
          {rightSlot}

          {showAccountMenu && hasAccountSession && (
            <div className="hidden md:block">
              <AccountMenu
                trigger={<AccountIcon className="size-4" />}
                triggerClassName={ACCOUNT_TRIGGER_CLASS}
              />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
