# D66 — Administration is navigated by sections, one per URL

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** `/admin` stacked six sections in a single column. While the
moderation queue fitted on one screen, the page was navigable; since it became
paginated, the page has no end, and "Settings" and "Maintenance" sit behind
dozens of comments. The message banner was already stuck below the top bar
precisely because it would otherwise no longer be seen — a treated symptom, not
the cause.

**Choice.** Four sections, each with its own URL: `/admin/albums`,
`/admin/accounts`, `/admin/comments`, and `/admin/server`. From `md` upwards,
a left navigation column remains sticky so it stays visible during moderation;
below that, a horizontally scrolling row. `AdminNav` exposes `ADMIN_TABS`, which
`AdminPage` reuses to validate the `:tab` parameter, and each section only mounts
the queries it needs — the moderation queue no longer displays album loading.

The three server sections — Drive connection, settings, and maintenance — remain
grouped: they all answer "how does this instance run?", and separating them would
produce three pages with one section each.

**Rejected.** Tabs in local state, without changing URLs: a reload loses the
section, the browser's Back button leaves administration instead of returning to
the previous section, and above all the return from Google consent no longer has
a destination to name — it returns to the page, not the section it came from.
Also rejected: an accordion, which keeps a single page and does nothing to reduce
scrolling once a section opens. Finally rejected: one navigation entry per
section, six for six, which reproduces in the margin the list being shortened.

**Consequences.** `/admin` redirects to `/admin/albums`: bookmarks and the top
bar button remain valid. The OAuth callback now redirects to
`/admin/server?oauth=<reason>`, the section containing the connection button.
The "Users" section becomes "Accounts", aligning with "New account" and the
section label. A section added later is written in `ADMIN_TABS` and nowhere else;
however, moving a section from one group to another changes a URL someone may
have bookmarked — the price of putting the section in the URL, and a small one
compared with what it enables.
