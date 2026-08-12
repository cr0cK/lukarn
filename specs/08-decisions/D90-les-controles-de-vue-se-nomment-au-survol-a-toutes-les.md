# D90 — View controls identify themselves on hover at every width

**Context.** [D73](./D73-la-barre-superieure-tient-sur-une-rangee-et-declare-ses-au.md)
measured the cost of view-control labels and postponed them beyond `lg`: at
768 px, displaying them reduced the album title from 456 to 144 px. Beyond that
threshold, with space available, they returned.

What the measurement did not say is that they were no more useful on a wide
screen. "Newest first" alone occupied more width than the album subtitle — 900
items and the covered period — for a setting touched once per visit, in an
application whose entire purpose is making photos stand out.

**Decision.** Labels do not return at any width. Both controls identify
themselves **on hover**: the tooltip and accessible name carry the same phrase,
current state followed by click effect — "Newest first — Show oldest first".
Announcing only the effect, as the tooltip did, left the starting point implicit.

State remains readable in the icon, which already depends on it: arrow direction
for sorting, and one or two lines in the calendar for grouping. Below `sm`, the
**View** menu spells everything out — where space is least constrained, since an
open list has no width to defend.

**Consequences.** `TopBarAction.icon` now carries the **path**, not the `<svg>`
element, like viewer actions: the bar wraps it at 20 px inline and 16 px in the
menu. Otherwise, a ready-made path imposed one size in both places, and the 16 px
view controls clashed with the activity button's 20 px — a difference hidden by
the label and revealed when it was removed. Row buttons all become 36 px squares.

**Rejected.** Shortening labels instead of removing them — "Recent", "By day".
This halved their width, but two permanent words for a rarely touched setting
remained two words too many, and short vocabulary would have to be invented where
the full vocabulary already exists in the menu.
