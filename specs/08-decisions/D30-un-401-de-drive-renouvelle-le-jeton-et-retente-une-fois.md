# D30 — A 401 from Drive refreshes the token and retries once

**Context.** A file is downloaded through `fetch` with an access token in the
header. When the owner revokes access, Google stops accepting that access token
**before** it expires: Drive responds with 401, but nothing surfaces as
`invalid_grant`, so `guard()` saw nothing. The cached token continued to be used
for up to an hour, /admin displayed "connected", and every thumbnail failed with
a technical message.

**Decision.** `DriveService.fetchAuthorized()` handles the 401: it discards the
cached OAuth client to force a new refresh token exchange, then retries **only
once**. The exchange goes through `guard()`, so a rejected refresh token is
recognised and the revocation recorded. A second 401 remains an error — it is no
longer a token issue.

**Related decision.** `guard()` snapshots the encrypted token in place when the
call starts, and `markRevoked()` writes only if it is still the one stored. A
request started before an OAuth reconnection but failing after the new token was
stored would otherwise mark that brand-new token as revoked — and /admin would
request a reconnection that had just been completed. Since every `completeAuth`
produces different ciphertext (salt and IV generated each time), the comparison
is enough to recognise that a reconnection has occurred in the meantime.

**Rejected.** Retrying in a loop: on a grid of 200 thumbnails, a persistent 401
would keep the server spinning pointlessly. Also rejected: marking the token as
revoked on the first 401 — a 401 can result from a file-specific permission, and
requiring new consent for that would be disproportionate.

**Consequences.** `accessToken()` is `protected`, not `private`: it is the
service's only network contact point, and tests use it as a seam to avoid calling
Google (`packages/server/test/revocation.test.ts`).
