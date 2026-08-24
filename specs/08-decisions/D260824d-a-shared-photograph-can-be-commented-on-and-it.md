# D260824d — A shared photograph can be commented on, and it names no album

**Confidence.** stated — owner: Alexis Mineaud, /do-spec interview · 2026-08-24

**Context.** A link can cover one photograph rather than an album, and a
photograph sent on its own is usually the one somebody wants to say something
about. But the comment machinery is attached to an album: opening one subscribes
a verified visitor to its updates (D41), and the activity feed groups by album
(D82).

**Decision.** Commenting through a photograph link works as it does everywhere
else. The address is verified by a one-time code (D39), the person signs their
own name (D38), and moderation is the same reversible hiding (D36). The album is
absent from everything that visitor meets: not on the page, not in the address
they were sent, not in the email carrying the code, and not in any notification.
A photograph link subscribes nobody to anything, because there is no album on
offer to subscribe to.

**Rejected.** A photograph link that only shows. It is the cheapest thing to build
and it removes the reason to send one photograph rather than the album it sits in.
Also rejected: showing the existing thread read-only. That hands the names and
words of relatives to whoever holds the link, in exchange for nothing the visitor
asked for.

**Consequences.** The comment lands on the photograph, so it appears in the
album's thread for everybody who can see the album, while its author can see
neither. Replies reach them by email through `commenters.notify`, which needs no
album and already works this way.
