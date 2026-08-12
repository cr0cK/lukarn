# D28 — Three columns written but never read are retained

**Context.** `media.modified_time`, `oauth_token.scope` and
`sessions.created_at` are populated on write and do not appear in any read query.

**Decision.** Keep them, and document their purpose in `db.ts` so that they are not
mistaken for an oversight. `modified_time` is the chronological reference from
which `taken_at` is derived when EXIF is missing, allowing recalculation without
reindexing; `scope` will show, when `SCOPES` changes, whether the stored token
still covers what the application requests; `created_at` is the only record of a
session's age, the first thing to check after suspicious access.

**Rejected.** Removing them. SQLite only removes a column by recreating the table
and copying the rows — a destructive migration on a live database, to save a few
bytes per row and lose three pieces of information that could not be
reconstructed. The benefit-to-risk ratio is plainly poor.

**Consequences.** A "dead columns" audit will find them. The comment in `db.ts`
and the table in [03](../03-data-model.md) are there to answer it.
