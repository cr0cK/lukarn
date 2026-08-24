# D39 — The address is verified by a one-time code

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** The identity in D38 is declarative: behind a shared password,
anyone can claim to be "Mamie". And declaring a third party's address would
make them receive notifications from a gallery where they had requested
nothing.

**Decision.** A six-digit code sent to the address and entered to attach the
identity to the session. Valid for fifteen minutes, five attempts, and at most
one send per minute. Only an HMAC of the code is stored.

**Rejected.** Trusting the declaration on the grounds that the circle is
already protected by a password. A shared password is precisely what circulates
more widely than intended, and guarding against this is cheap. Also rejected: a
clickable confirmation link rather than a code — it opens a second session in
the default browser, whereas a code can be copied into the tab left open.
Finally, hashing the code with argon2 was rejected as disproportionate for a
secret that lives for fifteen minutes, where an HMAC costs less than an SQL
query.

**Consequences.** **Without SMTP configured, nobody can comment**: no code can
be sent. This is consistent — without a sending server, notifications would not
be sent either — and the interface says so instead of offering a form destined
to fail. The five-attempt ceiling is what makes six digits sufficient; without
it, a million attempts would eventually succeed.
