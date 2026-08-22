# D23 — Tests with Node's native test runner

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** Tests are needed, without adding tooling overhead.

**Decision.** `node --import tsx --test`, `node:assert/strict`, tests written in
French.

**Rejected.** Vitest or Jest: one more dependency, one more configuration, for
tests that need neither advanced mocking, nor a DOM, nor snapshots.

**Consequences.** Tests cover invariants rather than implementations: album
isolation, migration reversibility, no duplicates in pagination, LRU order,
`Range` parser tolerance, frontend serving. They document the expected behaviour
as much as they verify it.
