# D260824g — A share link is created where the thing is, and managed in one place

**Confidence.** stated — owner: Alexis Mineaud, /do-spec interview · 2026-08-24

**Context.** Two surfaces pull in opposite directions. The wish to share arrives
while looking at an album or at a photograph, and sending somebody to an
administration screen for it is what makes them attach a file to a message
instead. But a link that lives only where it was created cannot be revoked by
anybody who has forgotten which album it belonged to.

**Decision.** Both, with one job each. A link is created from the album or the
photograph it covers. Every link the instance has issued is listed in one
administration section, whatever it covers, and that is where it is renamed,
revoked and read for its use.

**Rejected.** Creation confined to administration. It is one surface to build
rather than two, and it puts the longest path in front of the most frequent
gesture. Also rejected: management confined to the album, with administration
listing links read-only. Revoking then requires remembering what the link covered,
which is precisely what has been forgotten by the time somebody wants it gone.

**Consequences.** The section joins the four D66 established, each with its own
URL. Sharing sits beside them rather than inside `/admin/albums`, because a
photograph link belongs to no album and would have nowhere to sit there.
