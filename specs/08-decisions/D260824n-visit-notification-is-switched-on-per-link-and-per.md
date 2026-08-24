# D260824n — Visit notification is switched on per link and per album, never for the instance

**Confidence.** stated — owner: Alexis Mineaud, /do-spec interview · 2026-08-24

**Context.** A link is made for one recipient, so a switch on it is a choice about
that person. An album opened by accounts is a different unit: the choice is about
the album rather than about which household opens it, because an access key may be
shared and there is nobody in particular to follow (D38). What both must avoid is
one switch that turns the whole instance into a reporting system.

**Decision.** The switch is offered where a link is created, and on an album for
openings by an account. It is off by default in both places, and there is no
instance-wide switch.

**Rejected.** A single instance setting. It is one switch rather than many, and it
makes "am I reported on" a property of the installation rather than of the thing
that was shared. Also rejected: no switch on albums at all, with account visits
always reported once the feature exists, which would produce mail about an album
shared with a household nobody is following.

**Consequences.** An administrator wanting to follow everything turns on several
switches. That is the intended friction: each one is a small decision about a
specific album or a specific person, taken at the moment there is a reason to.

Off by default carries more weight here than it usually would, because the
notification is silent (D260824m). Something that reports on people without
telling them must not be a thing an instance does before anybody has chosen it.
