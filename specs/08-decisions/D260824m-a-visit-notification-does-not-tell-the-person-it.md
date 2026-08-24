# D260824m — A visit notification does not tell the person it reports on

**Confidence.** stated — owner: Alexis Mineaud, /do-spec interview · 2026-08-24

**Context.** D260809h bounded what this instance measures so that it would not be
a tracker, and its promise is a gallery that leaks nothing. It keeps that promise
by being a screen somebody consults. A notification inverts the shape: it reports
a person's action, unprompted, at the moment they take it. D41 set this
repository's usual answer to doing something to a person, which is to announce it
where they can see it and let them undo it in one click.

**Decision.** The notification is silent. Nothing on a shared page, and nothing an
account sees, says that opening it sends a message.

**Rejected.** Announcing it, which was the recommendation put to the owner. Its
argument was the failure mode of silence: a relative learning one day that every
visit to photographs of their grandchildren sent a message, which no setting
recovers from. It was turned down because the sentence lands worst exactly where
the feature is most ordinary. Telling somebody that their visits to a family album
are reported reads as an accusation, and the announcement would cost the
relationship more than the thing it announces.

**Consequences.** This narrows D260809h, and the narrowing is worth stating rather
than discovering. That measurement was defensible partly because it was passive,
and this is not passive. What survives is the boundary rather than the posture:
the message reports that a link or an album was opened and stops where D260809h
stops. It never says which photographs were looked at, and it carries no address.

A named link with a timestamp was already accepted as the more invasive of the two
shapes (D260824i); sending it to a mailbox is that same information arriving
without being asked for. The switch is off until somebody turns it on (D260824n),
which is what keeps this from being what the application does on its own.
