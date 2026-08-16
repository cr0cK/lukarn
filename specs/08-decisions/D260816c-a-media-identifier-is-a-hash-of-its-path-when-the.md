# D260816c — A media identifier is a hash of its path when the backend has none

**Context.** Until now the string the index stored as a file's identifier and the
string handed to `provider.fetch` were the same one: a Drive file id, opaque,
unique across every account, and unchanged when the file is renamed or dragged
into another folder.

Nothing else offers that. A local folder, a bucket and a WebDAV server name files
by **path**, and a path is neither of the two things an identifier has to be:

- **Not unique.** Two connections — a household with a backup each — both hold
  `2026/plage.jpg`. Sharing an identifier would put one album's comments on the
  other album's photograph, and `getFileMeta` would resolve the wrong one.
- **Not stable.** Renaming the file changes it.

The identifier is what `comments.media_id`, `albums.cover_media_id`,
`media_notes.media_id` and every disk-cache key are keyed on, so getting this
wrong is not a display bug.

**Decision.** A provider declares which case it is in — `StorageProvider.refKind`,
`'identity'` or `'path'` — and synchronisation acts on it:

- `identity` (Drive): the reference is stored as-is. Nothing changes, and no
  existing instance's comments move.
- `path`: the identifier is `sha1(connectionId + '|' + path)` truncated to 32
  hexadecimal characters, and the path itself goes into `media.source_path`.

The two are then carried together as `MediaRef { id, ref }`: `id` keys the index
and the cache, `ref` is the only form a provider can resolve. `mediaRef(id,
sourcePath)` collapses them back into one string for a Drive.

The connection is part of the hash rather than beside it because uniqueness has
to hold across the whole `media` table, which `getFileMeta` reads by identifier
alone. 128 bits puts a million-file library some twenty orders of magnitude below
an even chance of one collision, and the identifier appears in every media URL,
so the full forty characters would be paid on every request for nothing.

**Consequences.**

- **Renaming a file gives it a new identifier and orphans its comments.** This is
  the cost, stated plainly: the old row is removed by `deleteStale` and a new one
  is inserted, so the thread, the note and the cover reference point at nothing.
  Drive is the only backend where that does not happen, and it is the only one
  that gives us anything else to identify the bytes by.
- **The disk cache survives a connection being renamed**, because the key is the
  identifier and the identifier hashes the connection **id**, not its label.
- **Moving a file between folders inside one album** is the same as renaming it:
  the path changed. Within Drive it is free.

**Rejected.** Hashing the content instead of the path. It survives a rename, and
it costs downloading every file to compute — the opposite of
[D3](./D3-indexing-without-downloading.md), and worse than the problem.

Also rejected: hashing Drive's references too, for one uniform rule. It is one
branch shorter and it changes the identifier of every photograph on every
existing instance, breaking every comment thread already written to buy nothing.
