# D29 — Login throttling operates along three axes

**Confidence.** observed — main.ts, git ls-files → exit 0 · 2026-08-23

**Context.** D13 had chosen a single `<ip>:<username>` key, accepting that a
distributed attack or username sweep would not be slowed down. This limitation
is more costly than estimated: each rejected attempt triggers a deliberately slow
argon2 check. An address trying thousands of random usernames only creates
counters with one attempt — no penalty, just as much CPU consumed, and a `Map`
that grows without bound.

**Decision.** Three counters per failure — IP/username pair (5 free attempts),
username alone (10), IP alone (20) — with the longest block taking precedence.
The same doubling scale applies beyond that. The table is capped at 20,000
entries and pruned hourly by the cleanup in `main.ts`.

**Rejected.** A global cap on attempts per minute: it turns a sweep into a denial
of service against legitimate visitors. Also rejected: clearing the IP counter
after a successful login — an attacker with an account on the instance could use
it to reset their budget between bursts; only the `couple` and `identifiant`
counters are cleared.

**Consequences.** A shared IP (corporate NAT, VPN exit) can slow several visitors
at once — hence the 20 free attempts on this axis, four times the pair's quota.
`trustProxy: true` becomes genuinely critical: without it, `request.ip` is the
reverse proxy's address and the IP axis would block the entire instance. An
attack where every attempt changes both address and username remains beyond the
reach of the three axes; that is not the threat model of a self-hosted family
gallery.
