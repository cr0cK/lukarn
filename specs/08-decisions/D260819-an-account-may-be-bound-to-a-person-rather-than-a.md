# D260819 — An account may be bound to a person, rather than a second authentication mode

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-20

**Context.** `users` is an access key.
[D38](./D38-an-access-key-is-not-a-person.md) separated it from `commenters`, the
person who signs a comment, because a password given to a whole family cannot say
who is writing. That answers the family album and leaves one case uncovered:
somebody outside the household who should hold an account of their own, whose name
follows them from a phone to a laptop without being proved again on each, and to
whom nobody wants to hand the shared password.

The shape that suggests itself is an instance-wide setting: shared keys here,
personal accounts there, each with its own sign-in. Two modes are two security
models to hold at once, and [04](../04-security-and-access.md) is written for one.
Much of it is justified by the sharing itself. Pairing a screen delegates an access
key and deliberately does not carry the approver's identity
([D260809c](./D260809c-a-television-does-not-type-a-password-it-displays.md));
moderation's remedy for a key that has circulated too widely is to change its
password; the visit counters stop at the album because counting photo by photo
would produce a viewing history in an application where a household shares one
password. Under a second mode every one of those sentences needs its other half, in
the code, in the tests, and on every page that states them.

**Decision.** One axis. `users.commenter_id` binds an account to a verified
identity, or it is `NULL` and nothing about that account changes.

| The account is | What it is                         | Where the identity comes from    |
| -------------- | ---------------------------------- | -------------------------------- |
| Unbound        | An access key, shareable as before | The session, declared per device |
| Bound          | One person                         | The account, on every request    |

`user_albums` remains the only source of album permissions, keyed by
`users.username`, and that is the point of doing it this way.
[D33](./D33-no-google-sign-in-for-commenting.md) rejected Google sign-in for
visitors because a Google identity exists in neither `users` nor `user_albums`:
honouring it would have required an allowlist of addresses per album, which is
`users` rewritten under another name. A binding adds a person to an account that
already carries permissions. It creates no second population, and every rule
written against a session — `canSee()` on every request, 404 and never 403, the
account reread on every request — stays true without ever asking which kind of
account it is looking at.

**The binding is proved by the address, and never asserted from /admin.** An
administrator able to point an account at an existing identity could point their
own account at anyone who has ever commented and sign as them: the impersonation
[D39](./D39-the-address-is-verified-by-a-one-time-code.md) exists to prevent, moved
from the comment form to the accounts table. `users.commenter_id` is therefore set
to an identity when a code is consumed, cleared by unbinding, and written by
nothing else. Inviting an account creates a
`verification_codes` row of purpose `invite` naming it, and entering the code is
what writes the column. Because the column is written only there, a bound identity
is always a verified one, and the rule that an unverified identity is attached to
no session holds without a check of its own.

**Rejected.** _An instance-wide authentication mode_, above; it also fails on its
own terms, since the two populations coexist in one household. The living-room
television wants a shared key at the same moment as the cousin who comments wants an
account. _Permissions carried by `commenters`_: it splits "may this session see this
album" across two tables, exactly the join `canSee()` exists not to perform on every
thumbnail. _The administrator binding an existing identity from /admin_: the
convenience is real and it costs an impersonation no audit trail would undo. _The
address as the sign-in identifier in place of `username`_: D38 rejected it because
`users.username` is referenced by `user_albums` and `comments` without
`ON UPDATE CASCADE`, and the binding is what makes it unnecessary.

**Consequences.** The pairing rule inverts, and only for a bound account.
[04](../04-security-and-access.md) states that the commenter identity does not
follow a paired screen, because on a shared key the approver is one of several
people. On a bound account the identity _is_ the account, so it follows by
construction, and approving a screen delegates the ability to sign as you.

**The visit counters do not change**, and their justification does: from "the
counters cannot identify a person" to "the counters do not identify a person",
which is the stronger promise. It is recorded so that a later session does not read
personal accounts as permission to count photo by photo.

**`comments.account` keeps its meaning**, and on a bound account names that
person's own key. The remedy it was added for has no equivalent there, and deleting
the account is what closes that door. **A key genuinely shared by a household is
retired rather than converted**: conversion is for the account that was only ever
one person, and the living-room television keeps a shared account with no identity,
which is the case the unbound half exists to preserve. **Registration stays
excluded** ([01](../01-vision-and-scope.md)): what the invitation changes is who
types the secret, not who may open the door.

The credential a bound account is entered with, and why it holds no password, is
[D260819b](./D260819b-a-bound-account-signs-in-with-a-code-sent-to-its.md).
