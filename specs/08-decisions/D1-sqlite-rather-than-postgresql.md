# D1 — SQLite rather than PostgreSQL

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** A searchable media index, with chronological sorting and pagination,
is needed on a modest VPS.

**Decision.** better-sqlite3, a single file in `DATA_DIR`, in-process, with WAL enabled.

**Rejected.** PostgreSQL — one more service in the compose stack, more RAM, a backup to
orchestrate and a connection pool, for a volume that remains in the tens of thousands
of rows with a single writer. No Postgres feature is needed here. Also rejected: a
simple JSON file, which cannot handle cursor pagination or partial updates during a
synchronisation.

**Consequences.** The better-sqlite3 API is synchronous, which blocks the event loop —
acceptable because all queries are indexed and return no more than a few hundred rows.
`busy_timeout` and WAL cover concurrent reads and synchronisation.
