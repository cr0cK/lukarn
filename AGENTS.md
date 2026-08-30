# AGENTS.md

Self-hosted Google Drive photo viewer: pnpm monorepo (`shared`, `server`, `web`),
one container, with Fastify serving the API and the built front end.

The design is documented in [`specs/`](./specs/). Read
[`specs/README.md`](./specs/README.md) first; it gives the reading order for each
kind of task. By default: `specs/01-vision-and-scope.md` → `specs/02-architecture.md` →
`specs/08-decisions/`.

## Documentation update rule

**Every change to behaviour, the API, the data model, configuration or a
technical choice updates the corresponding spec in the same piece of work as the
code.** A spec deferred until "later" is never updated. A code change without a
spec change is not complete.

This rule is enforced by `pnpm check:specs`: it compares what the code exposes—declared
routes, environment variables, migrations, and modules—with what the specs describe,
and fails on any discrepancy. It runs in `pnpm verify`, in CI, and on `pre-push`.

It also verifies that every variable read by `packages/server/src/env.ts` actually reaches the
container—either passed through the `environment:` block in `docker-compose.yml`
or set by the `Dockerfile`. Compose does not forward host environment variables, and
`.env` is used only for interpolation. Any variable omitted from Compose or Dockerfile
cannot be configured in production (D78).

### Decision records

- **Format**: `specs/08-decisions/D<YYMMDD>-<slug>.md`. The identifier uses the decision date
  (`D260809`), followed by a letter (`b`, `c`) if multiple decisions occur on the same date (D260809).
  Legacy ordinals D1 to D99 are preserved (D260809).
- **Rule in force**: Each decision document reflects the current active rule in the present tense (D260822).
  When an architectural rule changes, rewrite the decision in place and document rejected alternatives.
- **One question, one decision**: When newer reasoning supersedes an older rule, fold the reasoning into
  the older decision file, delete the newer file, and update all citations across the codebase.
- **Title sweeps**: Renaming a decision or rewriting its title heading changes its stated rule. `pnpm check:specs`
  detects title changes, lists every citing `file:line` in `specs/` and citing source files (skipped if no citations exist),
  and demands a `Swept: Dxx — <what you checked>` line in the commit body (forcing the author to audit the full citation list).
- **Forward decisions**: Decisions decided ahead of code implementation carry the mandatory header marker:
  `**Not built yet.** Decided YYYY-MM-DD; no code implements this.` The PR implementing the feature removes this marker.
- **Backticked spec paths**: `pnpm check:specs` verifies that every spec document cited as text between backticks
  (`specs/05-api.md`, `specs/08-decisions/`) points to an existing file on disk (D260809d).

### Spec audits and validation

- **Factual accuracy**: The automated checks verify that a mention exists, not that it is accurate: `pnpm check:specs`
  catches a missing route or unmentioned module, but cannot detect a paragraph that became false. Ensuring factual
  accuracy across specs and code remains the author's responsibility.
- **Audit tool**: `/spec-sync` (`.claude/skills/spec-sync/`) audits `specs/01` through `specs/07` end-to-end
  against live code, correcting only false statements and citing `file:line` anchors (D260822b). It is run manually
  by hand (e.g. before releases) and is never invoked automatically.
- **Plans**: Multi-PR work in progress lives in `specs/09-plans/`. The PR that completes the work deletes the plan.
  A plan with all checkboxes ticked fails `pnpm check:specs`.
- **Public README alignment**: `README.md` must list every storage backend in `SUPPORTED_KINDS` and describe every
  tab in `ADMIN_TABS`.
- **Changelog verification**: `pnpm check:changelog` verifies that `CHANGELOG.md` reflects `feat`, `fix`,
  and `perf` commits under `## [Unreleased]`. Non-observable `fix` and `perf` commits may be excused with
  `Changelog: none — <reason>` in the commit body, but a `feat` commit always demands a changelog entry and
  can never be excused.
- **Link and prose integrity**: `pnpm check:links` validates all internal markdown links and section anchors.
  `pnpm check:prose` validates factual tone and em-dash budgets on public documents.
- **Escape hatch (`MODULES_TOLERES`)**: If `check:specs` reports a false positive for a trivial module documented
  by its role rather than file name, add it to `MODULES_TOLERES` in `tools/check-specs.mjs` with an explanatory comment.

### Change mapping table

| If you change…                                                                                                                               | Update…                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A visible user-facing feature or capability                                                                                                  | `CHANGELOG.md`, and `README.md` if it is a core capability                                              |
| `packages/server/src/routes/*.ts` (route, status code, payload)                                                                              | `specs/05-api.md`                                                                                       |
| `packages/shared/src/index.ts`                                                                                                               | `specs/05-api.md`, and `specs/03-data-model.md` if data model changes                                   |
| `packages/server/src/db.ts` (`MIGRATIONS`, indexes, pragmas)                                                                                 | `specs/03-data-model.md`                                                                                |
| `packages/server/src/repo.ts` (cursors, queries)                                                                                             | `specs/03-data-model.md`                                                                                |
| `packages/server/src/comments.ts` (threads, moderation)                                                                                      | `specs/03-data-model.md`, `specs/04-security-and-access.md`                                             |
| `packages/server/src/commenters.ts` (identities, code verification)                                                                          | `specs/03-data-model.md`, `specs/04-security-and-access.md`                                             |
| `packages/server/src/mail.ts` (transport, queue, composition)                                                                                | `specs/06-configuration-and-deployment.md`, and `specs/08-decisions/` if trade-off changes              |
| `packages/server/src/env.ts`, `packages/server/src/config.ts` or `packages/server/src/bootstrap.ts`                                          | `specs/06-configuration-and-deployment.md`, and `README.md` if startup requires it                      |
| `packages/server/src/config-repo.ts` (accounts, albums, settings)                                                                            | `specs/03-data-model.md`, `specs/04-security-and-access.md`                                             |
| `Dockerfile`, `docker-compose.yml`, volumes                                                                                                  | `specs/06-configuration-and-deployment.md`, and `README.md`                                             |
| `deploy/` (cloud-init, `deploy/backup.sh`, `deploy/deploy.sh`)                                                                               | `specs/06-configuration-and-deployment.md`, and `deploy/README.md`                                      |
| `packages/server/src/plugins/auth.ts`, `packages/server/src/sessions.ts`, `packages/server/src/crypto.ts`, `packages/server/src/throttle.ts` | `specs/04-security-and-access.md`                                                                       |
| `packages/server/src/storage/provider.ts` (the interface, an error)                                                                          | `specs/02-architecture.md` (storage interface), `specs/05-api.md`                                       |
| `packages/server/src/storage/connections.ts`, `packages/server/src/storage/registry.ts`                                                      | `specs/03-data-model.md`, `specs/04-security-and-access.md`, `specs/05-api.md`                          |
| `packages/server/src/storage/drive.ts`, `packages/server/src/sync/sync.ts`, `packages/server/src/sync/metadata.ts`                           | `specs/02-architecture.md` (sync flow)                                                                  |
| `packages/server/src/media/renderer.ts`, `packages/server/src/media/cache.ts`, `packages/server/src/media/range.ts`                          | `specs/02-architecture.md`, and `specs/08-decisions/` if trade-off changes                              |
| `packages/web/src/lib/justify.ts`, `packages/web/src/lib/useGridLayout.ts`, components                                                       | `specs/07-frontend.md`                                                                                  |
| `packages/e2e/` (a spec in `packages/e2e/specs/`, fixture, project)                                                                          | `specs/07-frontend.md`, and `specs/08-decisions/` if trade-off changes                                  |
| `packages/e2e/storages/` (container, backend, claim)                                                                                         | `specs/07-frontend.md`, and `specs/08-decisions/` if trade-off changes                                  |
| `packages/server/src/shell.ts` (instance name, shell, manifest)                                                                              | `specs/05-api.md`, `specs/07-frontend.md`                                                               |
| A message shown to a person (interface, HTTP, email, page)                                                                                   | Both `packages/web/src/lib/i18n/` or `packages/server/src/i18n/` catalogues, and `specs/07-frontend.md` |
| `packages/server/src/plugins/locale.ts`, `packages/server/src/i18n/`, `packages/web/src/lib/i18n/`                                           | `specs/05-api.md`, `specs/07-frontend.md`                                                               |
| `packages/web/src/styles.css` (`@theme` tokens)                                                                                              | `specs/07-frontend.md`                                                                                  |
| Accepted trade-off, rejected alternative or architectural rule                                                                               | `specs/08-decisions/` (new file or rewrite existing in place)                                           |
| Multi-PR work in progress                                                                                                                    | `specs/09-plans/` (deleted when merged)                                                                 |
| Product intent or feature proposal                                                                                                           | `specs/10-prds/` (written ahead of code)                                                                |
| Scope boundaries (features entering or leaving)                                                                                              | `specs/01-vision-and-scope.md`                                                                          |

### Documentation boundaries

| Document           | Primary Audience           | Scope                                                                                       |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------- |
| `README.md`        | Discovering the project    | Purpose, installation from published image, Drive setup, local development from source      |
| `deploy/README.md` | Server operators           | Production hosting on dedicated VM, domain, certificates, firewall, backups (D64, D260815e) |
| `specs/`           | Maintainers & contributors | Architecture, data model, security, wire formats, decisions, and rationale                  |
| `CONTRIBUTING.md`  | Patch contributors         | Contribution process, PR standards, and quality gates                                       |
| `SECURITY.md`      | Security researchers       | Vulnerability reporting procedure and disclosure policy                                     |

The root `README.md` stays short: what the application is, what it does, how to install it from the published
image, how to connect it to Drive, how to run it from source, and the link table. Everything assuming a machine of
its own (domain, certificate, firewall, backup) belongs in `deploy/README.md` beside the scripts that do it (D64, D260815e).
`CONTRIBUTING.md` instructs contributors on the same standards defined here; keep them aligned.

## Commands

```bash
pnpm install

pnpm --filter @lukarn/server dev      # API on port 8080 (tsx watch)
pnpm --filter @lukarn/web dev         # front end on port 5173, proxy /api to port 8080
pnpm dev                             # both in parallel

pnpm build                           # shared, then web, then server (order matters)
pnpm typecheck
pnpm lint                            # eslint .
pnpm format                          # prettier --write .
pnpm test                            # native Node runner, all packages
pnpm test:e2e                        # Playwright, built artefact in Chromium and WebKit
pnpm test:storages                   # storage backends against MinIO, Apache and rclone
pnpm check:format                    # prettier --check .
pnpm check:specs                     # verify documentation synchronization
pnpm check:links                     # verify internal links and anchors
pnpm check:changelog                 # verify CHANGELOG.md entries
pnpm check:prose                     # verify document prose register
pnpm verify                          # compile shared, then run full verification gate

just dev                             # run stack with pre-built shared dependencies
just demo [count]                    # run stack against seeded instance in .demo/
just demo-reset                      # reset demo instance
just admin <identifier>              # create initial administrator on ./data

pnpm create-admin <identifier>       # create initial administrator on empty database
pnpm reset-password <identifier>     # reset administrator password
pnpm hash-password                   # argon2id password hash utility
pnpm --filter @lukarn/server seed-demo 300   # generate demo dataset without Drive
```

The `just` recipes wrap the `pnpm` ones and handle prerequisites: `shared` built before imports,
`.env` carrying required secrets, and `.demo/` data isolation. `just` is a convenience shortcut: no CI check,
hook, or workflow depends on it.

### Quality gates

- **Verification Gate (`pnpm verify`)**: Compiles `packages/shared` first (D260817), then executes
  typechecks, linter, formatting checks (`pnpm check:format`), test suites, and all four documentation
  linters (`check:specs`, `check:links`, `check:prose`, `check:changelog`). CI runs the full verification
  gate, and `.githooks/pre-push` runs the four documentation linters to prevent documentation divergence.
  Must pass prior to commit/PR.
- **Frontend E2E Gate (`pnpm test:e2e`)**: A change under `packages/web/src` is not finished until `pnpm test:e2e`
  has passed, and a new screen or control is not finished until a spec in `packages/e2e/specs/` holds it to account.
  Builds the distribution (`dist/`) before driving Playwright on phone (WebKit) and desktop (Chromium) (D260817c).
  Runs in CI and `release.yml` rather than `verify` to avoid heavy local browser downloads on fast iterations (D260814g).
  First-time local test setup requires `pnpm exec playwright install chromium webkit`.
- **Reporting Gate**: Report work as complete only after quoting the green test runs (`pnpm verify` and `pnpm test:e2e` where applicable).

## Code conventions

- **Strict TypeScript**: Configured with `noUncheckedIndexedAccess`. Non-null assertions (`!`) are permitted
  only after checks the compiler cannot follow (e.g. validated Fastify route parameters, indexed access);
  `@typescript-eslint/no-non-null-assertion` is disabled for that reason.
- **Architecture & Contracts**: The API contract lives in `packages/shared`; the frontend consumes shared
  types and never redeclares response shapes locally.
- **Code Comments**: Comments explain _why_ non-obvious logic exists and what would break if changed,
  never restating _what_ the following line does.
- **JSDoc**: Exported functions, classes, and types include a concise sentence describing their role.
- **Testing**: Tests use the native Node test runner (`node:test`) and `node:assert/strict`. Tests validate
  invariants (isolation, migration reversibility, pagination uniqueness) rather than internal mock details.
- **Formatting**: Prettier with 100 column width, single quotes, and trailing commas (`pnpm format`, `pnpm check:format`).

## Language and internationalization

### Repository language

The repository is maintained in English (D260811b). Code, identifiers, comments, test names, logs, commit messages,
PR descriptions, and `specs/` are in English without exception.

- **Legacy French Identifiers**: A few existing identifiers (`titre` in `SearchBox`,
  `Mesure`/`valeur`/`unite`/`visiteur` in `VisitsSection`) predate the English rule.
  Preserve them; do not introduce new French identifiers.
- **Historical Commits Note**: PRs #1 to #11 were retitled in English, while original commit messages on `main`
  remain in French to preserve git commit hashes.

### User-facing text

Every human-facing string (UI labels, HTTP error messages, emails, unsubscribe pages) lives in a typed
translation catalogue (D260812c):

| Surface         | English Catalogue (Declarative Source)     | French Catalogue (Typed Target)            |
| --------------- | ------------------------------------------ | ------------------------------------------ |
| Web Interface   | `packages/web/src/lib/i18n/messages-en.ts` | `packages/web/src/lib/i18n/messages-fr.ts` |
| Server & Emails | `packages/server/src/i18n/messages-en.ts`  | `packages/server/src/i18n/messages-fr.ts`  |

- **Catalogues First**: English declares the catalogue keys; French is strictly typed against them.
  Never hardcode user-facing strings directly in components or route handlers.
- **Complete Messages**: Never assemble sentences dynamically from fragments (`${count}` followed by `"items"`),
  which prevents proper grammatical agreement in target languages.
- **Registers**:
  - Addressed communications (emails and landing pages from email links) address the reader (`you` in English, `vous` in French).
  - Unaddressed UI controls (buttons, field labels, hints) use impersonal forms (e.g. French infinitive: `Se connecter`, `Corriger l'adresse`).
- **Locale Threading**: Formatters accept the active translator `t` (e.g. `formatDate(iso, t)`). Email notifications
  are sent in the language registered on the commenter's session (D260812d).

## Documentation and pull request style

- **Factual Prose**: Plain, factual technical writing without promotional phrasing or filler.
  - Headings state what changed rather than evoking meaning (e.g. "Three new storage backends alongside Google Drive", not "Photographs no longer have to live in Google Drive").
  - Avoid denying the opposite: say what a thing is rather than what it is not (avoid "and nothing else", "not just", "never a photo").
  - Em dashes are rationed per public document (`README.md`, `CHANGELOG.md`, `deploy/README.md`, `CONTRIBUTING.md`, `SECURITY.md`) to prevent machine-generated density; reach for a comma, colon, or separate sentence. Enforced by `pnpm check:prose`.
- **Concise Pull Requests**: State the intent in one sentence, followed by the problem and the resolution.
  Lead with code/behavior changes (no "I" / "we"), and use collapsed `<details>` blocks for supplementary test runs and benchmarks.
- **Neutral Infrastructure**: Present required operational outcomes neutrally without promoting specific hosting
  vendors (D63).
- **System Accounts**: System services and deploy credentials use role names (`deploy`) rather than personal identifiers.
  Example identifiers in specs and tests remain unchanged.

## Key architectural invariants and pitfalls

- **Disk Cache Inventory**: The server indexes `CACHE_DIR` at startup (`MediaCache.load()`). Files placed
  in `CACHE_DIR` while the server is running remain invisible until restart.
- **App Shell & Manifest**: `index.html` and `manifest.webmanifest` are read and interpolated with `APP_NAME`
  once at startup (`packages/server/src/shell.ts`). Rebuilding the frontend while the standalone server is running
  leaves it serving old HTML pointing to deleted bundles (blank page); restart the server.
- **`PUBLIC_URL` Configuration**: `PUBLIC_URL` must exactly match the Google OAuth redirect URI
  (`PUBLIC_URL + /api/oauth/callback`). A trailing `/`, `http` instead of `https`, or an extra `www.` causes
  `redirect_uri_mismatch`. `PUBLIC_URL` also determines cookie `secure` flags.
- **Database Migrations**: Never modify an existing migration. Append new schema changes to `MIGRATIONS` in
  `packages/server/src/db.ts`.
- **UTC Timestamps**: Dates and EXIF `taken_at` values are stored and displayed in UTC (`packages/web/src/lib/format.ts`).
- **Authoritative Database State & Bootstrap**: SQLite is authoritative for accounts, albums, and settings.
  The bootstrap config file (`env.configPath`, see template `config/albums.example.yaml`) is read _only_ while no
  account exists in the database (initial bootstrap or first startup after upgrade); it is ignored thereafter.
  All runtime writes must go through `ConfigRepo`, which maintains an in-memory snapshot—a direct `UPDATE` on those
  tables in the same process would silently serve stale state. Writes from external processes (e.g. CLI tools) are
  safely detected via `PRAGMA data_version`.
- **Media Access Control**: Enforced via a prefix `preHandler` in `packages/server/src/routes/media.ts`. Every
  new media route inherits it automatically—do not mount it elsewhere.
- **Access Denials**: Unauthorized access to albums and media returns HTTP `404 Not Found` rather than `403 Forbidden`
  to avoid leaking resource existence. HTTP `403 Forbidden` is returned for `/api/admin/*` and when commenter
  identification is required (`identity_required`).
- **Synchronous SQLite**: `better-sqlite3` operations are synchronous. All database queries must remain indexed and bounded.
- **Threadpool Initialization**: `packages/server/src/threadpool.ts` must remain the first import in
  `packages/server/src/main.ts` to size the libuv threadpool before any I/O initializes (D32).
- **Throttled Image Decoding**: Sharp image decoding is throttled through `packages/server/src/media/semaphore.ts`
  to prevent memory spikes. Do not call sharp outside `MediaRenderer` without going through this limiter.
- **Monorepo Build Order**: Monorepo compilation order is strictly enforced: `shared` → `web` → `server`.
