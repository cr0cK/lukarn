# D260817 — Verify compiles what it typechecks

**Context.** `@lukarn/shared` is private to the workspace and never published,
but it is consumed the way a published package is: its `exports` point at
`dist`, so `server`, `web` and `e2e` typecheck against generated declarations
rather than against its source. Something therefore has to compile it before
anything else reads it, and `pnpm verify` — the gate this repository asks
everyone to run before declaring work complete — did not.

CI knew. Both workflows carried a step of their own ahead of the gate, with a
comment explaining why:

```yaml
# `shared` has to be compiled before the other two typecheck: they import
# its declarations from `dist`.
- run: pnpm --filter @lukarn/shared build
- run: pnpm verify
```

**The gap only ever opens locally.** CI starts from a fresh clone with no
`dist` at all, so its prelude built one and the invariant held. A working copy
is the opposite: `dist` exists, from whenever it was last built, and nothing
notices it has fallen behind `src`. Adding `StorageKind` to
`packages/shared/src/index.ts` was enough — `pnpm verify` then reported
`TS2305: Module '@lukarn/shared' has no exported member 'StorageKind'` against
code that was correct, on a branch CI called green.

That is the failure worth naming: not a stale file, but a gate whose result
depends on state it neither produces nor checks, and which consequently
disagrees with CI. A green `verify` is supposed to mean a green pull request;
`CONTRIBUTING.md` says so in as many words. It was not true.

**Decision.** `verify` compiles `shared` before it typechecks anything, and the
prelude disappears from both workflows. The command is now self-contained: what
CI runs and what a developer runs are the same string again, and the ordering
rule has one home instead of three — the step in `verify.yml`, the step in
`release.yml`, and the sentence in `CLAUDE.md` each restated it.

The cost is one `tsc` over a package of types, under a second, on a command that
already spends minutes on tests.

**Not a just-in-time package.** The tidier answer for a package nobody
publishes is to drop the build entirely and point `exports` at
`src/index.ts`, letting each consumer compile it. It does not survive contact
with the container: `Dockerfile` copies `packages/shared/dist` into the runtime
stage, and the server runs compiled JavaScript under Node with no bundler in
sight, so a `.ts` entry point would be unreadable at runtime. `rootDir: src`
forbids the alternative of compiling shared's sources into the server's own
output. Reaching that shape means bundling the server — far more than an
ordering bug is worth.

**Not project references, yet.** `composite: true` with `tsc -b` is the answer
TypeScript itself offers: the compiler would own both the ordering and the
freshness, and the invariant would stop being written down anywhere. Two shapes
here have to be established first, not assumed — `web` typechecks under
`noEmit` with `moduleResolution: bundler` for Vite, and `e2e` reaches across the
package boundary into `../../server/src`. Both would need to hold under
`tsc -b`. That is a piece of work with a verdict of its own, and pretending to
know its outcome is how the prelude ended up copied twice in the first place.
