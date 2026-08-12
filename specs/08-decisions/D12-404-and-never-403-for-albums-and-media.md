# D12 — 404 and never 403 for albums and media

**Context.** Several users share an instance and must not learn that other
users' albums exist.

**Decision.** An album or media item that the user is not authorised to access
returns **404**, indistinguishable from a non-existent identifier.

**Rejected.** A 403, semantically more honest, but it confirms that the resource
exists and makes the structure of other users' albums observable by probing
URLs.

**Deliberate exception.** `/api/admin/*` returns 403: the existence of the admin
area is not a secret. `packages/server/test/access.test.ts` locks in both
behaviours.
