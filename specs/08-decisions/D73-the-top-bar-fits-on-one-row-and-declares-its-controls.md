# D73 — The top bar fits on one row and declares its controls instead of rendering them

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** On a phone, the bar grew to **101 px** — two rows. The first aligned
Back, the title, "Admin", and "Log out", amounting to 169 px of text buttons that
reduced the album title to `D.` and the subtitle to `120 items · Febr…`. The
second carried only the two view toggles, reduced to silent icons occupying 80 px
out of 393. In an application built on chrome not competing with photos, this
used 12% of the screen height.

**Choice.** One row at every width (65 px). Below `sm`, everything except Back
and the title moves into a menu where every entry finally has a label — "Group by
day" rather than a calendar icon. From `sm` to `lg`, controls return to the bar as
icons only. From `lg` upwards, labels reappear.

For the same control to render both ways, `TopBar` stops accepting `children` and
accepts an `actions` array — `label`, `action`, `icon`, `onSelect`.

**Rejected.** Putting only account actions in the menu and leaving view toggles
as icons in the bar: this preserved one tap to reverse sorting, but left both
icons unnamed on touch, where no tooltip appears — the other half of the problem.

Also rejected: the kebab at every width. It would provide one behaviour to write
and document, but a wide screen has no reason to hide five controls behind a tap.

Finally rejected: showing labels from `md`. Measured at 768 px, the five labels
reduced the title from 456 to 144 px and truncated the subtitle — the very defect
being fixed. `lg` is the first breakpoint where both fit.

**Consequences.** A menu entry's label is `action`, not `label`: a menu row says
what it does, while a bar button says what state is active. Both texts already
existed; they simply did not serve the same place.

`InstallButton` disappears. Its state moves into `useInstallPrompt` because the
prompt now appears in two places depending on width, and duplicated state would
diverge — the button disappearing after `appinstalled`, but not the menu row. The
iOS instructions become `InstallInstructions`.

**Install comes last, after "Log out"**, contrary to the convention of placing
log out at the end of a menu. The reason: it is the only entry that appears and
disappears by itself depending on the browser and whether installation has
already happened. Anywhere else, it would shift permanent controls between visits.
