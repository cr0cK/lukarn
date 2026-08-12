# D58 — Prewarming prepares thumbnails and follows synchronisation

**Context.** D45 had decided that prewarming renders the `full` variant and is
never connected to the end of a synchronisation. Both points proved wrong in use,
and it took a test account opening an album of 941 never-viewed photos to reveal
it — **2 min 36 before the first image**.

The explanation, with the source of each figure — it matters, as they do not all
have the same strength:

- **A derivative costs ~2 s, almost all of it spent downloading from Drive.**
  Taken from D45's measurement on a live instance.
- **Rendering itself is negligible beside that download**, around a few dozen
  milliseconds for a thumbnail. This is consistent with D45, which recorded
  1.5 s for a `full` render of an 8 MB DSLR image — a thumbnail is incomparable.
- **The limiter only serves 2 to 4 renders at once.** Read from the code:
  `renderConcurrencyFor` returns `max(2, min(4, cores - 2))`, meaning **two**
  slots on the two-core VPS targeted by this project and four on a development
  machine. Production is the worst case.
- **A cold grid requests several dozen at once.** Measured with `seed-demo 941`,
  in a fresh browser context, on opening and before any scrolling: **26**
  thumbnails mounted at 1280 × 720, 31 at 1920 × 1080, 36 at 2560 × 1440, 41 at
  1440 × 2400, and 26 at 390 × 844. Cross-checked on the server: 26 distinct
  `/thumb` requests did reach Fastify at 1280 × 720. The count is **independent
  of the number of photos in the album** — it is set by `OVERSCAN_PX` and the
  target row height — but depends on the viewport and the formats present;
  "around thirty" is the range to remember. On the album that prompted this
  entry, the observed wait was 2 min 36.

But D45 prepared no thumbnails at all, only the `full` variant — the one used
when clicking a photo, not when displaying the album. Prewarming therefore
worked diligently to eliminate a one-second wait while leaving untouched the
several-minute wait that preceded it.

**Choice.** The pass prepares the **three thumbnail sizes** and nothing else.
The chosen size depends on the cell width and screen density: all three must be
ready, otherwise half of screens would start from zero. `MediaRenderer.prepare`
produces them in **one download** and in one limiter slot — the original in memory
is what weighs heavily, and it is the same for all three. The `full` render leaves
prewarming: it is ten times the weight of a thumbnail, for a wait already covered
by preloading adjacent photos in the viewer.

The pass is also connected to the **end of every synchronisation**
(`AppContext.syncThenPrewarm`). This is the only time when new content is known to
exist, and the photos that have just arrived are exactly the ones people will
open. D45 rejected it because synchronisation can be disabled — the argument is
valid, but it justifies **keeping** the other triggers, not rejecting this one.

**Rejected.** _Also preparing the `full` render_: for 941 photos, the volume
increases from a few dozen MB to several GB, against a `cacheMaxSizeGB` limit that
would start evicting — and eviction is global LRU, so thumbnails from albums
actually being viewed would go. _Locking an album until prewarming completes_, or
_displaying progress_: two responses to the symptom, rejected because the cause
was elsewhere (see D59) and, once addressed, the residual wait no longer justifies
the machinery.

**Consequences.** `prewarmCache` remains a setting, `true` by default: the desired
behaviour is therefore that of a fresh instance, while it can still be unchecked
on a metered connection. An album that has already been prepared no longer spends
an entire pass doing nothing — `prepare` returns `0` when everything is cached,
and the pass then skips its one-second pause instead of incurring it per photo.
