# D17 — Dimensions in the index, corrected for rotation

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** The justified grid needs the proportions of each image before it
can be drawn.

**Decision.** `width` and `height` are stored in the database, **already swapped**
when `imageMediaMetadata.rotation` is odd (5 to 8 in EXIF).

**Rejected.** Measuring images as they load on the client, which would cause a
reflow as each thumbnail arrives — precisely the flaw that the justified layout
is meant to avoid.

**Consequences.** The entire frontend depends on this decision: a stable layout,
a correct scrollbar from the first render, and possible virtualisation. See
[07](../07-frontend.md).
