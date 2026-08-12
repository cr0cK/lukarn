# D43 — The browser cache is partitioned by session, not revoked

**Context.** Found during cross-review. Media responses are served with
`private, max-age=31536000, immutable`: the browser never revalidates them. A
photo that has already loaded therefore remains displayable from the cache after
the account loses the right to access it — `authorize()` is not even called and
no request reaches the server.

**Choice.** `Vary: Cookie` on all media responses. The private cache is then
indexed by session, which closes the only case where someone sees a photo they
have **never** had the right to see: two accounts used in succession in the same
browser profile, on the living-room computer.

**Rejected.** `private, no-cache` with systematic revalidation, as proposed by
the review. It is the correct answer on paper and costs too much here: a grid of
five hundred thumbnails would make five hundred conditional requests on every
visit, each going through `albumsContaining` — one round trip per image on a 4G
phone, for the application's most-used feature. Also rejected: signing media URLs
with a short expiry, which handles the same case at the cost of a signing
mechanism, a clock, and a validity window to choose.

**Accepted consequence.** Someone whose album access is removed keeps the photos
they had already loaded in their cache for up to a year. No header changes that:
they received them, they are on their disk, and they could have saved them.
Removing access prevents them from seeing **new** ones; it does not erase what
has already been shown. Switching to `no-cache` would not provide that property —
it would only add a request to every display.
