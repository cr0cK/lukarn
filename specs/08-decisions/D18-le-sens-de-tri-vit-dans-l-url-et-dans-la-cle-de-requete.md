# D18 — The sort direction lives in the URL and the query key

**Context.** The album can be browsed from newest to oldest or the other way
round.

**Decision.** `?order=asc` in the URL (the `desc` default is not written there),
`order` in the TanStack Query key `['items', id, order]`, and a query parameter
validated by a closed zod union on the server.

**Rejected.** Local React state: a shared link would not restore the view, and
the browser's back button would do nothing. Also rejected: silently falling back
to the default for an unknown value **on the server** — the API returns 400 so
that a client making a mistake learns about it; the frontend absorbs a manually
altered URL.

**Consequences.** Without `order` in the query key, TanStack would serve pages
already loaded in the other direction and continue paginating backwards.
Reversing the sort renumbers the album: the selection is reset and the page
scrolls back to the top.
