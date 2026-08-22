# D27 — An interrupted sync leaves a mixed index, and that is accepted

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** `Syncer.run()` writes in batches of 500, each batch in its own
transaction, so that the album becomes browsable during synchronisation (see
[02](../02-architecture.md)). If the sync fails partway through, the batches
already written are **committed**: the index mixes old and new content. The
comment in the `catch` block claimed the opposite — that the previous index
continued to be served.

**Decision.** Correct the comment, not the architecture. The resulting state is
consistent: `deleteStale` has not run, so nothing has been removed, and
everything just written does exist in Drive. The album is simply incomplete,
and `sync_state` says so — `error` status, message, and `lastSyncAt` remaining
that of the last **successful** run.

**Rejected.** A staging index: writing the sync to a parallel table, then
switching over in a single transaction. This would double the space occupied by
the index, lose the property that justifies the batches — the album being
browsable during the sync, which matters for an initial load lasting several
minutes — and only provide atomicity that nobody needs here: an incomplete album
for an hour is not a correctness problem, it is a delay that the next sync
catches up on. Also rejected: a single transaction for the entire sync, which
would hold a SQLite write lock throughout the Drive traversal.

**Consequences.** `lastSyncAt` must be read as "date of the last complete run",
never as "date of the current index state". Repeated failure leaves an album
that grows slightly with each attempt without ever being cleaned up: it is the
`deleteStale` of the first successful sync that puts everything right.
