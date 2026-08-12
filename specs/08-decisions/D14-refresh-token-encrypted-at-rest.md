# D14 — Refresh token encrypted at rest

**Context.** The token provides read access to the owner's entire Drive and is
stored in a SQLite file on a VPS.

**Decision.** AES-256-GCM, a key derived with scrypt from a salt generated for each
encryption, with `TOKEN_KEY` supplied by the environment and never written to
the database.

**Rejected.** Storing the token in plain text — a database dump would then be
enough. A random salt for each encryption also rules out the "key derived once
at startup" variant, which would make two encryptions of the same token
identical and reveal that it had not changed.

**Consequences.** Backing up `nonni-data` without the `.env` is useless: the
token would be impossible to decrypt. If `TOKEN_KEY` changes, the GCM tag fails,
the token is deleted and `/admin` displays "not connected" rather than looping
on an error.
