# D260825c — A link's openings are recorded with their times, one row per session and hour

**Confidence.** stated — owner: Alexis Mineaud, /do-plan challenge on Sharing-without-an-account · 2026-08-25

**Not built yet.** Decided 2026-08-25; no code implements this.

**Context.** D260809h measures this instance in `album_visits`, a table aggregated on write with
one row per `(album_id, username, session_id, day)`. It names the exact time of every gesture as a
loss accepted on grounds of scale: one album visit is a grid request, two hundred thumbnails and a
few dozen openings, so counting each one would produce tens of thousands of rows a day.

Deciding whether to cut a link off is a different question asked at a different moment. It is read
once, about one credential, by the person who issued it, and the scale that ruled out an event log
is absent: a link is opened by a handful of people a handful of times.

**Decision.** A link's openings live in a table of their own, one row per opening, carrying the
link, the session and the time. An opening is counted **once per session per hour**, following the
threshold `last_seen_at` already uses, so a reader who refreshes the page does not turn one visit
into six.

**D260809h stands unchanged.** Its question is how this instance's **traffic** is measured, and its
answer is still the aggregated table; a credential's history is a different question, which the
intent that asked for this said in those words. `album_visits` could not have held it in any case:
it is `WITHOUT ROWID` on a key whose second column is a username, and a link has no username
(D260825).

**The boundary D260809h drew does not move.** Never the photograph: what is recorded is that a link
was opened, not what was looked at through it. Never an address, and never an IP. The session
identifier is a bucket for telling two visitors apart, as it already is in `album_visits`, and not a
link to anything.

**The cost, written down rather than rediscovered.** A named link with a timestamp is a record of
when one identified person looked at the photographs, and D260809h declined to build that for shared
keys on the grounds that a household is not a person. A link is aimed at somebody, so it does
identify, and that is the thing being accepted here rather than an oversight. What keeps it
proportionate is that it is read by the one person who issued the link, and that it stops at the
door.

**Rejected.** _Day-level precision, matching `album_visits`._ Recommended and declined. It answers
"somebody opened this at some point on Tuesday", where the question being asked an hour after
sending an album is whether it arrived.

_A column on the link, holding the last two times._ It is enough for what this intent asks and
nothing more, and the intent that follows this one wants the first opening and a count. Storing the
openings answers both with no second migration; storing two timestamps answers one and then has to
be undone.

_The four-hundred-day purge that `album_visits` gets._ A link's first opening is part of what
administration reports, so a window that eventually drops it would make the oldest links quietly
start lying. The volume does not need pruning: deleting the link deletes its rows, and that is the
only thing that does.

**Consequences.** Administration shows, for each link, when it was last opened and when before
that. Everything else this table makes possible — a first opening, a count, a message when one
arrives — is deliberately left to the intent that asked for it.

A revoked link keeps its rows (D260825b): the history is what the person deciding whether to cut a
link off was reading, and cutting it off must not erase what justified the decision.
