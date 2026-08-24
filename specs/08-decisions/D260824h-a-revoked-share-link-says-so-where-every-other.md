# D260824h — A revoked share link says so, where every other refusal returns 404

**Confidence.** stated — owner: Alexis Mineaud, /do-spec interview · 2026-08-24

**Context.** D12 answers a refused album or media item with 404 rather than 403,
so that nobody learns by probing that other people's albums exist. Carried over
without thought, that rule answers a revoked link with "page not found", which is
indistinguishable from a typing mistake for somebody who was legitimately sent
that link a month ago.

**Decision.** A share link that existed and no longer works says which of the two
happened: it was revoked, or its date has passed. A token that never existed still
returns 404, as does every other refusal in the application.

**Rejected.** One rule for everything, with a revoked link answering 404. It is
the smaller surface, and it sends the person whose access was cut to the
telephone to ask whether they mistyped something. Also rejected: a single message
covering both cases. "This link is no longer active" leaves the reader unsure
whether to ask for a new one, and the two states have different answers.

**Consequences.** This is D12's second deliberate exception, alongside
`/api/admin/*`. It leaks nothing D12 protects: the property is that a stranger
cannot discover what exists by guessing identifiers, and a stranger guessing a
token still meets 404. What the message tells its reader is what they already
knew, which is that this link was given to them and once worked.
