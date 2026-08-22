# D44 — A superseded synchronisation pass no longer writes anything

**Confidence.** observed — routes/admin.ts, git ls-files → exit 0 · 2026-08-23

**Context.** Found during cross-review. Changing an album's Drive folder purges
the index immediately (`routes/admin.ts`), so the album instantly stops showing
what the owner has just removed. But the synchronisation already in flight for
the old folder continued: its subsequent batches reinserted the abandoned photos
**after** the purge, and its `deleteStale` did not remove them — it only removes
what that pass did not see. The photos became visible again for the entire new
pass, and permanently if the process stopped between the two.

**Choice.** Each pass carries a generation assigned when it takes its place in
`running`. It is checked again before every write — batches, `deleteStale`, and
`sync_state`. As soon as a reconfiguration launches another pass, the superseded
pass stops and returns a `SyncResult` marked `superseded`.

**Rejected.** Comparing configuration fingerprints instead of a counter:
returning to the original folder during a sync would make the two passes
indistinguishable, and the first would regain control of the index. Also rejected:
actually cancelling the in-flight pass — it is waiting for a Drive response, and
interrupting it would require propagating an `AbortSignal` to every HTTP call for
no gain, since this pass only consumes quota that has already been spent.

**Consequence.** An abandoned pass does not touch `sync_state` either: writing
"error" would display a failure in /admin when nothing failed.
