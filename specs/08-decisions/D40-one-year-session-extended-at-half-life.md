# D40 — One-year session, extended at half-life

**Confidence.** observed — plugins/auth.ts, git ls-files → exit 0 · 2026-08-23

**Context.** The 30-day TTL required a shared password to be re-entered several
times a year for a family gallery visited irregularly. The request was "a
session that never ends".

**Decision.** One year, extended by a year once the session has passed its
half-life. In practice, users never get signed out as long as they use the
gallery.

**Rejected.** A session with no expiry. It is a permanent sign-in token — stolen
once, valid for life — and the `sessions` table would grow without anything
cleaning it up, as the hourly purge would have nothing left to purge. Also
rejected: the HTTP "session cookie", without `maxAge`, which does exactly the
opposite of what was requested because it dies when the browser closes.
Finally, pushing back the deadline on every request was rejected, as that would
mean one SQLite write per thumbnail; at half-life, it is one write per visitor
per six months.

**Consequences.** An abandoned session takes up to a year to disappear,
compared with one month previously. The immediate cut-off mechanisms remain the
same and matter all the more: deleting the account and changing the password
close sessions, and `plugins/auth.ts` rereads permissions on every request.
