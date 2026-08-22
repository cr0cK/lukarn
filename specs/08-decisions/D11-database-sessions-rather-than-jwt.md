# D11 — Database sessions rather than JWT

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** Visitors must remain authenticated between requests.

**Decision.** An opaque identifier of 32 random bytes, a row in `sessions`, a
signed `httpOnly` cookie.

**Rejected.** A stateless JWT. It remains valid until it expires wherever it may
be: revoking someone's access — logout, removal from the configuration —
requires a revocation list, that is, a database table, which is exactly what the
JWT claimed to avoid. Here the session **is** the row, and deleting it is enough.

**Consequences.** One SQLite read per request, negligible in-process. In
addition, the `onRequest` hook checks each time that the account still exists
and reads its role again: the configuration is authoritative, not the cookie.
This allows permissions to be withdrawn without waiting for the
session to expire — the configuration then lived in `albums.yaml`; it has since
moved to the database (see D24), but the reasoning is unchanged.
