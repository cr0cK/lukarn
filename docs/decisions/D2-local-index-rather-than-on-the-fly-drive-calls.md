# D2 — Local index rather than on-the-fly Drive calls

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** The grid must paginate 10,000 photos and sort by the date they were taken.

**Decision.** Traversing the folders populates a `media` table; the grid reads only from
SQLite.

**Rejected.** Querying `files.list` for each grid page: network latency on every scroll,
API quota consumed by navigation, and no way to sort by the EXIF date (Drive only sorts
by `name`, `modifiedTime`, `createdTime`…).

**Consequences.** The index can lag behind Drive — that is the role of
`sync.intervalMinutes`. In return, the application remains browsable even when Drive is
unreachable or authorisation has been revoked: only renders not already in the cache
fail.
