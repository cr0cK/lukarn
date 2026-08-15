import { type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../api/hooks';
import { useT, type Translate } from '../lib/i18n';
import { useHideOnScroll } from '../lib/useHideOnScroll';
import { AccountIcon, AccountMenu } from './AccountMenu';
import { ActionMenu } from './ActionMenu';
import { Brand } from './Brand';

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
  /**
   * Where the back arrow leads, when it is not the album list. Administration
   * uses it to return to its own root on a phone, where `/admin` is a list of
   * sections rather than a redirect.
   */
  backTo?: string;
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
 *
 * **48 px below `md`**, where the target is a fingertip rather than a cursor:
 * 36 px is under both the 44 px iOS asks for and the 48 px of Material. Above
 * `md` it stays exactly the square D90 measured.
 */
const CLASSE_BOUTON =
  'flex size-12 shrink-0 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-tint hover:text-ink-100 md:size-9';

const CLASSE_PASTILLE =
  'flex size-8 shrink-0 items-center justify-center rounded-full bg-ink-700 text-ink-200 transition-colors hover:bg-ink-600 hover:text-ink-100';

/**
 * Sticky top bar shared by all authenticated pages.
 *
 * One row at every width, with two separate families: **what this page does** —
 * view controls — then, on the far right, **who is viewing it** — the account
 * badge, opened only on request. Admin, Sign out and Install no longer need to
 * fit in the bar, returning their width to the title.
 *
 * Below `md`, the bar keeps only what describes **this page** — back, title,
 * subtitle, view controls — and everything reached from every page moves down to
 * `BottomTabs`, within reach of a thumb. Above `md` the bar carries all of it,
 * exactly as it did.
 *
 * View controls fold into a menu below `md` rather than below `sm`: five aligned
 * controls across 393 px reduced the album title to an initial and pushed them
 * onto a second row, a 101 px header in an application where photos should stand
 * out. They return to the bar as icons only. At 768 px, measured labels reduced
 * the title from 456 to 144 px and truncated the subtitle, precisely the defect
 * being fixed.
 */
export function TopBar({
  title,
  subtitle,
  back = false,
  backTo = '/',
  actions = [],
  search,
  feed,
}: TopBarProps): ReactElement {
  const { data: user } = useMe();
  const t = useT();
  const hidden = useHideOnScroll();

  return (
    // Use `ink-800` on an `ink-900` body: the bar is a surface, not part of the
    // page. At the same values, only its one-pixel rule defined it, and isolated
    // content — the badge at the far end of a wide screen — appeared to float.
    // Raise the rule accordingly or it disappears into the background it marks.
    //
    // `pt-[env(safe-area-inset-top)]`: `index.html` declares `viewport-fit=cover`
    // and the manifest `display: standalone`, so an installed application draws
    // under the notch. Without this the bar's whole first row sat beneath the
    // clock. Padding rather than a margin, so the surface still reaches the top
    // of the screen and the status bar keeps a background.
    //
    // **The retraction is the phone's alone**: `md:translate-y-0` pins the bar
    // above the breakpoint whatever the hook returns, and there the reserved
    // height is not what limits the page.
    <header
      className={`sticky top-0 z-30 border-b border-ink-700 bg-ink-800/85 pt-[env(safe-area-inset-top)] backdrop-blur-md transition-transform duration-200 md:translate-y-0 ${
        hidden ? '-translate-y-full' : ''
      }`}
    >
      {/* `min-h-16`: height is **reserved**, never inferred from content. A page
          without a subtitle — the album list — otherwise produced a 57 px bar
          where an album page had 65 px, and centred content jumped 8 px between
          navigations. The lone badge at its end revealed this most clearly. */}
      {/* `py-2` below `md`, `py-3` above: the reserved height is what must not
          move, and a 48 px target inside a 64 px box leaves exactly 16 px of
          padding. With `py-3` the album page measured 73 px against the album
          list's 65 — the very 8 px jump `min-h-16` exists to prevent. */}
      <div className="mx-auto flex min-h-16 max-w-[2000px] items-center gap-x-2 px-4 py-2 sm:gap-x-3 sm:px-6 md:py-3">
        {back && (
          <Link
            to={backTo}
            // 48 px below `md` like the other bar controls: Back is the most
            // used target on a phone and was the smallest of them at 36.
            className="-ml-2 flex size-12 shrink-0 items-center justify-center rounded-full text-ink-300 transition-colors hover:bg-tint hover:text-ink-100 md:-ml-1 md:size-9"
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

        {/* The title is shown at **every** width now that the search field has
            left the bar below `md`. It used to be hidden on the album list, where
            the field took the whole row: the one page that names the gallery
            showed the mark alone, and the instance's name — the thing that says
            whose photos these are — appeared nowhere on a phone (D260814d).

            The mark travels with the title rather than sitting beside the back
            arrow, so one rule governs both. */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {/* A link only where nothing else already leads to the album list. Beside
              the back arrow it would be a second control for the same destination,
              two targets apart; here it only identifies the instance. */}
          {back ? (
            <Brand size="sm" />
          ) : (
            <Link to="/" aria-label={t('topbar.home')} className="shrink-0">
              <Brand size="sm" />
            </Link>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-base font-medium tracking-tight">{title}</h1>
            {subtitle && <p className="truncate text-xs text-ink-400">{subtitle}</p>}
          </div>
        </div>

        {/* From `md` only: below it, the Search tab opens the same field in a
            sheet, at the edge the hand is on. Centring determines the width — the
            field stops growing at 20 rem and both sides share the remainder
            equally, hence symmetrical `flex-1` on the title and the right group.
            Stretched, it touched the account controls and made the bar lean. */}
        {search && <div className="hidden min-w-0 md:block md:basis-80">{search}</div>}

        <div
          className={`flex shrink-0 items-center gap-x-2 sm:gap-x-3 ${
            search ? 'md:flex-1 md:justify-end' : ''
          }`}
        >
          {/* Activity stays **inline from `md`**, never inside the View menu: its
            icon carries the unread badge, the only sign that a conversation
            changed somewhere, and a badge folded into a menu signals nothing —
            the same reason as the viewer's "Comments" button. Below `md` it is
            not folded either but **moved**, to the tab that now owns it. */}
          {feed && (
            <button
              type="button"
              onClick={feed.onOpen}
              title={t('topbar.activity')}
              aria-label={feedLabel(feed.unread, t)}
              className={`relative hidden size-9 shrink-0 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-tint hover:text-ink-100 md:flex`}
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
                  className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[0.625rem] leading-4 font-semibold text-accent-ink tabular-nums"
                >
                  {feed.unread > 9 ? '9+' : feed.unread}
                </span>
              )}
            </button>
          )}

          {/* From `md`: view controls in the bar, **icons only at every width**.
            Labels used to return beyond `lg`, where "Newest first" alone took
            more space than the album subtitle: two settings touched once per
            visit permanently weighed as much as what they controlled. Hover
            names them like the rest of this interface's icons.

            The tooltip states both current state **and** click effect, using the
            accessible name: an icon alone says neither, while announcing only
            the effect would leave the starting point implicit. */}
          <div className="hidden shrink-0 items-center gap-1 md:flex lg:gap-2">
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

          {/* Only below `md`, and only when it has content: an empty menu would
            offer a target that does nothing. It is the **one** control the bar
            keeps down there, because it acts on what this page is showing —
            everything else moved to the tabs. */}
          {actions.length > 0 && (
            <div className="md:hidden">
              <ActionMenu
                label={t('topbar.view')}
                triggerClassName={CLASSE_BOUTON}
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

          {/* Account from `md`; below it, the tab bar carries the same menu.
            Render only once the session is known: an empty badge during a
            network round trip followed by a letter would make the bar jump on
            every page. */}
          {user && (
            <div className="hidden md:block">
              <AccountMenu
                // The person, not their initial: the badge is the one target on
                // the bar that stands for somebody rather than for an action,
                // and it now opens onto the same glyph beside the identifier —
                // one thing continued rather than a letter replaced by a name.
                trigger={<AccountIcon className="size-[1.125rem]" />}
                triggerClassName={CLASSE_PASTILLE}
              />
            </div>
          )}
        </div>
      </div>
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
