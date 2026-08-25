# D260825 — A share link is a credential of its own, and the session it opens looks like every other session

**Confidence.** stated — owner: Alexis Mineaud, /do-plan census on Sharing-without-an-account · 2026-08-25

**Not built yet.** Decided 2026-08-25; no code implements this.

**Context.** Authorisation has exactly one entry point. `ConfigRepo.canSee(username, albumId)`
answers every album, media, comment and search question, and `albumsFor(username)` supplies the
scope wherever a list is built. Both take a username, and a session without one is destroyed on
the next request: `plugins/auth.ts` rereads `config.user(session.username)` and treats its absence
as an account that has been deleted.

A link opens an album for somebody who has no account, so it has to give that chain something.
There were two ways to do it, and the cheap one does not survive the second half of the feature.

**Decision.** A link is a **fourth thing**, beside the owner's Google consent, the access key and
the person who comments — the three that [04](../04-security-and-access.md) already asks not to be
confused. It is a row of its own, it grants exactly what it was made to grant, and `canSee` is
never asked about it.

Three properties follow, and each of them is the reason for the choice rather than a detail of it.

**The token is random and its rights live in the row.** Thirty-two bytes from `randomBytes`, as a
session identifier already is (D11), and never a signed HMAC over what it grants. The three tokens
this application already mints — the two unsubscribe links and the verification code fingerprint —
carry no row, which is what makes them cheap and what makes them impossible to revoke. A link is
defined by being revocable, so it takes the opposite trade: the row is the truth, revocation is a
write, and it lands on the next request exactly as removing an album from an account does.

**Opening a link opens a session**, and that session answers `GET /api/auth/me` with the same
`SessionUser` shape an account gets. This is what keeps the feature small: the composer in
`CommentsPanel` branches on that response alone, so the identity form, the six-digit code and the
whole comment stack work through a link without being told a link exists. What the shape carries is
adjusted, not extended — there is no username to report, and `admin` is false.

**Authorisation stays at the choke point.** `routes/media.ts` mounts `requireAuth` then `authorize`
across the `/media` prefix, and every media route inherits both. A link is read there, beside the
account, rather than on a parallel set of routes that would start out identical and drift.

**Rejected.** _A link as a hidden `users` row_, with no password and one album granted through
`user_albums`. Everything downstream would work untouched, which is a genuine and large saving, and
it fails on the half of the intent that shares **one photograph**: there is no album to grant, so
that case forks `authorize` anyway and the saving buys half a feature. It also puts a passwordless
row in the table the sign-in form reads, where "this can never be signed into by name" is a
property nothing enforces and the next feature over `users` silently includes.

_A signed token carrying the album and an expiry, with no row._ It is the shape the unsubscribe
links use and it costs no schema at all. Revoking it then means a revocation list, which is a
table, which is the thing the token was avoiding — the argument D11 already made against JWT, for
the same reason and with the same conclusion.

_A second album-visibility predicate beside `canSee`._ Two functions answering "may this caller see
this album" is how one of them gets updated alone. The link is asked what it covers; `canSee` is
not consulted, and is not taught about links.

**Consequences.** `sessions` gains what it needs to point at a link instead of an account, and
`plugins/auth.ts` stops assuming that a session without a configured account is a dead one.

`album_visits` cannot record a link opening: it is `WITHOUT ROWID`, keyed on
`(album_id, username, session_id, day)`, and a link has no username. That is the right outcome
rather than an obstacle, because what a link's history has to answer is a different question at a
different precision (D260825c).

Deleting a link closes the sessions it opened, for the reason changing a password does: the whole
point of revoking is that an already-open browser stops.

`comments.account` retains the access key used, so it retains the link instead when a link carried
the comment (D38). That is what lets moderation say which invitation delivered something, which is
the same job the column already had.
