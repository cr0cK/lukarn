# D260824c — A share link expires only if it is given a date

**Confidence.** stated — owner: Alexis Mineaud, /do-spec interview · 2026-08-24

**Context.** A link with no password is a credential for anybody holding the URL.
The reflex guard is a mandatory expiry, and the question is whether this gallery
is the place for one.

**Decision.** The date is optional and empty by default. A link lives until it is
revoked.

**Rejected.** A mandatory expiry with a default duration. This gallery is opened
three times a year by people who were sent a link once, and a link that dies on
its own becomes a telephone call in which the administrator learns about the
expiry from the person it inconvenienced. Also rejected: no expiry at all. "Just
for this week" is a real intention, and a date is the cheapest way to hold it
without asking somebody to remember to come back.

**Consequences.** The forgotten link is the accepted risk, and the administration
section (D260824g) is what makes it findable: every link in one list, each with
when it was last used. A link nobody has opened for a year is the row that list
exists to show.
