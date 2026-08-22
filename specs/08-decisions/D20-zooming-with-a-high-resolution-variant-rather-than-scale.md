# D20 — Zooming with a high-resolution variant rather than `scale()` on the screen rendering

**Confidence.** observed — packages/web/src/components/ZoomableImage.tsx, git ls-files → exit 0 · 2026-08-23

**Context.** The user wants to examine the details of a photo in the viewer.

**Decision.** `ZoomableImage` (`packages/web/src/components/ZoomableImage.tsx`)
calculates a "native scale" — one photo pixel per screen pixel — from the index
dimensions, and loads the `hd` variant **off-screen** on the first zoom before
substituting the source.

**Rejected.** A `transform: scale()` on the `full` rendering: it only enlarges
pixels already rasterised at 2560 px, so it reveals no detail. Also rejected:
loading `hd` immediately, which would make every photo opening heavier for an
action most visitors will not take; and switching back to `full` when returning
to fit, which would make the image flash on every round trip.

**Consequences.** Zooming a photo whose dimensions are unknown to the index falls
back to those of the received rendering — more limited, but available. A
`loading HD…` indicator is displayed until the variant is ready, rather than
blocking the action.
