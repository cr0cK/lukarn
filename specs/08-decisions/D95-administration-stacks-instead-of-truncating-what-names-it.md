# D95 — Administration stacks instead of truncating what names it

**Context.** `/admin` was bounded by `max-w-5xl`, or 64 rem. On a 1495 px laptop
screen, the content column fell to 760 px after `AdminNav`'s 12 rem and margins,
while a third of the window remained empty on both sides. Every row — album,
account, Drive state — put a descriptive `flex-1 min-w-0` block and three to five
`whitespace-nowrap` buttons on one line. Since only one side could shrink, it
always paid: an album appeared as "2…" on a phone, an account's "administrator"
badge was cut to "administ", and the `DriveSection` warning wrapped to one word
per line. The moderation queue's album selector required its longest option's
width and overflowed its section.

**Choice.** Two actions, one for available space and one for sharing it.

The bound becomes `max-w-[90rem]`: the content column gains 410 px on a 1495 px
screen, enough to display full titles and the following metadata line.

And the row becomes **stacked below `xl`, a row above it** — `ROW_CLASS` and
`ROW_ACTIONS_CLASS` in `ui.tsx`, used by the four sections containing rows. The
descriptive block then takes full width and actions move below: one button-height
more in exchange for a readable name.

**Why `xl`, not `sm`.** The first attempt switched at 640 px, and truncation
returned at 820: `AdminNav` takes its 12 rem column from `md`, making 768–1280 px
the range with least space despite not being a phone. At 1024 px, a four-button
row still cut the title. The threshold is therefore where a row genuinely fits,
and common laptop widths — 1280, 1366, 1440 — remain above it.

**Rejected.** Moving secondary actions behind a "…" menu at narrow widths. More
compact, but another component to write, make keyboard-accessible, and document,
to hide actions that fit once they stop competing with the title. An
administration action hidden behind a menu is not found when urgently needed.

Also rejected: removing the width bound. On a 2560 px screen, rows would be
2400 px and the eye would cross the entire window from an album title to its
button. The bound exists to limit visual travel, not because the screen is small.

**Consequences.** `truncate` remains on metadata, where it is appropriate:
metadata can be summarised; a name is either readable or not. In the account
list, it moves from the entire paragraph to the identifier alone, while following
labels become `shrink-0` — placed higher, it let the badge shrink with the rest.
An album's synchronisation state now opens the action group instead of closing
metadata: it is read before deciding to resynchronise and thus remains beside the
button it calls for once the row is stacked.
