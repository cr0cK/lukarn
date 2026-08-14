import type { ReactElement } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useT, type MessageKey } from '../../lib/i18n';

/**
 * Administration sections in display order.
 *
 * Single source: navigation renders them, and `AdminPage` validates its URL
 * segment against this list. Adding a section here requires no second update.
 *
 * `group` exists only for the phone list, where six undifferentiated rows say
 * nothing about what belongs with what. The sidebar ignores it: a twelve-rem
 * column has no room for headings, and at that width the whole list is read at
 * once anyway.
 */
export const ADMIN_TABS = [
  { slug: 'albums', label: 'admin.tabAlbums', group: 'admin.groupLibrary' },
  { slug: 'accounts', label: 'admin.tabAccounts', group: 'admin.groupPeople' },
  { slug: 'comments', label: 'admin.tabComments', group: 'admin.groupPeople' },
  { slug: 'identity', label: 'admin.tabIdentity', group: 'admin.groupInstance' },
  { slug: 'server', label: 'admin.tabServer', group: 'admin.groupInstance' },
  { slug: 'visits', label: 'admin.tabVisits', group: 'admin.groupInstance' },
] as const satisfies readonly { slug: string; label: MessageKey; group: MessageKey }[];

/** Administration section as it appears in the URL. */
export type AdminTab = (typeof ADMIN_TABS)[number]['slug'];

/** Whether the received URL segment identifies a known section. */
export function isAdminTab(valeur: string | undefined): valeur is AdminTab {
  return ADMIN_TABS.some((tab) => tab.slug === valeur);
}

/** The groups, in the order their first section appears — no second list to keep in step. */
const GROUPS: MessageKey[] = [...new Set(ADMIN_TABS.map((tab) => tab.group))];

/**
 * Navigation between `/admin` sections, from `md`.
 *
 * Use `NavLink` rather than buttons: the section lives in the URL, so
 * `aria-current="page"` and active state come from the router instead of manual
 * path comparisons.
 */
export function AdminNav(): ReactElement {
  const t = useT();

  return (
    <nav
      aria-label={t('admin.sections')}
      // A sticky column, so it stays visible while scrolling the paginated — and
      // therefore long — moderation queue. Below `md` this component renders
      // nothing: `AdminMenu` takes over, as a list occupying `/admin` itself.
      className="hidden shrink-0 gap-1 md:sticky md:top-20 md:flex md:w-48 md:flex-col md:self-start"
    >
      {ADMIN_TABS.map((tab) => (
        <NavLink
          key={tab.slug}
          to={`/admin/${tab.slug}`}
          // The selected section carries the instance colour: a tinted panel and
          // an outline in the accent itself. An outline rather than a border
          // because it reads the same whatever edge it sits against and takes no
          // layout space.
          //
          // Hovering an unselected section uses the same tint at rest, which is
          // what `accent-soft` exists for: it says "this is where you are going"
          // in the colour that says "this is where you are".
          className={({ isActive }) =>
            `shrink-0 rounded-lg px-3 py-2 text-sm transition-colors ${
              isActive
                ? 'bg-accent-soft text-ink-100 outline outline-accent'
                : 'text-ink-300 hover:bg-accent-soft hover:text-ink-100'
            }`
          }
        >
          {t(tab.label)}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * The same sections as a **list**, below `md`, filling `/admin` itself.
 *
 * The sidebar used to fold into a horizontally scrolling row of tabs: six
 * sections across 390 px meant two were visible, the rest reached by a gesture
 * nothing announced, and the row cost a line of every administration page at all
 * times. A phone shows one level per screen, so `/admin` becomes the level that
 * lists them and each section becomes the level below.
 *
 * The unread count sits on Comments because it is the one section that becomes
 * worth opening on its own: every other one changes only when somebody changes
 * it. It is the **activity** count — messages received since the last visit —
 * and not a moderation queue length, because there is no such queue: a comment
 * is visible until somebody hides it, so "waiting" is not a state this data
 * model has (see `lib/seenComments.ts`).
 */
export function AdminMenu({ unread }: { unread: number }): ReactElement {
  const t = useT();

  return (
    <nav aria-label={t('admin.sections')} className="md:hidden">
      {GROUPS.map((group) => (
        <div key={group} className="mb-6 last:mb-0">
          <h2 className="px-1 pb-2 text-xs tracking-wide text-ink-400 uppercase">{t(group)}</h2>
          <div className="overflow-hidden rounded-xl border border-ink-800 bg-ink-850/50">
            {ADMIN_TABS.filter((tab) => tab.group === group).map((tab, rank) => (
              <Link
                key={tab.slug}
                to={`/admin/${tab.slug}`}
                // 56 px rows, and a rule **between** them rather than around each:
                // this is one list, and six separate cards would read as six
                // unrelated things.
                className={`flex min-h-14 items-center gap-3 px-4 text-sm text-ink-100 transition-colors hover:bg-white/5 ${
                  rank > 0 ? 'border-t border-ink-800' : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{t(tab.label)}</span>
                {tab.slug === 'comments' && unread > 0 && (
                  <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-ink tabular-nums">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
                <Chevron />
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** Points at the level below. The one mark this list needs beyond its rows. */
export function Chevron(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0 text-ink-400"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
