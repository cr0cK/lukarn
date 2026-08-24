# D260814 — The mobile shell moves to a bottom tab bar

**Confidence.** observed — components/BottomTabs.tsx, git ls-files → exit 0 · 2026-08-23

**Context.** Every threshold in the interface was chosen from the desktop
downwards. `TopBar` reserved 65 px at every width and carried, on one row,
everything the application can do: back, title, subtitle, activity with its
unread badge, view controls, and the account badge that opens Administration,
Sign out, Install and the languages. Below `sm` the view controls folded into a
menu, and the rest stayed — five targets across 393 px, all of them in the top
quarter of a screen held in one hand.

Two measured defects, not hypotheses:

- The bar read **no** `env(safe-area-inset-*)`. `index.html` declares
  `viewport-fit=cover` and the manifest `display: standalone`, so an installed
  application draws under the notch: the whole first row sat beneath the clock.
- Row targets were 36 px squares ([D90](./D90-view-controls-identify-themselves-on-hover-at-every-width.md)),
  under both the 44 px iOS asks for and the 48 px of Material.

**Decision.** Below `md` (768 px), the shell splits in two along one rule: **the
top bar describes the page, the bottom bar navigates between pages.**

`components/BottomTabs.tsx` carries Albums, Search, Activity and Account — a
56 px row, four equal columns, `env(safe-area-inset-bottom)` underneath. The top
bar keeps the back arrow, the title, its subtitle and the View menu, gains
`env(safe-area-inset-top)`, and retracts while the page is scrolled down
(`lib/useHideOnScroll.ts`). Above `md`, none of this exists: the tab bar is
`md:hidden`, the bar is pinned by `md:translate-y-0`, and it renders exactly what
it rendered before.

The two thresholds D90 measured stay true where it measured them and stop being
true underneath. Its 36 px square remains the row's size **from `md`**, where the
target is a cursor. Its "name yourself on hover" remains the rule for view
controls, which stay in the bar above `md` and in a menu below it. But a finger
has no hover, so the four tabs carry a **permanent** name under their icon —
affordable because four tabs share a phone's width, where the bar had to fit
seven controls onto one row.

**Consequences.**

`components/AccountMenu.tsx` exists because two surfaces now open the same
menu: the bar's badge above `md`, the Account tab below it. The entries were
written inside `TopBar`; a second copy would have drifted the day a language or
an action was added, and only one of the two screens would have shown it.
`ActionMenu` gained a `placement` prop for the same reason — a button sitting on
the bottom edge has nothing under it to open into.

The **Search** tab creates no route. It returns to `/` and hands focus to the
field already in the bar; a results page would be a second place to search from,
and the field already answers across the whole library. The handover crosses a
navigation that unmounts the tab pressing the button, so the request waits at
module level in `SearchBox.tsx` until the field that answers it is mounted.

Administration mounts the tab bar too, and therefore the activity drawer, which
it did not have. A tab that does nothing on one page is exactly the irregularity
these tabs remove.

`pages/*` reserve the bar's height at the bottom of their `main`: it is `fixed`
and outside the flow, so the last row of albums would otherwise end underneath
it.

The type scale is 5 % larger below `md`, through the five `--text-*` variables
rather than a class on each call site, and never through `html { font-size }`,
which would take the whole spacing scale with it.

**Rejected.** A drawer behind a hamburger, the other common shape for this. It
hides the destinations instead of showing them, costs a tap before any of them,
and gives no place to a badge — the unread count is the one thing in this
application that must be visible without being asked for.

Also rejected: hiding the tab bar along with the top bar while scrolling. The bar
being hidden is what makes retraction safe — navigation stays on screen, so the
page never becomes a surface with no way out. Hiding both would save 56 px at the
cost of the only permanent affordance.
