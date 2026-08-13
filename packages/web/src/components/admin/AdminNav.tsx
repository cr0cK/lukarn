import type { ReactElement } from 'react';
import { NavLink } from 'react-router-dom';
import { useT, type MessageKey } from '../../lib/i18n';

/**
 * Administration sections in display order.
 *
 * Single source: navigation renders them, and `AdminPage` validates its URL
 * segment against this list. Adding a section here requires no second update.
 */
export const ADMIN_TABS = [
  { slug: 'albums', label: 'admin.tabAlbums' },
  { slug: 'accounts', label: 'admin.tabAccounts' },
  { slug: 'comments', label: 'admin.tabComments' },
  { slug: 'identity', label: 'admin.tabIdentity' },
  { slug: 'server', label: 'admin.tabServer' },
  { slug: 'visits', label: 'admin.tabVisits' },
] as const satisfies readonly { slug: string; label: MessageKey }[];

/** Administration section as it appears in the URL. */
export type AdminTab = (typeof ADMIN_TABS)[number]['slug'];

/** Whether the received URL segment identifies a known section. */
export function isAdminTab(valeur: string | undefined): valeur is AdminTab {
  return ADMIN_TABS.some((tab) => tab.slug === valeur);
}

/**
 * Navigation between `/admin` sections.
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
      // Two width-dependent modes, like `SidePanel`. From `md`, use a sticky
      // column that remains visible while scrolling the paginated, and therefore
      // long, moderation queue. Below that, use a horizontally scrolling row —
      // taking 12 rem from a phone screen would leave no content. Negative
      // overflow restores page margins so scrolling reaches edge to edge.
      className="-mx-4 flex shrink-0 gap-1 overflow-x-auto px-4 sm:-mx-6 sm:px-6 md:sticky md:top-20 md:mx-0 md:w-48 md:flex-col md:self-start md:overflow-visible md:px-0"
    >
      {ADMIN_TABS.map((tab) => (
        <NavLink
          key={tab.slug}
          to={`/admin/${tab.slug}`}
          // The selected section carries the instance colour: a tinted panel and
          // an outline in the accent itself. An outline rather than a border
          // because the nav is a column above `md` and a scrolling row below —
          // one edge would be the wrong edge in the other orientation, while an
          // outline reads the same both ways and takes no layout space.
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
