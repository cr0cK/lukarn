# D21 — Asymmetric preloading in the viewer

**Context.** Each photo missing from the server cache requires downloading an
original from Drive; preloading too widely saturates the queue and slows down the
photo being viewed.

**Decision.** Four photos in the direction of navigation, only one in the other
direction, with the closest requested first. The direction is inferred from the
last movement. Effect cleanup cancels (`image.src = ''`) downloads that have
become unnecessary when navigating quickly.

**Rejected.** A symmetrical radius (the previous version loaded two on each
side): for the same number of requests, it spends half its budget in a direction
the user has just left.
