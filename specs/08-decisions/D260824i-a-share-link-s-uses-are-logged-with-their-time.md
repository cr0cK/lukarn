# D260824i — A share link's uses are logged with their time, where telemetry counts days

**Confidence.** stated — owner: Alexis Mineaud, /do-spec interview · 2026-08-24

**Context.** D260809h measures the instance in a table aggregated on write, one
row per (album, key, session, day), and rejects a row per request on grounds of
scale: one album visit is a grid request, two hundred thumbnails and a few dozen
openings, which comes to tens of thousands of rows a day. The loss it accepts by
name is the exact time of every gesture.

**Decision.** A share link's use is recorded as an event carrying its time. The
question is not D260809h's: telemetry answers "is this instance being used, and by
whom", where a link's record answers "has this credential been used since I issued
it, and when", which is what turns revoking it into a decision rather than a
guess. The scale that ruled out an event log is absent here, since a link is
opened by a handful of people a handful of times and its whole life fits in a few
dozen rows.

**Rejected.** Reusing the aggregated shape. It gives "opened on the 3rd, 5th and
12th" and stops, which answers part of the question at no extra cost. It was
turned down because the record exists to govern a credential rather than to
describe traffic, and a credential's history is read once, at the moment somebody
is deciding whether to cut it off.

**Consequences.** This is the more invasive of the two shapes and it is worth
saying plainly: a named link (D260824b) with a timestamp is a record of when one
identified person looked at the photographs, and D260809h refused exactly that for
shared keys. What makes it acceptable is the purpose, so the purpose bounds it.
The record stops at the link and never reaches the photograph, which is
D260809h's own limit. It holds no IP address, for D260809h's reason: the link
already says everything an address would, and storing one turns a log into
personal data needing protection. It is pruned on the same schedule as the rest.
