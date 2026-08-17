# D260817c — The browser suite builds what it drives

**Context.** `packages/e2e` runs the **built** artefact: `fixtures/serve.ts`
spawns `packages/server/dist/main.js`, which serves `packages/web/dist`. That is
the point of the suite — it opens the page a visitor opens, not a dev server
approximating it (D260814g). Nothing in `pnpm test:e2e` built either directory.

Both workflows carried the step, with a comment explaining why:

```yaml
# The suite exercises `dist/`, not a dev server: `packages/server/dist`
# serving `packages/web/dist` is the artefact the image carries.
- run: pnpm build
- run: pnpm test:e2e
```

`CONTRIBUTING.md` carried it a third time, as `pnpm build && pnpm test:e2e` in
the block a contributor copies. `CLAUDE.md` carried the same instruction twice
without the build — "a change under `packages/web/src` is not finished until
`pnpm test:e2e` has also passed" — which is the sentence somebody follows.

**This is D260817 from the other side.** The gap opens only in a working copy: a
fresh clone has no `dist`, so CI's prelude built one and the invariant held. A
working copy has one, from whenever it was last built, and nothing notices it has
fallen behind. Where the stale `shared` at least failed loudly — `TS2305`, a
missing export — a stale `dist` here fails _plausibly_: the release branch for
1.2.0 ran the suite against a `dist` from the previous release and reported 29
failures across `admin.spec.ts` and `storage.spec.ts`, every one of them the
Storage section legitimately absent from a build that predated it. The failure
looked exactly like a regression the release had introduced. Nothing in the
output said which build was on the port.

A gate whose verdict depends on state it neither produces nor checks is worth
naming twice.

**Decision.** `test:e2e` builds before it drives:

```json
"test:e2e": "pnpm build && pnpm --filter @lukarn/e2e test:e2e"
```

`test:storages` gains the same treatment for the same reason at smaller scale —
it imports the server's sources, which read `@lukarn/shared` from `dist/`, so it
compiles `shared` and nothing else. Both preludes disappear from `verify.yml` and
from `release.yml`. What CI runs and what a contributor runs are one string
again, and the ordering rule has one home instead of four.

The cost is a Vite build and two `tsc` runs — under ten seconds against a suite
that spends two minutes seeding, and nothing at all in CI, where the build was
already happening a line earlier.

**Still outside `pnpm verify`.** Building is not what keeps the suite out of the
gate; downloading two browsers is (D260814g). That argument is untouched.

**Not a Playwright `globalSetup`.** Playwright offers the hook, and the build
would then run for anyone invoking `playwright test` directly. It also runs
**after** `webServer`, which is what starts the server the build is supposed to
produce — the ordering is backwards, and `webServer.command` already does the
one thing that must happen first, `prepareInstance()`. Putting a workspace build
inside a Playwright hook also hides it from the person reading `package.json` to
find out what a command does.

**Iterating on a spec without rebuilding** stays available, deliberately:
`pnpm --filter @lukarn/e2e test:e2e` is the escape hatch, and it is the honest
shape for one — explicit, scoped, and impossible to reach for by accident.
