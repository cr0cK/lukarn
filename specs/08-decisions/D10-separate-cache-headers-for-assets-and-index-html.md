# D10 — Separate cache headers for `/assets/` and `index.html`

**Confidence.** observed — packages/server/test/static.test.ts, git ls-files → exit 0 · 2026-08-23

**Context.** Both are served by the same static plugin.

**Decision.** `setHeaders` distinguishes them by the presence of `/assets/` in the path:
`public, max-age=31536000, immutable` for hashed bundles, **`no-cache` for
`index.html`**.

**Rejected.** A single `Cache-Control` value. A long duration would freeze the
application on an older version after each deployment, because `index.html` keeps the
same URL while referencing the current bundles. A short duration would reload immutable
bundles on every visit.

**Related consequences.** A missing file under `/assets/` returns **404 JSON**, not
`index.html`: it indicates an incomplete deployment, and returning HTML would cause a
MIME type error that would hide the real problem.
`packages/server/test/static.test.ts` locks in all three behaviours.
