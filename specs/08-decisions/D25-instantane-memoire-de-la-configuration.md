# D25 — In-memory configuration snapshot

**Context.** `canSee()` is called on every media request, and therefore for every
thumbnail in a grid of several hundred tiles. Replacing the in-memory config was
cost-free.

**Decision.** `ConfigRepo` maintains a snapshot (albums, accounts, access rights,
settings), rebuilt on the first read after a write. As the sole writer to these
tables, it cannot serve stale state.

**Rejected.** One SQL query per call: indexed and in-process, it would be
manageable, but that means several hundred queries each time an album is opened
for data that changes a few times a month. Also rejected: a time-expiring cache,
which would preserve revoked access for a few seconds — unacceptable for an
authorisation decision.

**Consequences.** Every write must go through `ConfigRepo`. A direct `UPDATE` on
`users` or `albums` from another module would serve a stale snapshot until the
next legitimate write.
