# D22 — A shared `AppContext` object

**Confidence.** observed — packages/server/test/access.test.ts, git ls-files → exit 0 · 2026-08-23

**Context.** Routes, synchronisation and the media pipeline need the same
services.

**Decision.** An `AppContext` class built once in `buildApp`, holding config,
database, repos, sessions, Drive, cache, renderer and syncer. Route factories
receive it as a parameter and instantiate nothing.

**Rejected.** A dependency injection container (oversized for eight services),
and Fastify decorators (which lose precise typing and scatter the assembly).

**Consequences.** Tests build a real context in a temporary directory and query
the application through `server.inject()`, without mocks — see
`packages/server/test/access.test.ts`. The config sits behind a getter, allowing
hot reload without rebuilding anything.
