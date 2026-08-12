# D87 — A departed image must be abandoned, or it blocks the queue for those being viewed

**Context.** Some thumbnails remained black in the grid — sometimes for a
minute, sometimes long enough to appear lost. Opening the corresponding photo
showed it immediately, ruling out a failed server render: the file existed, but
the thumbnail did not arrive.

Measurement found the culprit outside the grid. Protocol: scroll down an album,
open a photo, move through twenty-five photos with the arrows, close it, then
inspect in-flight requests. Three seconds after closing: **89 requests**, led by
twenty-four ten-second-old one-megabyte `…/full` requests. The sixty thumbnails
needed after returning to the grid sat behind them in the queue — the six
connections a browser gives one HTTP/1.1 origin — and took a minute to fill.

Those `full` requests belong to photos **already left behind**. `ZoomableImage`
is remounted for every photo (`key={item.id}`, resetting zoom and framing without
manual management), and removing an `<img>` from the DOM **does not cancel** its
download. The grid already knew this trap and handled it with `releaseIfDetached`;
the viewer did not, despite downloading files a hundred times larger.

**Decision.** `releaseIfDetached` moves from `Thumb` to `lib/imageRelease.ts` —
two callers, one reason — and `ZoomableImage` calls it on unmount, abandoning an
in-flight `hd` at the same time. After: **ten in-flight requests, zero orphaned
`full` requests**, and the grid fills in five seconds instead of sixty.

**Rejected.** Suspecting preloading: it already cancelled correctly, and
`image.src = ''` and `removeAttribute('src')` both produce `net::ERR_ABORTED` —
verified in the browser before changing code. Also rejected: relying on HTTP/2
behind the proxy to dissolve the queue. Multiplexing removes the six-connection
limit, not the server's four simultaneous renders (`media/semaphore.ts`), which
plays exactly the same role in an album whose thumbnails are not cached. The true
fix is not requesting what is no longer viewed.

**Consequences.** The rule now applies to every `<img>` this frontend mounts and
then unmounts: the request is explicitly stopped. The `isConnected` check makes
it safe under `StrictMode`, which replays mounting and unmounting without touching
the DOM.
