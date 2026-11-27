---
code: OPS
status: done
version: v1.0
amended: [v1.1, v1.2]
created: 2026-08-03
---

# Lukarn — OPS specification

OPS covers environment configuration and container wiring, one-time YAML bootstrapping, single
container Docker packaging, operational CLI scripts, and production deployment and backup scripts.
It predates the spec delivery process, so it has no plans, and describes the application as it
stands.

## Environment variables and container wiring

- `packages/server/src/env.ts` validates all runtime environment variables at boot using Zod and
  fails startup with a clear error on invalid values or broken pairs.
- Every variable read by `env.ts` must be wired into the production container via `docker-compose.yml`
  (`environment:`) or fixed in `Dockerfile` (`ENV`), verified by `pnpm check:specs` (D78).
- Supported variables and defaults:
  - `NODE_ENV` (`development` | `production` | `test`, default `development`), `PORT` (`8080`),
    `HOST` (`0.0.0.0`), `LOG_LEVEL` (`info`).
  - `PUBLIC_URL` (default `http://localhost:8080`, trailing `/` stripped): sets OAuth redirect URI
    (`PUBLIC_URL + /api/oauth/callback`), cookie `Secure` flag, `Strict-Transport-Security`, and
    Caddy's TLS domain.
  - `APP_NAME` (default `Photos`): bootstrap seed for `instanceName` while no DB settings exist
    (D260813c).
  - `APP_VERSION` (default `dev`, set via `Dockerfile` build arg on release builds): displayed in UI;
    `dev` builds suppress update checks (D260815).
  - `UPDATE_CHECK_URL` (default GitHub releases API feed; empty string disables outbound update
    checks; cached 6 hours, queried only for admins via `GET /api/version`).
  - `DEFAULT_LOCALE` (default `en`): fallback language for unrecognised browsers and moderation
    emails.
  - `SESSION_SECRET` (required, ≥ 32 chars) and `TOKEN_KEY` (required, ≥ 32 chars).
  - `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET` (optional, must be set together).
  - `GOOGLE_SERVICE_ACCOUNT_FILE` (optional; takes precedence over OAuth; unreadable/invalid file
    aborts startup rather than falling back).
  - `SMTP_URL` & `MAIL_FROM` (optional, must be set together; validates `smtp://`/`smtps://` URL and
    email shape) and `MAIL_REPLY_TO` (optional independent `Reply-To` header; warns if set without
    relay).
  - `GEOCODING_URL` (default `https://nominatim.openstreetmap.org`; empty string disables outbound
    geocoding).
  - `STORAGE_LOCAL_ROOT` (default empty, disabling local folder storage until configured by the
    operator).
  - `CONFIG_PATH` (default `./config/albums.yaml`), `DATA_DIR` (default `./data`), `CACHE_DIR`
    (default `./cache`), `WEB_DIR` (default `packages/web/dist`), resolved relative to the
    discovered `.env` directory (`dotenv.ts`).
  - `UV_THREADPOOL_SIZE` (default `16`, set in `threadpool.ts` before any I/O initializes so cached
    reads do not stall behind sharp renders) (D32).

## Bootstrap configuration

- `CONFIG_PATH` (`config/albums.example.yaml` template) is imported in a single transaction by
  `bootstrap.ts` **only when zero accounts exist in SQLite**; once any account exists, the file is
  ignored permanently (D24).
- When zero accounts exist and no bootstrap file is present, `GET /api/auth/setup-state` returns
  `{ needsSetup: true }` and the login screen shows the CLI command to create the first admin.

## Container packaging, Compose, and updates

- `Dockerfile` uses a 3-stage `node:24-slim` build (`builder`, `deps`, `runtime`), installs `ffmpeg`
  and `tini`, runs as `USER node`, and exposes `/api/health` via `HEALTHCHECK`.
- `docker-compose.yml` (`name: lukarn`) runs two services: `app` (alias `lukarn`, no host ports)
  and `caddy` (`caddy:2-alpine`, TLS termination via `{$PUBLIC_URL}` and `flush_interval -1` for
  video `Range` streaming), with explicitly named volumes (`lukarn-data`, `lukarn-cache`,
  `caddy-data`, `caddy-config`) (D47, D53, D260811c, D260813e, D260817d).
- `docker-compose.build.yml` provides the local source build override (`lukarn:local`).
- Release workflow (`.github/workflows/release.yml`) triggers on `v*` tags, runs `pnpm verify` and
  `pnpm test:e2e`, extracts release notes from `CHANGELOG.md`, and publishes
  `ghcr.io/cr0ck/lukarn` (`linux/amd64`) (D260814g, D260817c).

## Operational CLI and deployment scripts

- Monorepo scripts: `pnpm create-admin <username>`, `pnpm reset-password <username>` (also
  revokes open sessions), `pnpm hash-password` (argon2id), and
  `pnpm --filter @lukarn/server seed-demo <count>` (generates local demo dataset without Drive;
  restart server to re-index `CACHE_DIR`).
- `deploy/cloud-init.yaml`, `deploy/deploy.sh`, and `deploy/backup.sh` provision hardened hosts,
  roll updates with health waiting, and stop `app` while archiving `lukarn-data` so SQLite is at
  rest alongside copies of `.env` and `config/`, preserving a downed container's stopped state
  (D63, D64, D260812, D260815e).
