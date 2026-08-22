# D61 — Prewarming stops when Drive is not connected

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** `CachePrewarmer` only checked `prewarmCache`. With no Drive
connection — a fresh instance, revoked consent, or a missing service account key
— the pass traversed the entire album, failing photo by photo, **including a
one-second pause** because it sits outside the `try`. For a thousand photos, that
is a quarter-hour of pointless looping per hourly pass and as many log lines
drowning out what actually matters.

**Choice.** Connection becomes part of the existing predicate:
`enabled: () => this.settings.prewarmCache && this.drive.connected`. This
predicate is already reread on entry to `run()` **and** for every photo (D45), so
the pass stops immediately, and a revocation during the pass interrupts it just
as unchecking the setting would.

**Rejected.** _Adding `drive` to `PrewarmDeps`_: one more dependency on an entire
service where a boolean is enough — and `CachePrewarmer` has no other reason to
know about Drive. _A `try` around the pause_: this would accelerate the pointless
loop instead of preventing it.

**Consequences.** The pass only resumes on the next trigger — hourly housekeeping,
startup, or the end of synchronisation (D58). Reconnecting Drive therefore does
not restart prewarming within a second; in practice, the return from OAuth starts
a synchronisation, which triggers it.
