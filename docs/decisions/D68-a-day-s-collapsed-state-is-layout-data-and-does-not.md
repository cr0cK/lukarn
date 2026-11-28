# D68 — A day's collapsed state is layout data and does not survive the page

**Confidence.** observed — lib/seenComments.ts, git ls-files → exit 0 · 2026-08-23

**Context.** The division by day was not visible. A section header followed by
two hundred thumbnails, then another header: nothing while scrolling indicates
where one day ends and the next begins. The requested remedy was to collapse a
day so the album could be read as a table of contents.

Two questions arose: where does collapsing act, and how long does it last?

**Choice.** Collapsing is an **input to `computeLayout`**
(`LayoutOptions.isCollapsed`), not a render-time hide. A collapsed section places
no row: its height is exactly that of its header, and following sections move up
accordingly. This is the only tenable position because `totalHeight` governs the
scroll bar and virtualisation — a subsequent `display: none` would leave the page
as tall as everything it no longer displays, and the bar would lie about what
remains to browse.

Collapsing acts **at section level**, not day level. Both groupings benefit from
the same code; restricting it to days would require another condition for no
benefit. The keys cannot collide (`2026-07` versus `2026-07-14`), so one set
carries them all.

The state lives in an `AlbumPage` `useState`, **in memory only**.

**Rejected.** The URL, like `?photo=` and `?order=`: a list of collapsed days
would fit poorly — twenty ten-character keys — and make what is also shared
unreadable. Also rejected: `localStorage`, as in `lib/seenComments.ts`; reopening
an album months later with everything collapsed and no memory of doing so is a
more costly defect than expanding a day again. Collapsing helps with browsing
now, not configuring a view.

**Consequences.** `LayoutSection` carries `count` and `collapsed`. `count` cannot
be derived from `rows` — a collapsed section has none, precisely when its header
must announce what it hides.

Above all, **`moveSelection` changes coordinate systems**. It operated in the
index space of the original list, where `gauche`/`droite` meant `± 1`. The two spaces
coincided while the grid displayed everything; a collapsed section separates
them. Navigation now follows the order of actually placed cells (`layout.rows`),
otherwise an arrow would send the selection to a thumbnail absent from the
layout: nothing to highlight, and `scrollSelectionIntoView` with no target. The
`totalItems` parameter disappears, since the layout alone carries this
information.

The viewer **ignores collapsed state** and continues through the entire album.
Collapsing is a reading aid for the grid, not a filter: an arrow silently skipping
forty photos because a day is closed elsewhere would be a trap.
