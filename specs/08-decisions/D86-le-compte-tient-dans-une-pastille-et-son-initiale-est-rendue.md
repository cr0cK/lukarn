# D86 — The account fits in a badge, and its initial is rendered locally

**Context.** The top bar aligned Admin, Log out, and Install, three buttons none
of which is used daily in a photo viewer; at `lg` they carried labels, consuming
nearly 250 px of the album title. Elsewhere, under "Albums", a subtitle said
"Logged in as alexis" — opposite the button bar it concerned, and where an album
page puts its item count and period.

**Choice.** A badge carrying the account initial at the far right, at every
width. It opens the `ActionMenu` already written for small screens, headed by the
identifier and — if the session carries a commenter identity — its address. Page
view controls remain alone in the bar and keep their own menu below `sm`.

Two families, two locations: **what this page does** on the left, **who is viewing
it** on the right. This split makes the rule memorable; a control's position no
longer depends on screen width.

The initial comes from the **identifier**, not the display name, although the
latter describes the person better: the badge abbreviates the menu's first line,
and different letters on either side of a click would look like a defect.

**Rejected.** Gravatar or any remote avatar service. The address — or its hash,
which amounts to the same thing for an email directory — would go to a third
party on every page load, also revealing who views which instance and when. A
high price for a decorative image in an application self-hosted precisely to keep
this data inside. A locally rendered letter costs no request and tells nobody
anything.

Also rejected: keeping Log out visible in the bar beside the badge. Two actions
for the same thing, one of which would be clicked accidentally — exactly the
action that should not happen unintentionally.

**Consequences.** Below `sm`, a page declaring view controls shows two targets
instead of one: the View menu and the badge. Measured at 393 px, the title loses
around thirty pixels — the price of an account location that no longer moves
between widths. A page with no view controls — `/`, `/admin` — only displays the
badge: an empty menu would offer a target that opens nothing.

The badge only renders once the session is known. An empty badge during a network
round trip, then a letter, would make the bar jump on every page change.
