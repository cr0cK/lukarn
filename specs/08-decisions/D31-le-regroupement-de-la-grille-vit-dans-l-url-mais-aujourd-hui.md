# D31 — Grid grouping lives in the URL, but "today" is read from the local clock

**Context.** The grid used to split photos into hard-coded months. On a holiday
album — three thousand photos over three weeks — this produces one or two
sections, which provides no meaningful landmark. Splitting by day gives useful
headers, but the entire front end displays dates in UTC (see `CLAUDE.md`), and
splitting by day in local time would move late-evening photos between sections.

**Decision.** `GroupBy = 'month' | 'day'` in `@nonni/shared`, `?group=day` in
the URL like `?order=asc`, and `LayoutOptions.groupBy` in `computeLayout`. Both
section keys are slices of the ISO string (`slice(0, 7)`, `slice(0, 10)`), so
they are in UTC by construction: no `Date` object is involved in the split, and
a browser in Auckland segments it exactly like a browser in Lisbon.

**Decision.** `dayLabel` names the two most recent days "Today" and
"Yesterday", and **compares against the browser's local calendar**, not the UTC
day. This is the only date in the front end that is not in UTC, and that is
consistent: `taken_at` is the time displayed by the device, hence the wall
clock of the person who took the photo — the same as that of the person viewing
it. Comparing against the UTC day would deny "Today" to an afternoon still in
progress in Montreal, and grant it in Auckland before the day had begun. The
full date, meanwhile, remains rendered by `formatDate`, in UTC.

**Rejected.** Grouping by year: on the album that prompted the feature, it only
produces one section. Also rejected: sending `group` to the server and putting
it in the TanStack Query key — the list served is identical and only the layout
segments it, so putting it there would reload the entire album on every toggle.
Finally, a relative landmark beyond the previous day ("5 days ago") was
rejected because it requires more mental calculation than the date itself.

**Consequences.** By day, `layout.sections` is much longer, and `JustifiedGrid`
scans it on every scroll event. Measured on the worst case — 3,000 photos, 3,000
sections — this scan costs 0.02 ms, compared with 0.004 ms for the 99 sections
of the same album by month: virtualisation holds without changes, and a binary
search would bring no measurable benefit while adding another sorting
invariant. The total height, however, explodes (94,000 px by month compared with
837,000 px by day in the same case): that is the cost of a header and a final
unjustified row per section, and it is accepted. The toggle resets keyboard
selection and scrolls the page to the top, like reversing the sort order.
