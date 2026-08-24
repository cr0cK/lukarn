# D260824k — A first opening is announced at once, and everything after it in a digest

**Confidence.** stated — owner: Alexis Mineaud, /do-spec interview · 2026-08-24

**Context.** "Following consultation" carries two questions with different
urgencies. Whether what was just sent has arrived is asked within the hour and has
one answer per link. Whether anybody comes back is asked idly, over weeks. One
cadence cannot serve both: a message per opening answers the first question and
then buries it under the second.

**Decision.** The first opening of a link, and the first opening of an album by an
account, produce a message at once. Every opening after that is counted and
reported in a periodic summary whose interval is a setting in administration, one
week by default.

**Rejected.** A message per opening. Five links opened twice a week is ten
messages saying "somebody looked", and the folder they end up in is the one where
the message that mattered gets missed too. D37 sends without retry, so volume buys
nothing back. Also rejected: the summary alone, which makes "did the link I sent
an hour ago arrive" wait for the next one, and that is the question actually being
asked.

**Consequences.** "First" is a property of the link, or of the album and account
pair, rather than of a session: reopening from a second device does not announce
twice. A link revoked and reissued is a new link and announces again, which is
right, because it was sent again.

The interval is a setting because it is the one thing about this feature somebody
will want to change: a week suits a gallery opened a few times a year and is wrong
for one in daily use.
