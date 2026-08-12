# D88 — The open photo says where it comes from and clears the chrome with one key

**Context.** [D84](./D84-context-moves-to-the-bottom-of-the-viewer-at-every-width.md)
moved everything **written by hand** about a photo into the bottom strip. The
header retained its previous split: the filename in bold and first
([D74](./D74-the-viewer-organises-its-actions-and-restores-the-day-s.md)),
with the day and place compressed on the line below. But `IMG_0004.jpg` says
neither where, when, nor what, while occupying the place of the one piece of
information genuinely missing when opening a shared link: which album the photo
comes from.

**Decision.** The two areas divide work by what they carry — the header
**locates**, the strip **narrates**. At the top: **album · day**, then the place
on its own line. At the bottom, unchanged: what someone wrote. The filename moves
to the top of the `i` panel, where `SidePanel` already displayed it beside the
technical data it accompanies.

The album title truncates, never the date. On a phone the line cannot fit both,
and "Allemagne – Forêt Noire · Toda…" would sacrifice exactly what is being
provided: the date is short and bounded, so it remains complete.

**`h` hides all chrome**: header, arrows, and caption strip. The shortcut does
not duplicate D84's `l`, and their scopes do not overlap — `l` puts away the
bottom text while keeping the button that recalls it; `h` leaves only the photo.
The ←/→ keys and swiping continue to work: what is hidden is what can be seen,
not what can be controlled. One button remains at the top right; otherwise,
leaving the state would depend on a keyboard, meaning nothing to someone touching
the screen.

The state is **not** persisted, unlike caption hiding, and the asymmetry is
intentional: putting away the caption is a choice about how to read photos;
hiding all chrome is an action taken for a particular image. A viewer reopening
without a single marker would leave someone who forgot the shortcut before a
silent screen.

**Rejected.** Keeping the filename on another line: the header already has two,
and lengthening it for the least useful information is the opposite of the
problem being solved. Also rejected: making a click on the photo toggle chrome.
That action already toggles zoom, and two meanings for the same click would
compete on every photo.

**Consequences.** `Lightbox` accepts an `albumTitle` — the viewer is a complete
view reached by a link without seeing the grid. The grid is unchanged: its
section header already carries the day, it sits inside an album just opened, and
nothing overlays a photo.
