# D15 — The revoked token is retained, not deleted

**Confidence.** observed — packages/server/test/revocation.test.ts, git ls-files → exit 0 · 2026-08-23

**Context.** Google may reject the refresh token (`invalid_grant`) without
warning: access withdrawn, six months of inactivity, or the application returned
to "Test".

**Decision.** `DriveService.guard()` detects the error, timestamps `revoked_at` and
throws a typed `DriveRevokedError`. The `oauth_token` row remains, together with
its account.

**Rejected.** Deleting the row. An empty table looks like a new installation,
whereas the administrator needs to be told _which_ account has lost its
authorisation and that it needs to be reconnected, not connected.

**Consequences.** Once revoked, `authorizedClient()` fails immediately without
calling Google again. `syncAll` stops its loop on this error: subsequent albums
would fail in the same way. Media routes translate it to `503 drive_revoked`. A
network error or a Google 500 does **not** trigger revocation —
`packages/server/test/revocation.test.ts` verifies this.
