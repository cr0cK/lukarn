# D50 — Input lives in the album; the mutation remains under `/api/admin`

**Context.** It is impossible to know what to write about a day without seeing
its photos. Annotating from `/admin` would amount to asking someone to describe
14 July from memory while looking at a list of albums.

**Choice.** The pencil is in the grid, beside the photos; the request goes to
`PATCH /api/admin/albums/:id/days/:day`. Reading is on the gallery side:
`GET /api/albums/:albumId/days`.

This is not an inconsistency; it **preserves an invariant**: only `/api/admin/*`
responds with **403**. Everywhere else, denied access responds with 404 so that
other people's album lists cannot be inferred (D12). A write route mounted under
`/api/albums` would have had to choose between breaking this invariant and
responding with 404 to a legitimate visitor who is not an administrator — in
other words, lying about the existence of the album they are viewing.

**Rejected.** _A third response regime_ (403 under `/api/albums` for this route
only): an invariant that admits an exception is no longer an invariant, and this
is the kind of detail lost during the next review. _A "days" section in `/admin`_:
it would require finding a date in a list, without the photos that explain what
it is about.

**Consequences.** The frontend carries the rule "pencil visible if `me.admin`
and grouped by day", and the server checks it again — as everywhere else, the
interface only avoids offering an action that would fail.
