# Specs

The specs of this repository, one file per spec code, follow the **spec delivery process** of the
`sdp` plugin: `sdp:spec` designs a spec and its plans, `sdp:approve` gates them and arbitrates the
outbox, `sdp:exec` implements the approved plans as stacked PRs, and `sdp:polish` runs live UI
polish passes. Each spec's delivery is recorded as stamps in its tracking issue.

Architectural trade-offs and rejected alternatives live alongside them in
[`../decisions/`](../decisions/README.md).

## Project settings

- **Owner**: `@cr0cK` (GitHub repository maintainer).
- **Releases**: Manual `v*` git tags built and published by `.github/workflows/release.yml`, which
  reads the matching `## [X.Y.Z]` section from `CHANGELOG.md`, runs `pnpm verify` and
  `pnpm test:e2e`, and publishes `ghcr.io/cr0ck/lukarn` (`linux/amd64`) and the GitHub Release.
  Each spec targets a minor version series (`v1.3`, `v1.4`, ...).
- **Commits and PR titles**: Conventional Commits in English (`CONTRIBUTING.md`); a spec PR is
  `docs:`, a plan PR is usually `feat:` (or `refactor:` / `chore:` when internal), and a fix PR
  is `fix:`. PRs are squash-merged. `feat`, `fix`, and `perf` commits update `## [Unreleased]` in
  `CHANGELOG.md` (enforced by `pnpm check:changelog`; non-observable `fix` or `perf` commits may
  opt out with `Changelog: none — <reason>`).
- **Checks**: `pnpm verify` (compiles `@lukarn/shared`, then runs `typecheck`, `lint`,
  `check:format`, `test`, `check:specs`, `check:links`, `check:prose`, `check:changelog`). Visible
  UI changes under `packages/web/src` also require `pnpm test:e2e` (Playwright Chromium desktop and
  WebKit phone against built `dist/`), and new screens or controls require coverage in
  `packages/e2e/specs/`; store inspection screenshots in `.playwright-cli/` or temporary scratch
  directories and never commit ad-hoc screenshots outside `assets/screenshots/`. Storage backend
  changes also require `pnpm test:storages` (MinIO, Apache `mod_dav`, and rclone via Docker). CI
  (`.github/workflows/verify.yml`) runs `verify` (Node 22 and 24), `e2e`, `storages`, and `image` on
  every `pull_request` to any base branch and on pushes to `main`.
- **Live stack**: `just demo` starts the API on `http://localhost:8080` and the Vite front end
  with HMR on `http://localhost:5173` against an isolated `.demo/` instance seeded with local
  media (sign in as `demo` / `demo1234`, stop with Ctrl+C, reset with `just demo-reset`).
- **Reviewers**:
  1. Codex read-only (`codex exec --sandbox read-only "<brief>" < /dev/null`)
  2. Claude Code read-only (`claude -p --permission-mode plan "<brief>" < /dev/null`)
  3. Fresh-context `sdp-reviewer` subagent fallback

## Specs

- [`GAL`](GAL.md) (`2026-08-02`): Gallery browsing, justified virtualised grid, day notes and
  locations, full-screen viewer, search, responsive shell, and PWA theme. Predates the process.
- [`STR`](STR.md) (`2026-08-02`): Read-only storage backends (Google Drive, local folder, S3,
  WebDAV), synchronisation, EXIF/MP4 indexing, disk cache, and media/video rendering. Predates the
  process.
- [`ACC`](ACC.md) (`2026-08-02`): Unified accounts and roles, password/OTP/invitation onboarding,
  device QR pairing, database sessions, throttling, and access-control invariants. Predates the
  process.
- [`SOC`](SOC.md) (`2026-08-03`): Verified commenter identities, partitioned comment threads,
  moderation, activity feed, per-user favourites, and email notifications/subscriptions. Predates
  the process.
- [`ADM`](ADM.md) (`2026-08-03`): Live administration console, branding and instance identity,
  bilingual interface catalogues, and user `/settings`. Predates the process.
- [`OPS`](OPS.md) (`2026-08-03`): Environment variables, container wiring, YAML bootstrap, Docker
  packaging, CLI scripts, and deployment/backup contracts. Predates the process.
- [`SHR`](SHR.md) (`2026-08-24`): Token-based share links (albums, selections, single photos),
  identity/comment gates, revocation/expiry lifecycle, and privacy-preserving visit telemetry.
  Predates the process.
