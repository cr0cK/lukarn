# D59 — An unmounted thumbnail does not cancel itself

**Context.** The reported symptom was misleading: a non-administrator account
remained on "Loading photos" where the administrator account displayed the
album. Everything pointed to access control. It was not: the requests were not
failing, they were **waiting** — and eventually completed.

Removing an `<img>` from the DOM does not cancel its download. Grid virtualisation
unmounts thumbnails that leave the viewport, but the browser completes their
requests, and each continues to occupy one of the **six** connections HTTP/1.1
allows per origin. A few dozen cold thumbnails are enough to saturate that limit;
everything sent afterwards waits its turn, including the `GET /items` on which
display depends. Hence the difference between the two accounts, which had nothing
to do with permissions: one had all its thumbnails in the browser cache, while
the other opened a fresh session.

The clearest case is a **change in sort direction**: it starts `/items` again
behind the wave of now-useless thumbnails from the previous order that are still
in progress. The screen then remains on "Loading photos" until they drain —
several dozen seconds on a cold album. The mechanism is certain; the exact
duration depends on Drive throughput and was not replayed under controlled
conditions.

**Choice.** `Thumb` clears its `src` on unmount. This is the only action that
actually stops an in-progress image request.

The `isConnected` check is essential and is not a stylistic precaution:
`StrictMode` replays mounting and unmounting **without touching the DOM**, so
without it the thumbnails on the first screen lost their `src` as they appeared —
React does not write it again because its view of the DOM considers it unchanged.
The node is captured when the effect runs, since React has already reset the ref
to `null` by cleanup time.

**Rejected.** _An `AbortController` and a `fetch` per thumbnail_: this would
require managing `blob:` URLs, revoking them, and replacing the HTTP cache lost in
the process — considerable machinery for what removing an attribute achieves.
_Reducing `OVERSCAN_PX`_: this decreases the number of orphaned requests without
eliminating the leak, and degrades fast scrolling.

**Consequences.** The initial diagnosis — "multi-user bug" — was a complete
false lead, and that is this entry's most useful lesson: two accounts behaving
differently on the same data may owe nothing to permissions and everything to
the state of their browser cache. The decisive measurement was the contrast
between server timing, which responded quickly, and browser timing, which waited.
