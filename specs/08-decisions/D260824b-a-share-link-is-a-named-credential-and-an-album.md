# D260824b — A share link is a named credential, and an album carries several of them

**Confidence.** stated — owner: Alexis Mineaud, /do-spec interview · 2026-08-24

**Context.** Access has one shape here: a key in `users` with a password, granted
albums through `user_albums`. Showing an album to somebody outside that circle
means handing over a password, which is D38's shared key circulating further, or
creating an account for a person who will use it once. A link with no password
answers both. What it leaves open is whether an album has one such link or many.

**Decision.** Many, and each one carries a name the administrator chooses: the
person or the group it was sent to. The name is a label for whoever manages the
links and never an identity. Somebody arriving through a link is still nobody
until they verify an address (D38, D39). Revocation and measurement both operate
on a single link, so cutting off one recipient leaves the others untouched, and
"who is looking" has an answer.

**Rejected.** One link per album. Revoking it cuts everybody at once, which aims
the remedy at the wrong people, and the record of use could never say more than
"somebody looked". Also rejected: several links without names. Revoking the right
one then depends on the administrator having written down elsewhere which token
went where, and that is the note nobody keeps.

**Consequences.** A comment written through a link retains which link carried it,
the way `comments.account` retains the access key used (D38), and for the same
reason: that is what gets revoked when a link has circulated too widely. The
moderation queue shows a link's name where it shows an account's, so an invited
stranger is distinguishable from a household. The name is written for the person
managing the links and is shown to nobody else.
