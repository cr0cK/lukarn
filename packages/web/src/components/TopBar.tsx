import type { Locale } from '@lukarn/shared';
import { type ReactElement, type ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLogout, useMe } from '../api/hooks';
import { AVAILABLE_LOCALES, LOCALE_NAMES, useLocale, useT, type Translate } from '../lib/i18n';
import { useInstallPrompt } from '../lib/useInstallPrompt';
import { ActionMenu, type MenuEntry } from './ActionMenu';
import { InstallInstructions } from './InstallInstructions';

/**
 * A view control, described rather than rendered.
 *
 * The page supplies data rather than JSX so it can be displayed in two ways: as
 * a bar icon and a labelled menu row. This is the only way to have **one** name
 * per control — passing `children` required hiding the label below `sm`, leaving
 * both icons alone on a second row without names.
 */
export interface TopBarAction {
  /** Current state shown in the bar: "By month". */
  label: string;
  /** What triggering will do: "Group by day". This is the menu label. */
  action: string;
  /**
   * The **contents** of an `<svg viewBox="0 0 24 24">` — `path`, `rect` — not the
   * element. The bar wraps it and alone knows the size: 20 px aligned with other
   * row icons, 16 px in the menu where all application entries match. A page
   * supplying a complete `<svg>` would impose one size on both, producing the
   * four-pixel discrepancy visible in the bar.
   *
   * The same convention as `Lightbox` actions.
   */
  icon: ReactNode;
  onSelect: () => void;
}

interface TopBarProps {
  title: string;
  subtitle?: string | null;
  /** Shows a back arrow to the album list. */
  back?: boolean;
  /** Page-specific controls to the left of account controls. */
  actions?: TopBarAction[];
  /**
   * Search field **centred** in the bar: the title and account controls share
   * the remaining space equally on either side.
   *
   * A `ReactNode`, not a `TopBarAction`-style descriptor: the field has one
   * rendering — it does not collapse into a menu entry — and its state belongs
   * to the page mounting it, not the bar hosting it.
   */
  search?: ReactNode;
  /**
   * Opens the activity drawer with the number of messages received since the
   * last visit. Absent on pages where the feed has no meaning.
   */
  feed?: { unread: number; onOpen: () => void };
}

/**
 * A view control: one icon and nothing else.
 *
 * Square 36 px box — padding compensates for the 16 px path to match the activity
 * feed's 20 px icon. Without the label that lengthened them, two 28 px targets
 * sat beside a 36 px one in the same row, becoming the only irregularity in an
 * otherwise regular alignment.
 */
const CLASSE_BOUTON =
  'flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100';

const CLASSE_PASTILLE =
  'flex size-8 shrink-0 items-center justify-center rounded-full bg-ink-700 text-sm font-medium text-ink-200 transition-colors hover:bg-ink-600 hover:text-ink-100';

/**
 * Account initial when there is no photo to display.
 *
 * Use `Array.from` rather than `[0]`: an identifier may start outside the Basic
 * Multilingual Plane — an emoji or ideogram — where indexed access would return
 * only half and display a replacement character.
 */
const initiale = (username: string): string => Array.from(username)[0]?.toUpperCase() ?? '?';

/**
 * Sticky top bar shared by all authenticated pages.
 *
 * One row at every width, with two separate families: **what this page does** —
 * view controls — then, on the far right, **who is viewing it** — the account
 * badge, opened only on request. Admin, Sign out and Install no longer need to
 * fit in the bar, returning their width to the title.
 *
 * Below `sm`, view controls move into a menu: five controls across 393 px reduced
 * the album title to an initial and pushed them onto their own row, producing a
 * 101 px header in an application where photos should stand out.
 *
 * Between `sm` and `lg`, they return to the bar but remain icons only. At 768 px,
 * measured labels reduced the title from 456 to 144 px and truncated the
 * subtitle, precisely the defect being fixed.
 */
export function TopBar({
  title,
  subtitle,
  back = false,
  actions = [],
  search,
  feed,
}: TopBarProps): ReactElement {
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const install = useInstallPrompt();
  const t = useT();
  const { locale, setLocale } = useLocale();
  const [modeEmploi, setModeEmploi] = useState(false);

  const seDeconnecter = (): void => {
    logout.mutate(undefined, { onSuccess: () => void navigate('/login', { replace: true }) });
  };
  const proposerInstallation = (): void => {
    if (install.manuel) setModeEmploi(true);
    else install.installer();
  };

  // Installation is **last**, even after "Sign out": it appears and disappears
  // by browser and installation status, and placing it elsewhere would shift
  // permanent controls between visits.
  const compte: MenuEntry[] = [
    ...(user?.admin
      ? [
          {
            label: t('topbar.admin'),
            icon: <IconeAdmin />,
            onSelect: () => void navigate('/admin'),
          },
        ]
      : []),
    { label: t('topbar.signOut'), icon: <IconeDeconnexion />, onSelect: seDeconnecter },
    ...(install.disponible
      ? [{ label: t('topbar.install'), icon: <IconeInstaller />, onSelect: proposerInstallation }]
      : []),
  ];

  // Its own group, below the account actions: changing language is a setting,
  // not an action on the session, and the rule separating them says so without a
  // heading. Every language is listed with a tick on the current one rather than
  // one entry toggling between two — a third language would otherwise have
  // nowhere to go, and a toggle never says what it will switch to.
  const langues: MenuEntry[] = AVAILABLE_LOCALES.map((code: Locale) => ({
    label: LOCALE_NAMES[code],
    icon: code === locale ? <IconeCoche /> : <span className="block size-4" aria-hidden="true" />,
    checked: code === locale,
    onSelect: () => setLocale(code),
  }));

  return (
    // Use `ink-800` on an `ink-900` body: the bar is a surface, not part of the
    // page. At the same values, only its one-pixel rule defined it, and isolated
    // content — the badge at the far end of a wide screen — appeared to float.
    // Raise the rule accordingly or it disappears into the background it marks.
    <header className="sticky top-0 z-30 border-b border-ink-700 bg-ink-800/85 backdrop-blur-md">
      {/* `min-h-16`: height is **reserved**, never inferred from content. A page
          without a subtitle — the album list — otherwise produced a 57 px bar
          where an album page had 65 px, and centred content jumped 8 px between
          navigations. The lone badge at its end revealed this most clearly. */}
      <div className="mx-auto flex min-h-16 max-w-[2000px] items-center gap-x-2 px-4 py-3 sm:gap-x-3 sm:px-6">
        {back && (
          <Link
            to="/"
            className="-ml-1 rounded-full p-2 text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100"
            aria-label={t('topbar.back')}
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M15 18 9 12l6-6" />
            </svg>
          </Link>
        )}

        {/* Hide the title below `sm` when the page has a search field: keep one
            row at every width, and "Albums" at the root says nothing beyond the
            URL. The field cannot collapse elsewhere — a menu cannot be searched
            from within itself. */}
        <div className={`min-w-0 flex-1 ${search ? 'hidden sm:block' : ''}`}>
          <h1 className="truncate text-base font-medium tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-xs text-ink-400">{subtitle}</p>}
        </div>

        {/* Centring determines the width: from `sm`, the field stops growing at
            20 rem and both sides share the remainder equally — hence symmetrical
            `flex-1` on the title and right group. When stretched, it touched the
            account controls and made the bar appear to lean that way.

            Below `sm` it fills the line again: the title disappears, and a fixed
            20 rem would leave a gap in the middle of a 393 px screen. */}
        {search && <div className="min-w-0 flex-1 sm:flex-none sm:basis-80">{search}</div>}

        <div
          className={`flex shrink-0 items-center gap-x-2 sm:gap-x-3 ${
            search ? 'sm:flex-1 sm:justify-end' : ''
          }`}
        >
          {/* Activity remains **inline at every width**, unlike view controls:
            its icon carries the unread badge, the only sign that a conversation
            changed somewhere. Inside the menu below `sm`, it would no longer
            signal anything — the same reason as the viewer's "Comments" button. */}
          {feed && (
            <button
              type="button"
              onClick={feed.onOpen}
              title={t('topbar.activity')}
              aria-label={feedLabel(feed.unread, t)}
              className={`relative flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100`}
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />
              </svg>
              {feed.unread > 0 && (
                <span
                  aria-hidden="true"
                  // Cap at "9+" like the viewer badge: beyond that the number
                  // overflows the icon, and knowing whether there are twelve or
                  // seventeen changes no action.
                  className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[0.625rem] leading-4 font-semibold text-ink-950 tabular-nums"
                >
                  {feed.unread > 9 ? '9+' : feed.unread}
                </span>
              )}
            </button>
          )}

          {/* From `sm`: view controls in the bar, **icons only at every width**.
            Labels used to return beyond `lg`, where "Newest first" alone took
            more space than the album subtitle: two settings touched once per
            visit permanently weighed as much as what they controlled. Hover
            names them like the rest of this interface's icons.

            The tooltip states both current state **and** click effect, using the
            accessible name: an icon alone says neither, while announcing only
            the effect would leave the starting point implicit. */}
          <div className="hidden shrink-0 items-center gap-1 sm:flex lg:gap-2">
            {actions.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={item.onSelect}
                title={t('topbar.actionTooltip', item.label, item.action)}
                aria-label={t('topbar.actionLabel', item.label, item.action)}
                className={CLASSE_BOUTON}
              >
                <IconeAction taille="size-5">{item.icon}</IconeAction>
              </button>
            ))}
          </div>

          {/* Only below `sm`, and only when it has content: an empty menu would
            offer a target that does nothing. */}
          {actions.length > 0 && (
            <div className="sm:hidden">
              <ActionMenu
                label={t('topbar.view')}
                groupes={[
                  actions.map((item) => ({
                    label: item.action,
                    icon: <IconeAction taille="size-4">{item.icon}</IconeAction>,
                    onSelect: item.onSelect,
                  })),
                ]}
              />
            </div>
          )}

          {/* Account at every width. Render only once the session is known: an
            empty badge during a network round trip followed by a letter would
            make the bar jump on every page. */}
          {user && (
            <ActionMenu
              label={t('topbar.account')}
              // Use the identifier initial, not the display-name initial: it
              // abbreviates the menu's first line, and different letters before
              // and after the click would look like a defect.
              trigger={initiale(user.username)}
              triggerClassName={CLASSE_PASTILLE}
              // The identifier opens albums and may be shared by a household;
              // the address says who signs comments. Show both when they differ
              // — precisely when someone wonders which name they write under.
              entete={[user.username, ...(user.identity ? [user.identity.email] : [])]}
              groupes={[compte, langues]}
            />
          )}
        </div>
      </div>

      {modeEmploi && <InstallInstructions onClose={() => setModeEmploi(false)} />}
    </header>
  );
}
/**
 * Accessible activity button name: it carries the badge information because the
 * badge is purely visual.
 */
function feedLabel(unread: number, t: Translate): string {
  if (unread === 0) return t('topbar.activity');
  return t('topbar.activityUnread', unread);
}

/**
 * SVG wrapper for a view control. The page supplies the path and the display
 * location supplies the size — the reason not to receive the whole element.
 */
function IconeAction({
  taille,
  children,
}: {
  taille: 'size-4' | 'size-5';
  children: ReactNode;
}): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className={taille}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Tick beside the active language. Purely visual: `aria-checked` says it. */
function IconeCoche(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 13 4 4 10-10" />
    </svg>
  );
}

function IconeAdmin(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
    </svg>
  );
}

function IconeDeconnexion(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

function IconeInstaller(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}
