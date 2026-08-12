# D9 — `wildcard: true` on `@fastify/static`

**Context.** Serving Vite bundles whose names contain a hash that changes with every
build.

**Decision.** A wildcard route.

**Rejected.** The default behaviour of `@fastify/static`, which **enumerates files on
startup and declares one route per file**. The list is fixed at startup: after a live
redeployment, a bundle with an unknown name would fall through to the 404 handler, then
to `index.html`, and the browser would receive HTML where it expects JavaScript — an
opaque MIME type error.

**Consequences.** The wildcard route also matches `/` to the root directory and refuses
to serve it (403). An exact `GET /` route, which takes precedence over the wildcard,
serves `index.html` (`app.ts`).
