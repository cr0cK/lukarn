# D13 — In-memory login throttling

**Context.** Slow down dictionary attacks without penalising a typing mistake.

**Decision.** An in-memory `Map`, keyed by `<ip>:<username>`, five unrestricted
attempts, then a delay that doubles up to 15 minutes; the entry is forgotten
after one hour without a failure.

**Rejected.** A counter in the database or in Redis. The application runs as a
single process and has only a few users: persistence would only add another
dependency. Also rejected: a fixed delay, which inconveniences genuine users
without discouraging a patient attacker.

**Consequences.** Counters are lost on restart — an attacker who caused a restart
would reset the counter, a much more costly scenario for them than waiting. The
key combines the IP and identifier: a distributed attack on a single account is
not throttled globally.
