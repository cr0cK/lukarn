# D260824k — A link announces its first opening at once, an album only in the summary

**Confidence.** stated — owner: Alexis Mineaud, /do-spec interview · 2026-08-24

**Context.** "Following consultation" carries two questions at two speeds. Whether
what was just sent has arrived is asked within the hour and burns. Whether anybody
comes back is asked idly, over weeks. One cadence cannot serve both: a message per
opening answers the first question and then buries it under the second.

The first question also belongs to only one of the two doors. A link is a **send**:
it was made for one person, handed to them, and there is a moment afterwards when
the question exists and has a single answer. An album opened with an account is not
a send. The household already had that album, and announcing the first time each
key opens each one would report something that did not just happen.

**Decision.** A link's first opening produces a message at once. Everything else is
counted and reported in a periodic summary: every later opening of a link, and
every opening of an album by an account, first one included. The summary's interval
is a setting in administration, one week by default.

**Rejected.** A message per opening. Five links opened twice a week is ten messages
saying "somebody looked", and the folder they end up in is the one where the
message that mattered gets missed too. D37 sends without retry, so volume buys
nothing back. Also rejected: the summary alone, which makes "did the link I sent an
hour ago arrive" wait for the next one, and that is the question actually being
asked. Also rejected: announcing a first opening at both doors, for symmetry. Six
keys across twenty albums is a hundred and twenty announcements spread over months,
each one answering a question nobody had asked.

**Consequences.** "First" is a property of the link rather than of a session:
reopening from a second device does not announce twice. A link revoked and reissued
is a new link and announces again, which is right, because it was sent again.

The interval is a setting because it is the one thing about this feature somebody
will want to change: a week suits a gallery opened a few times a year and is wrong
for one in daily use.

**The message relays a record rather than being one.** When a link or an album was
first opened, when it was last opened and how many times is read in administration,
whether or not anybody asked to be written to. Sending without retry (D37)
therefore costs nothing worth guarding against: a message that never arrives loses
a convenience, and the answer is still where it was. It is also what makes the
switch honest as a switch, since turning it off removes the mail and not the
record. An album's first opening is in that record like everything else; it is
simply not worth a message of its own.
