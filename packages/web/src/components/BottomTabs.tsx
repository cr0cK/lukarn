import type { ReactElement, ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useT, type Translate } from '../lib/i18n';
import { AccountMenu } from './AccountMenu';
import type { ActivityFeed } from './CommentsFeed';
import { requestSearchFocus } from './SearchBox';

/**
 * One tab: the full height of a 56 px row, icon over name.
 *
 * The name is permanent rather than shown on hover, unlike the bar's view
 * controls (D90): a finger has no hover, so an unnamed icon down here would
 * never say what it is. There is room for it — four tabs across a phone screen,
 * against the seven controls the bar had to fit onto one row.
 */
const TAB =
  'flex size-full flex-col items-center justify-center gap-1 rounded-lg px-1 text-[0.6875rem] leading-none transition-colors';

const TAB_INACTIVE = `${TAB} text-ink-400`;
const TAB_ACTIVE = `${TAB} text-ink-100`;

interface BottomTabsProps {
  /**
   * Which tab reads as current. `null` on a page that no tab leads to — the
   * viewer opened over a grid still belongs to Albums, `/admin` to none of them.
   */
  current: 'albums' | null;
  /** The activity drawer, so its tab can carry the unread badge and open it. */
  activity: ActivityFeed;
}

/**
 * Primary navigation on a phone: Albums, Search, Activity, Account.
 *
 * Below `md` the top bar keeps only what describes the **current page** — back,
 * title, view controls — and everything that moves between pages comes down
 * here, within reach of a thumb. Above `md` this bar does not exist and the top
 * bar carries all of it, exactly as before.
 *
 * `env(safe-area-inset-bottom)` on the padding rather than the height: the row
 * keeps its 56 px on every device and the inset is added underneath, so an
 * iPhone's home bar pushes the tabs up instead of overlapping them.
 */
export function BottomTabs({ current, activity }: BottomTabsProps): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();

  // The Search tab creates no route: it returns to the album list, where the
  // field lives in the bar, and focuses it. A results page would be a second
  // place to search from, and the field already answers the whole library.
  const openSearch = (): void => {
    if (location.pathname !== '/') void navigate('/');
    requestSearchFocus();
  };

  return (
    <nav
      aria-label={t('tabs.label')}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-700 bg-ink-800/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {/* A grid of four equal columns, not a flex row: every tab is a **quarter
          of the width** whatever the length of its name. Fitted to the text, the
          targets would move from one language to the next, and a thumb aims at a
          position it already knows. */}
      <div className="grid h-14 grid-cols-4 gap-1 px-2">
        <Link
          to="/"
          className={current === 'albums' ? TAB_ACTIVE : TAB_INACTIVE}
          aria-current={current === 'albums' ? 'page' : undefined}
        >
          <IconeAlbums />
          {t('tabs.albums')}
        </Link>

        <button type="button" onClick={openSearch} className={TAB_INACTIVE}>
          <IconeRecherche />
          {t('tabs.search')}
        </button>

        <button
          type="button"
          onClick={activity.open}
          aria-label={feedLabel(activity.unread, t)}
          className={activity.isOpen ? TAB_ACTIVE : TAB_INACTIVE}
        >
          <span className="relative">
            <IconeActivite />
            {activity.unread > 0 && (
              <span
                aria-hidden="true"
                // Cap at "9+" like the bar and viewer badges: beyond that the
                // number overflows the icon, and knowing whether there are twelve
                // or seventeen changes no action.
                className="absolute -top-1 -right-2 min-w-4 rounded-full bg-accent px-1 text-center text-[0.625rem] leading-4 font-semibold text-accent-ink tabular-nums"
              >
                {activity.unread > 9 ? '9+' : activity.unread}
              </span>
            )}
          </span>
          {t('tabs.activity')}
        </button>

        {/* The same menu the bar's badge opens above `md`. Down here it is a
            sheet, which is what a button sitting on the bottom edge needs: a
            dropdown would open past the edge of the screen. */}
        <AccountMenu
          triggerClassName={TAB_INACTIVE}
          trigger={
            <>
              <IconeCompte />
              {t('tabs.account')}
            </>
          }
        />
      </div>
    </nav>
  );
}

/**
 * Accessible activity tab name: it carries the badge information, because the
 * badge is purely visual. Same rule as the bar's button.
 */
function feedLabel(unread: number, t: Translate): string {
  if (unread === 0) return t('topbar.activity');
  return t('topbar.activityUnread', unread);
}

/** Tab artwork. 24 px, the one size a tab draws them at. */
function Icone({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function IconeAlbums(): ReactElement {
  return (
    <Icone>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Icone>
  );
}

function IconeRecherche(): ReactElement {
  return (
    <Icone>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Icone>
  );
}

function IconeActivite(): ReactElement {
  return (
    <Icone>
      <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />
    </Icone>
  );
}

function IconeCompte(): ReactElement {
  return (
    <Icone>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </Icone>
  );
}
