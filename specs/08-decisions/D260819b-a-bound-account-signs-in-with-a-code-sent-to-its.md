# D260819b — A bound account signs in with a code sent to its address and holds no password

**Context.** [D260819](./D260819-an-account-may-be-bound-to-a-person-rather-than-a.md)
binds an account to a person. What that account is entered with is a separate
question, and a password drags in the one thing [01](../01-vision-and-scope.md)
lists as out of scope beside registration: forgotten passwords. An instance run by
a family member is precisely the instance where nobody wants to be the reset desk,
and a reset flow is a token, an expiry, an email and a page, the whole surface the
project avoided by having the owner create accounts. Meanwhile the instance already
sends a code to an address and checks it back
([D39](./D39-the-address-is-verified-by-a-one-time-code.md): six digits, an HMAC,
fifteen minutes, five attempts, one send per minute).

**Decision.** A bound account signs in by entering a code sent to its address, and
the code machinery leaves `commenters` for a table of its own. D39 put those four
columns there when there was one thing to prove; a second use turns them into one
column set with two meanings, which is the shape that rots. What is left on
`commenters` is what a person is. The extraction also names what the two tables now
are: `users` carries authorisation, `commenters` carries identity, and a code is
neither.

`verification_codes` keys on `(target, purpose)`, so a code minted for one flow is
not found by the other rather than merely refused by it. Five attempts are per
code; **one send a minute is per address, across every purpose**, because
`commenters.code_sent_at` was one column per person and a per-row check would let an
identity code and an invitation reach the same inbox in the same minute. The
deadline belongs to the purpose: fifteen minutes for `signin` and `identity`, seven
days for `invite`, which has to survive somebody's weekend. Six digits stay
sufficient for the longer life for the reason D39 gives, since the five-attempt
ceiling bounds guessing rather than the lifetime.

**A bound account cannot be given a password.** Allowing both and letting each
account choose hands an administrator a way through the front door of an identity
they were forbidden to assert: set a password on a bound account, sign in, and the
session signs as that person. Losing access to the address is recovered by
unbinding, which closes the sessions and requires a password in the same request,
the administrator taking the account back and handing it over as a shared key, which
is what it has become. The refusal belongs to `ConfigRepo` rather than to the route:
`pnpm reset-password` writes through the same repository without passing any route,
and performs the unbind for a bound account.

`users.password_hash` is `NOT NULL` and stays that way, so "no password" is **one
reserved argon2 hash**. It is a constant rather than random bytes thrown away
because two rules have to recognise it: the last-admin count, which must know that
an account has no way in before letting the only working administrator step down,
and the account list, which shows an account nobody can enter. It is generated from
CSPRNG bytes whose preimage was destroyed, never by hashing a readable literal,
since a sentinel that is `argon2("NO_PASSWORD")` is a password that opens every
account holding it. `/auth/login` compares hashes without branching on it, so the
account with no password is not the one that answers faster, and `config.ts` refuses
this exact value from a bootstrap YAML.

**Rejected.** _A password with a reset flow_: the address is already verified and
already receives mail, so the reset was going to be a code sent to it. The code is
the credential and the reset disappears with the password. _A clickable link instead
of a code_: D39 rejected it for comment identity and the reason is stronger for
sign-in, since a link opens the session in whichever browser is the system default
rather than the one holding the screen open. _Keeping the code columns on
`commenters` with a purpose flag_: one pending code per address, so verifying an
address while signing in overwrites one with the other, and the fourth purpose this
design anticipates arrives with nowhere to sit. _A nullable `password_hash`_: SQLite
cannot relax `NOT NULL` in place, so it would mean rebuilding `users` to express
with a null what a reserved hash expresses without touching the schema. _Sign-in
through an external provider, now_: the obstacle is not the one usually assumed,
since `drive.readonly` is a restricted scope whose audit
[D46](./D46-a-service-account-to-stop-seeing-google-hasn-t-verified.md) avoids while
`openid email profile` is not restricted and carries no such audit. The obstacles
are that every self-hoster would still register a client of their own, and that 01
promises a visitor never sees a Google URL. If an external provider is ever wanted
the shape is **generic OIDC**, with Google one provider beside Authelia, Authentik
and Keycloak, binding a credential to an account that was invited rather than
creating one.

**Consequences.** These accounts **require SMTP**, as commenting already does. The
residual attack is social and no secret closes it: someone triggers a code to an
address and talks its holder into reading it out. The email therefore states what
the code grants in its subject and its first line, and the purposes are separated so
a code obtained for one cannot be spent on the other. Both messages live in the two
catalogues, English first
([D260812c](./D260812c-the-interface-is-translated-by-two-typed-catalogues.md)), and
the invitation goes out in the instance default language, since its recipient has
never made a request here to have one recorded
([D260812d](./D260812d-the-language-travels-in-accept-language-and-is.md)).

A **bootstrap `config/albums.yaml` cannot declare an invited account**: it carries
password hashes and runs before any mail could be sent, so it keeps creating shared
keys, which is what a fresh installation needs.

The invitation carries a link that pre-fills the address and carries no secret.
`PUBLIC_URL/login?email=<address>` lands on the code step with the field already
filled, and the six digits are still typed. That is the line between it and the
magic link rejected above: it authenticates nobody, and grants exactly what knowing
the instance exists grants. The address in it is the recipient's own and already
sits in the `To:` header of the message carrying it, and `Referrer-Policy:
no-referrer` keeps it out of any third party's logs. Opening it mints no code, or
reading the message would invalidate the code being read; the step offers to send
another instead.

**The two public routes say one thing only.** `/api/auth/code/request` answers `202`
for an address that opens an account, for one with an invitation waiting, for one
nothing here knows and for one asked again inside the minute, and
`/api/auth/code/verify` returns one refusal for unknown, mismatched, expired and
exhausted. `routes/identity.ts` tells its four apart and may keep doing so, because
`requireAuth` guards its prefix; that argument does not survive on a route anybody
can call.
