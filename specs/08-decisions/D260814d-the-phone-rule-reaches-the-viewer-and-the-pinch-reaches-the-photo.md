# D260814d — The phone rule reaches the viewer, and the pinch reaches the photo

**Context.**
[D260814](./D260814-the-mobile-shell-moves-to-a-bottom-tab-bar.md) stated one
rule — the top bar describes the page, the bottom bar navigates between pages —
and applied it to the shell only. Three things were left half-converted, and on
a real phone they read as one defect: the layout says the bottom is where you
act, and then keeps asking you to reach the top.

- **Search was a tab whose effect appeared at the top.** Pressing it at the
  bottom of the screen moved focus into the bar, then raised a keyboard over the
  results. The one control that changed the top of the screen was at the bottom.
- **Comments existed twice in the viewer**: a button in the header carrying the
  badge, and a tab inside the sheet a centimetre below.
- **The rest of the viewer's actions never came down at all** — Information,
  Download, Fullscreen, Hide chrome, Set as cover sat behind a kebab in the top
  right corner, over a photo the whole screen exists to show.

Underneath, a fourth thing: **the pinch never reached the photo.** The media
column declared `touch-action: pinch-zoom`, handing two fingers to the browser's
own page zoom, and `ZoomableImage` had no multi-touch of its own. Pinching
therefore magnified pixels that had already been rendered instead of requesting
the 4096 px variant — on a photo viewer, on the gesture everyone tries first.

**Decision.** The rule extends to the viewer, and the pinch becomes ours.

**Search opens where the tab is.** A sheet, field first with the keyboard raised,
results filling the rest. It still creates no route — the field answers across
the whole library, so a results page would be a second place to search from — but
searching from inside an album no longer means leaving it, and the module-level
focus handoff that carried a request across that navigation is deleted with it.
The field leaves the top bar below `md`, which gives the album list back its
title: the one page that names the gallery had been showing the mark alone.

**The viewer's actions become the sheet's first row**: Info · Comments ·
Download · overflow. That row **is** the panel's tab strip — Info and Comments
open the sheet on their tab and then show which is open — so `PanelBody` renders
without its own tabs below `md`. One pair of choices, not two. The header keeps
Close, the album and the date: it identifies and it lets you out.

**`ZoomableImage` handles the pinch itself**, and the column declares
`touch-action: none`. Nothing is lost by taking it: the viewer is `fixed` over a
frozen body, so there is no page left to pan or zoom there. Tap toggles the
chrome and double tap zooms, as before — that convention was never the problem;
the missing pinch was.

**Consequences.**

The focus is fixed at the start of a pinch rather than followed. A midpoint
recomputed every frame drifts with the smallest asymmetry in how two fingers
move, and the photo slides out from under them.

A second finger cancels whatever was in progress — the pan, and any first tap
waiting to learn whether a second follows. Letting either survive made the photo
jump when the fingers lifted. The finger still down when a pinch ends resumes
nothing: it must lift and touch again.

The search field is `text-base` in the sheet and never smaller. iOS zooms the
whole page in when a field under 16 px takes focus, and the layout does not come
back on its own; at the mobile type scale `text-sm` is 14.7 px, which is exactly
the trap.

`viewer.actions` and the overflow menu survive, holding what a 390 px row cannot
carry — Fullscreen, Hide chrome, Set as cover. Each action now declares a stable
`key`, because the row partitions the list and matching on `label` would break
silently the day somebody translates one.

The `visualViewport` watcher that loaded `hd` on a page pinch stays, and its
comment is corrected rather than left: it now covers only a pinch started outside
the frame.

**Rejected.** Returning single tap to zoom, which is what the report asked for
first. Photos on iOS and Google Photos both spend the single tap on chrome and
the double tap on zoom; taking that back would make a full-screen photo — the
reason the viewer exists — harder to obtain than a magnified one. What the report
was actually missing was the pinch.

Also rejected: a real `/search` route. It is deep-linkable and the browser's Back
returns from it, both genuine gains, but it adds a URL, an empty state and a
history entry to a field that answers in three characters. The sheet is dismissed
by the same gesture that opens everything else here.
