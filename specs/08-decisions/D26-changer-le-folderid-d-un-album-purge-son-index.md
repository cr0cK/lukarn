# D26 — Changing an album's `folderId` clears its index

**Context.** Changing the Drive folder of an existing album leaves media that
belong to the old folder in the database.

**Decision.** Immediate clearing (`clearAlbum`), sync state reset to `never`, and
resynchronisation started in the background if Drive is connected.

**Rejected.** Waiting for the next synchronisation to clean up through
`deleteStale`. The window between the two is exactly when the album shows what
the owner has just tried to remove — and if Drive is disconnected or its access
is revoked, that window never ends. Also rejected: clearing without
resynchronising, which would leave an empty album and require one more click.

**Consequences.** A typo in the `folderId` costs a full reindex of the album. That
is the price of never serving content from a folder that has just been removed.
Derived files in the disk cache are unaffected: they are indexed by file id, so
they are shared between albums and can be regenerated.
