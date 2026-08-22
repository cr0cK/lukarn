# D56 — The side panel takes a column; it no longer covers the photo

**Confidence.** observed — lib/zoom.ts, git ls-files → exit 0 · 2026-08-23

**Context.** The panel overlaid the right edge, exactly where the "Next" arrow
sat. Reading a thread and then moving to the next photo required closing the
panel, clicking, and reopening it — for every photo. Leaving it open was
impossible, although that is the natural way to browse a commented album.

**Choice.** From `md` upwards, the viewer is a row: photo column
`flex-1 min-w-0`, panel column
`md:relative md:w-80 lg:w-96 md:shrink-0` — the `md:` prefix applies to **all**
these classes, otherwise they would also apply to the phone's `w-full` overlay.
The photo area narrows, the arrows remain reachable, and the panel can stay open.
Below `md`, the overlay remains — taking 320 px from a phone screen would leave
nothing to see.

None of the zoom calculation changed. `ZoomableImage` measures its container with
`ResizeObserver`: the fit scale, "100%", and pan bounds recompute themselves when
the column width changes. This is what made the fix possible without touching
`lib/zoom.ts`.

**Rejected.** _Moving the arrows inward when the panel is open_: one class to
change, but the photo remains half hidden behind the panel, which is the real
problem. _A width transition_: the `ResizeObserver` would trigger one render per
animation frame for a movement nobody is watching.

**Consequences.** Between `md` and `lg`, the photo area falls to around 450 px
wide: the photo is displayed smaller but remains navigable. This is the accepted
tradeoff; the alternative would be returning to an overlay in this range and
therefore reintroducing the original defect on the most common laptop screens.
