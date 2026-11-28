# D260814c — Administration gets a root on a phone, and settings become rows

**Confidence.** observed — ui.tsx, git ls-files → exit 0 · 2026-08-23

**Context.**
[D66](./D66-administration-is-navigated-by-sections-one-per-url.md) split
administration into six sections, one URL each, with a sticky column from `md`
and — below it — a horizontally scrolling row of tabs. That row is where the
phone was left behind: six sections across 390 px show two, the rest are reached
by a sideways gesture nothing announces, and the row costs a line of every
administration screen at all times, including the ones nobody is navigating away
from.

Underneath it, the forms were desktop forms. `TextField` stacks a label, a field
and a hint — three lines for a value nobody is changing today — and the settings
section has seven of them. The page became a form to scroll rather than a list
to read, and the setting somebody came for was somewhere in it.

**Decision.** On a phone, one screen per level.

`/admin` stops being a redirect and becomes the **list of sections** below `md`,
grouped — Library, People, This instance — with a chevron per row and the
activity count on Comments. A section's back arrow returns to it, through the
`backTo` prop `TopBar` gained with the tab bar.

`ui.tsx` gains `SettingRow`: the setting's name on the left, what it currently
reads on the right, and a chevron opening the field itself underneath.
`TextField` picks its own shape from the width, so **every** administration form
gets the list without a single call site knowing — the same arrangement
`ActionMenu` and `MediaCaption` already use for the same reason.

**Above `md`, nothing changes at all.** `/admin` still redirects to
`/admin/albums`; the sidebar, the stacked fields and the sections are what they
were. Keeping the redirect there is not only compatibility: it is what lets
`AdminNav` read its selected entry from the router rather than from a path
comparison, which is what D66 chose it for.

**Consequences.**

`SettingRow` **discloses in place** rather than opening a screen of its own,
because a section is one form with one Save button. A row that led somewhere
would have to save on its own, and a partial save is a different promise from
the one the button at the bottom makes.

A row starts **open** when its value is empty, so a creation form is a form and
not six closed rows to open one at a time; and it stays open while its field has
an error, because an error nobody can see is an error nobody corrects. Its value
shows only while closed — "Not set" printed beside an empty input somebody is
about to fill answers a question the input already asks.

`ADMIN_TABS` gains a `group`, read only by the phone list. The sidebar ignores
it: a twelve-rem column has no room for headings, and at that width the six rows
are read at once anyway.

**The badge on Comments counts activity, not a moderation queue.** There is no
queue: a comment is visible until somebody hides it, so "waiting" is not a state
this data model has. What the row carries is the count already computed for the
activity drawer — messages received since the last visit — which is the honest
version of "this section is worth opening".

**Rejected.** Keeping the scrolling tab row and merely making it taller. It
would still show two sections out of six, and the ones off-screen are exactly
the ones somebody navigating administration has not thought of yet.

Also rejected: a `SettingRow` that opens a sheet per setting. It reads well on
one setting and badly on seven — seven sheets to fill in before one Save — and
it would put a single field on a screen built to hold a whole form.
