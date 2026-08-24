# D260814g — A release is gated by a browser

**Confidence.** observed — env.ts, git ls-files → exit 0 · 2026-08-23

**Context.** Everything the repository checked before a release compiled the
front end and never loaded it. `pnpm verify` runs 522 unit tests, of which
nineteen belong to `packages/web`, and all nineteen cover extracted pure
functions — `justify`, `zoom`, `swipe-track`, `thumb`, the catalogues. Nothing
ever opened `index.html`. The `image` job proves the container boots and reports
healthy, which says the server answers, not that the page works.

The contents of 1.1.0 sat exactly in that gap. A bottom tab bar, sheets replacing
overlays, a viewer that opens bare, a pinch that fetches the 4096 px render,
safe-area insets, an administration rebuilt as rows: seven changelog entries, and
the only claim any machine made about them was that Vite had no complaints. Now
that a tag publishes an image to `ghcr.io` and moves `latest`, that is the gap
worth closing before tagging.

**Decision.** A browser suite — `packages/e2e` — drives the **built** artefact,
one spec per surface, and gates both CI and the release workflow. It asserts the
seven claims where they are observable: on the rendered page, on the geometry, on
the network request.

**Playwright rather than the native runner.** The repository's convention is
`node:test` with `node:assert/strict`, and it stands for unit tests. A browser
suite needs projects, viewports, device emulation, retries, traces and an HTML
report; reimplementing those over `node:test` would produce a worse Playwright
with no tests of its own. The deviation buys tooling, not expressiveness, which
is the only kind of deviation worth taking.

**Outside `pnpm verify`, deliberately.** The suite's script is `test:e2e`, not
`test`, so `pnpm -r test` does not reach it. `verify` runs on the 22/24 matrix
and on `pre-push`, and a gate that downloads two browsers is a gate people
bypass — the same argument that keeps formatting out of `pre-push` (D75). It runs
as its own CI job instead, and again in `release.yml` **before**
`docker/build-push-action`, next to the changelog extraction and for the reason
recorded there: everything that can refuse a release has to refuse it while there
is still nothing to take back.

**WebKit is in; Firefox is not.** Safe-area insets, pinch-to-zoom, view
transitions and `pointer: coarse` are iOS claims, and Chromium agreeing about
them proves nothing — it is not the engine anyone will read this gallery on from
a phone. Chromium covers the desktop project, which exists to prove the other
half of the promise: that nothing moved above 768 px. Firefox would be a third
engine to keep green for a platform this application makes no specific claim
about, and every added engine is added time on every pull request.

**The fixture builds an instance from nothing, through the server's own code.**
The fixture writes a `config/albums.yaml`, hashes its password with `argon2`,
then calls `loadEnv`, `openDb`, `ConfigRepo` and `bootstrapFromYaml` before
spawning `seed-demo`. A committed SQLite file with a tarball of renders would be
faster and worse: it would stop proving that a fresh installation works, it would
go stale on the next migration with nothing to say so, and the day it broke the
failure would read as a broken feature.

**Consequences.**

**The preparation lives in the `webServer` command, not in `globalSetup`.**
Playwright starts its web servers _before_ global setup, and `MediaCache.load()`
inventories the disk **at startup**: a cache filled after the server booted is a
cache the server cannot see. The order — write the config, bootstrap the
database, seed, then start — is the whole reason those steps share one command.

**The fixture reads the server's sources; only the artefact under test is the
build.** Pointing the fixture at `packages/server/dist` made a full build the
price of `pnpm typecheck`, and `verify.yml` builds `shared` alone — the suite's
typecheck failed on a clone that had every right to typecheck. What fills a
database before the server starts does not have to be the compiled copy; what
answers the browser does, and that is still `node dist/main.js`.

**Every variable `env.ts` reads is set explicitly, including the ones the
instance must not have.** `loadDotEnv` uses `process.loadEnvFile`, which never
overwrites a variable already present, so naming all twenty is what keeps a
developer's `.env` — their Drive credentials, their relay, their `DATA_DIR` — out
of the run. Omitting one would let it through, and the suite would pass or fail
by whose machine it ran on.

**An SMTP sink is required rather than convenient.** `commentsEnabled` is derived
from whether a relay is configured, so without one the interface never offers the
comment form at all; and the verification code cannot be read from the database
either, since `commenters.code_hash` holds an HMAC. Intercepting the message is
the only way through the identity flow. Seventy lines of `node:net` speaking four
commands is cheaper than a dependency, and it exposes what it captured over HTTP
because the worker that needs it is another process.

**No `data-testid` anywhere in production code.** The components already carry
proper ARIA — `nav[aria-label]`, `role="dialog"` with a name, buttons with
accessible names — so the suite locates by role, and a locator that breaks is a
label that changed for a person too. A test hook added to the application would
be a second contract to maintain, invisible to everyone but the tests.

**Safe areas are asserted on the rule, not on the computed value.** Neither
engine under Playwright has a notch, so `env(safe-area-inset-bottom)` resolves to
`0px` and a computed style cannot distinguish the correct rule from a deleted
one. The suite walks the stylesheet for the rule that matches the element, which
fails if the declaration goes away or is replaced by a hard-coded number.

**One worker, one instance.** Every spec shares one database, and comments are
written to it. Running files in parallel would make each other's assertions
depend on which finished first, and the suite is a minute and a half as it is.

**Rejected.** Screenshot comparison. It would catch everything, including every
intended change, and a suite whose failures are usually expected is a suite whose
failures stop being read.
