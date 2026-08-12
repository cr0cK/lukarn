# 06 — Configuration and deployment

Two configuration sources, two natures:

- **`.env`** — secrets and paths, read at startup, never hot-reloaded.
- **The database** — accounts, albums, permissions and settings, administered from
  `/admin`, applied without a restart. `config/albums.yaml` is only used to
  **bootstrap** a new installation.

## Environment variables — `packages/server/src/env.ts`

Zod schema; an invalid value prevents startup with a message that names
the variable and the problem.

Declaring a variable here does not make it configurable for that matter: under Docker, it
only reaches the process if the `environment:` block of `docker-compose.yml` passes it
through, or if the `Dockerfile` sets it. Compose does not propagate the host's
environment, and `.env` is only used for interpolation. `check:specs` therefore compares the
schema against these two files and fails on an omission, because it has already happened
without anything reporting it (D78).

| Variable                      | Default                                       | Role and consequence of an error                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                    | `development`                                 | `development` enables `pino-pretty`. Accepted values: `development`, `production`, `test`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `PORT`                        | `8080`                                        | Positive integer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `HOST`                        | `0.0.0.0`                                     | In a container, `127.0.0.1` would make the app unreachable from the host.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `PUBLIC_URL`                  | `http://localhost:8080`                       | Valid URL required. Trailing `/` are stripped. **Used for four things: building the OAuth redirect URI, deciding whether cookies are `secure`, deciding whether `Strict-Transport-Security` is set, and — in production — giving Caddy the domain it obtains a certificate for.** A wrong value breaks consent (`redirect_uri_mismatch`) or, with HTTPS misdeclared, prevents the cookie from coming back. The `Caddyfile` reads it directly (`{$PUBLIC_URL}`): the served domain and the declared domain therefore cannot diverge.                                                                                                                                                                                                                                                                                                                               |
| `APP_NAME`                    | `Photos`                                      | Instance name. It appears in the tab title, on the login screen, and above all **under the icon once the application is added to a home screen**. The server substitutes it at startup into `index.html` and into the manifest (`shell.ts`), so a restart is enough to change it — not a rebuild, which matters when a single image serves every installation. Preferably short: Android truncates beyond a dozen characters under the icon. Empty ⇒ refuses to start, so as not to display a nameless application.                                                                                                                                                                                                                                                                                                                                               |
| `SESSION_SECRET`              | —                                             | **Required**, ≥ 32 characters. Signs the cookies. Changing it logs everyone out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `TOKEN_KEY`                   | —                                             | **Required**, ≥ 32 characters. Encrypts the refresh token. Changing it makes the stored token unreadable: it is deleted and consent must be redone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GOOGLE_CLIENT_ID`            | absent                                        | Optional, but **inseparable** from `GOOGLE_CLIENT_SECRET`: setting only one causes startup to fail. Without both, the app runs and serves the existing index, and `/admin` shows "not configured".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `GOOGLE_CLIENT_SECRET`        | absent                                        | Same.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | absent                                        | Optional. Path to a service account's JSON key. When set, it **takes precedence** over `GOOGLE_CLIENT_*`: no more consent, no more refresh token, no more "Google hasn't verified this app" screen. Each album folder must then be shared for reading with the service account's address. A missing or malformed file **stops startup** rather than falling back to OAuth. See [04](./04-securite-et-acces.md) and D46.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `SMTP_URL`                    | absent                                        | Optional, **inseparable** from `MAIL_FROM`. Relay URL: `smtp://user:password@host:587` or `smtps://…` for implicit TLS. Checked at startup (`new URL`, `smtp`/`smtps` scheme, host present): a password containing an unencoded `/`, `?` or `#` cuts the address off in the middle of the credentials, and nodemailer would then build, without complaint, a transport to a host that is actually the username — the instance starts, and only fails on the first send. Absent ⇒ **comments are unavailable**: the address verification code cannot be sent, so no one can identify themselves. The interface says so instead of offering a doomed form. **The new-photos announcement doesn't go out either**, and the notifier then leaves everything untouched — the day a relay is configured, its first pass sets the marker without announcing the backlog. |
| `MAIL_FROM`                   | absent                                        | Sender of notifications, for example `Gallery <gallery@example.com>`. Many relays enforce an address they authorise — the one SPF and DKIM sign — and changing it to collect replies sends the messages to spam. The form is checked at startup (`Name <address>` or a bare `address`): an unclosed angle bracket would go straight into the header as is.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `MAIL_REPLY_TO`               | absent                                        | Optional, and independent of the previous two: address carried by the `Reply-To` header. A transactional relay has **no** inbox, and the sending domain doesn't necessarily have one either — replying to a notification then goes nowhere or bounces, without the instance knowing anything about it. Same form check as `MAIL_FROM`. If absent, no `Reply-To` is set and a reply follows `MAIL_FROM`: that's the right setting when that address receives its mail. If set without a relay, or naming the same address as `MAIL_FROM`, it is inoperative: startup **warns** without failing. See D81.                                                                                                                                                                                                                                                           |
| `GEOCODING_URL`               | `https://nominatim.openstreetmap.org`         | Root of the reverse-geocoding service, which gives a name to the photos' EXIF coordinates. **An empty string disables it**: days keep their clusters of positions, simply without a label, and the rest of the application is unchanged. A private Nominatim instance goes here. The `User-Agent` sent is derived from `PUBLIC_URL`, as required by the public instance's usage policy — which also caps requests at **one per second**, which the background pass respects (see [02](./02-architecture.md) and D48). An invalid URL stops startup rather than letting geocoding fail silently for months.                                                                                                                                                                                                                                                        |
| `CONFIG_PATH`                 | `./config/albums.yaml`                        | **Bootstrap** file, resolved from the `.env`'s directory, not from the cwd (see below). Absent ⇒ the server starts anyway; if there is no account in the database, it says how to create the first administrator.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `DATA_DIR`                    | `./data`                                      | Contains `nonni.db`. Created if missing. **The only irreplaceable data.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `CACHE_DIR`                   | `./cache`                                     | WebP derivatives at the root, prepared videos under `CACHE_DIR/video` — two stores, two budgets, two independent LRUs (D260809b). Regenerable, but not at the same cost: a few seconds of CPU per thumbnail, several minutes per video.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `WEB_DIR`                     | `packages/web/dist`, computed from the module | Built front end. Absent ⇒ only the API is served, with a warning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `LOG_LEVEL`                   | `info`                                        | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `UV_THREADPOOL_SIZE`          | `16`, set by the server if missing            | Size of libuv's thread pool, shared between image decoding, file reads and argon2. Node's default (4) makes an already-cached thumbnail wait behind a few renders — measured at 2 s at the 95th percentile (D32). A value present in the environment takes precedence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Derived, not configurable: `oauthRedirectUri = PUBLIC_URL + '/api/oauth/callback'`.

**Variables that come in pairs fail at startup if only one is
given** — `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` just like `SMTP_URL`/`MAIL_FROM`.
An instance configured with a relay but no sender would only show up
at the first comment posted, weeks after going live.

**Notifications never block a request.** Posting a comment
responds as soon as the row is written; emails then go out on a
serialised queue (`mail.ts`). A send failure is **logged and dropped**, with no
retry: a missed notification is a nuisance, whereas an unhandled rejection in a
background task would terminate the process — the same caution as for disk cache
eviction. `PUBLIC_URL` is used to build the emails' links: if misconfigured,
it produces notifications that lead nowhere.

**Three kinds of email leave an instance**: the address verification code,
the notification of a new comment, and the announcement of an album's new
photos. The latter is triggered by `main.ts`'s **hourly sweep**
(`notifier.ts`), not by the end of a sync: with a sync every
half hour writing in batches, adding two hundred photos would send about
ten emails in a day. An album is only announceable once its last
**successful** sync has been quiet for an hour; the delay between photos
arriving and the email is therefore one to two hours.

**The code email is the exception to the other two.** Its subject names the
host from `PUBLIC_URL` and **never the code** ([D65](./08-decisions/D65-le-sujet-du-mail-de-code-nomme-l-instance-pas-le-code.md)), and it carries
no clickable link: the host appears there as plain text only, because a link
would open a second session in another browser while the code is
expected in the tab that stayed open. The body recalls the action that triggered
the send — entering this address on this host — so the recipient
knows where the message came from without having to guess.

**Resolving relative paths.** `loadDotEnv()` (`src/dotenv.ts`) walks
up the tree from the cwd **then** from the module to find a `.env`, and
`loadEnv` takes that file's directory as the root for relative paths.
Useful consequence: a script launched from `packages/server` targets the same
files as the server launched from the root. A missing `.env` is not an
error — in a container, everything comes from the environment.

## `config/albums.yaml` — bootstrap only

Commented template in `config/albums.example.yaml`. The file is not tracked by
git. It is read by `packages/server/src/config.ts`, but **only as long
as no account exists in the database** (`bootstrap.ts`):

| Database  | File    | What happens                                                                                                      |
| --------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| empty     | present | Accounts, albums, permissions and settings are imported in a single transaction, then the file is no longer read. |
| empty     | absent  | The server starts, logs `pnpm create-admin <identifier>`, and the login screen displays it.                       |
| empty     | invalid | **Refuses to start**, with the validation error: starting without any account would be unusable.                  |
| populated | any     | The file is ignored. Editing it no longer does anything — `/admin` administers from here on.                      |

This is also the upgrade path for a running instance: on the first
startup after migrating, its configuration is picked up as is. No
reindexing, no new Google consent, no loss of access —
`packages/server/test/bootstrap.test.ts` locks this down.

The "empty database, no file" case needs a visible signal: the server
responds normally but refuses every login, which reads like an outage
when only a command is missing. `GET /api/auth/setup-state` — public,
since it's queried before any login — responds `{ needsSetup }`, and the
login screen then displays the command to run. It discloses nothing: on an
instance with no account there is nothing to protect, and it never says **who**
exists (`packages/server/test/setup-state.test.ts`).

The schema below is therefore frozen on whatever existing installations may have
written; changes to the configuration happen in `ConfigRepo` and
the administration API, not here.

### `users[]`

| Field          | Type    | Default | Constraint                                                                                         |
| -------------- | ------- | ------- | -------------------------------------------------------------------------------------------------- |
| `username`     | string  | —       | 1–64 characters, `^[a-z0-9][a-z0-9._-]*$` (case-insensitive). Duplicates rejected, including case. |
| `passwordHash` | string  | —       | Must start with `$argon2`. Produced by `pnpm hash-password`.                                       |
| `admin`        | boolean | `false` | Opens `/api/admin/*` and the OAuth callback. Grants **no** album in the process.                   |
| `albums`       | array   | `[]`    | Album ids, or `["*"]` for all. An unknown id fails loading.                                        |

### `albums[]`

| Field         | Type    | Default | Constraint                                                                                                                                                        |
| ------------- | ------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | string  | —       | Same format as `username`. Duplicates rejected. Used in URLs and as `album_id` in the database.                                                                   |
| `title`       | string  | —       | Non-empty. Displayed.                                                                                                                                             |
| `description` | string  | absent  | Optional.                                                                                                                                                         |
| `folderId`    | string  | —       | Non-empty. The segment after `/folders/` in the Drive URL — **not a path**, the Drive API only knows identifiers. Survives renames and moves.                     |
| `recursive`   | boolean | `true`  | Descend into subfolders. `false` indexes only the folder's root.                                                                                                  |
| `groupBy`     | string  | `month` | `month` or `day`: how the grid is split on opening. `day` suits a trip, and it's the only split where day notes are displayed. Editable afterwards from `/admin`. |

### `sync` and `cache`

| Field                  | Default | Effect                                                                    |
| ---------------------- | ------- | ------------------------------------------------------------------------- |
| `sync.intervalMinutes` | `30`    | Integer ≥ 0. `0` disables periodic resyncing; `/admin` remains available. |
| `sync.onStartup`       | `true`  | Sync every album at startup, without blocking HTTP listening.             |
| `cache.maxSizeGB`      | `20`    | Number > 0. Beyond it, LRU eviction down to 90% of the limit.             |

### Validation errors

Loading collects every zod error into a multi-line message prefixed
with the path (`users.1.albums.0: unknown album: "fantome"`). Three custom
checks go beyond the schema: duplicate album ids, duplicate identifiers
(case-insensitive), and reference to a non-existent album — almost always
a typo that would silently deprive someone of their access.

## Live administration

Everything happens through `/api/admin/*` (see [05](./05-api.md)), without a restart and
without a file. `POST /api/admin/reload` and `AppContext.reloadConfig()` disappeared
along with the file they used to reread.

| Change                     | Immediate effect                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Account, permissions, role | Reread on every request by `plugins/auth.ts` and `canSee()`.                                                       |
| Album created/deleted      | Deletion: its media and its `sync_state` go with it.                                                               |
| `folderId` changed         | The album's index is cleared and a resync starts if Drive is connected.                                            |
| `cacheMaxSizeGB`           | `MediaCache.setMaxBytes()`, with immediate eviction if the limit drops.                                            |
| `videoCacheMaxSizeGB`      | Same on the prepared-videos store, which has its own budget.                                                       |
| `syncIntervalMinutes`      | `startScheduler` rearms its timer; rearming at an unchanged value is avoided, since that would push the sync back. |
| `syncOnStartup`            | Only meaningful at startup — but it's read from the database, so it's picked up at the next one.                   |
| `prewarmCache`             | Reread for every photo by `media/prewarm.ts`: unchecking it stops the pass in progress, not just the next one.     |
| `transcodeVideos`          | Reread for every video by `media/transcode.ts`, the same way. No effect if `ffmpeg` is missing.                    |

## Dockerfile — three stages

`Dockerfile`, based on `node:24-slim`, pnpm via corepack.

1. **`builder`** — installs `python3 make g++` (needed if `better-sqlite3`,
   `argon2` or `sharp` have no prebuilt binary for the platform), copies
   **the manifests alone first** so Docker reuses the `pnpm install` cache
   as long as they don't change, then the sources, then `pnpm build`.
2. **`deps`** — the same install in `--prod`, without the sources: this is
   the `node_modules` tree the final image will embed.
3. **`runtime`** — no compiler, but `ffmpeg`. Copies `node_modules` and
   `packages/` from `deps`, then the three `dist/` from `builder`. Creates
   `/app/{data,cache,config}` and hands them to `node` **before** the
   volumes are mounted, otherwise they would belong to root. Runs as `USER node`.

**`ffmpeg` adds about 250 MB to the image**, and it's by far the
application's largest system dependency. It's the entry price for
HEVC video transcoding (D260809b), and it's stated outright rather than discovered
on the first `docker pull`. The alternative — an image without it, and a package to
install by hand — would hand every operator a step that nothing
flags until they have an HEVC video in their library.

Without `ffmpeg`, the server starts normally: it announces this in its log,
preparation stays inert, and the affected videos keep the message and the
**Download** button from D79.

`tini` as `ENTRYPOINT`: relays `SIGTERM` so that `main.ts`'s graceful shutdown
(closing the timers, the server and the database) actually triggers, and
reaps zombies. The `HEALTHCHECK` polls `/api/health` every 30 s.

The pnpm cache is mounted with `--mount=type=cache`, so it doesn't end up in the
image's layers.

The `runtime` stage carries the **OCI metadata**, including `image.source`: this
label is what links the published image to its repository on GHCR, without which the
package page shows neither README nor licence, and nothing connects a running container
to the code it runs. `version` and `revision` are passed as `ARG` by the
publishing workflow; a local build leaves them at `dev` and
`unknown`, which incidentally distinguishes a hand-built image from a published one.

## Two installation paths, one published image (D260811c)

`docker-compose.yml` references **`ghcr.io/cr0ck/nonni:${NONNI_VERSION:-latest}`**,
published by `.github/workflows/release.yml` on every `v*` tag, for `linux/amd64`
only. Updating therefore compiles nothing on the machine, and the
sizing drops from 2 vCPU / 4 GB to 1 vCPU / 1 GB — the 4 GB were only there
so the compilation of `sharp`, `argon2` and `better-sqlite3` wouldn't end up
killed by the OOM killer.

`docker-compose.build.yml` is the **override** that brings back `build:`:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
./deploy/deploy.sh --build      # identical, backup included
```

It's necessary outside `linux/amd64`, useful for trying out a local
change, and it's the answer for anyone who doesn't want to depend on a third-party
registry. The repository remains the source; the image is only a convenience. This
override rewrites `image:` to `nonni:local`: without it, compose would tag the local
build with the registry's name, and a `docker compose pull` would silently replace it.

`NONNI_VERSION` is not read by `env.ts` — it's a compose interpolation,
so `check:specs` doesn't watch it. It pins a version when an
update needs to stay a decision rather than a surprise.

## docker-compose and volumes

`docker-compose.yml` declares **two services**:

- **`app`** — the application. It publishes **no port on the host** (`expose`
  rather than `ports`): it's only reachable through compose's internal network.
  Nothing in the application listens on a public interface.
- **`caddy`** — `caddy:2-alpine`, the only one publishing 80, 443 and 443/udp. It terminates
  TLS, obtains and renews the Let's Encrypt certificate with no scheduled
  task, and relays to `app:8080`.

The `Caddyfile` is mounted read-only and fits in about ten lines.
Its site address is `{$PUBLIC_URL}`: the variable that builds the OAuth
redirect URI is also the one that decides the served domain, which removes
this application's most frequent source of divergence. It must therefore be
exactly `https://photos.example.com`, with no trailing `/` or port.

The `Caddyfile` sets **no security header**: they come from
`plugins/headers.ts` (see [04](./04-securite-et-acces.md)), so they also apply
in development and behind a replaced front end.

Two other settings live there, and they are the only ones: `request_body max_size
1MB`, which refuses the front end a body that `bodyLimit` would reject anyway,
and `flush_interval -1`, without which a video relayed with `Range` would be
buffered before being sent.

A proxy already present on the host can stand in for `caddy`: remove the service
and give `app` back a `ports: ['127.0.0.1:8080:8080']`.

`PUBLIC_URL`, `SESSION_SECRET` and `TOKEN_KEY` are declared with the
`${VAR:?message}` syntax: compose refuses to start if they're missing, with the message
saying what to do. The optional variables — `GOOGLE_SERVICE_ACCOUNT_FILE`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SMTP_URL`, `MAIL_FROM` — are
passed as `${VAR:-}`. **They must be, explicitly**: a variable
present in `.env` but absent from the `environment` block never reaches the
container, and the instance starts up simply announcing that comments
are unavailable or that Drive isn't configured — with nothing pointing to
the real cause.

`GOOGLE_SERVICE_ACCOUNT_FILE` designates a path **as seen by the server**:
`/app/config/…` under Docker, `./config/…` in development.

**All four volumes carry an explicit `name:`**, and this is a fix, not
a presentation detail. Without it, compose prefixes each volume with the
project's name — that of the working directory: `nonni-data` is actually called
`nonni_nonni-data`, or something else if it was cloned under another name.
And docker **silently creates** a named volume that doesn't exist: the backup
command in `README.md`, `docker run -v nonni-data:/data … tar czf`, would therefore mount
a fresh, empty volume and write an empty archive, without a word. A backup
that backs up nothing and doesn't say so is only discovered on
restore (D53). The explicit name makes these commands correct regardless of the
clone directory; migrating an already-running instance — copying
`<project>_nonni-data` to `nonni-data` **before** the first `up` — is described in
`deploy/README.md`.

| Mount                     | Contents                                                                                                             | Backup                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `./config:/app/config:ro` | Bootstrap `albums.yaml`, and the service account key if the instance uses one. Read-only: the app never writes here. | **Yes, if the key is there** — otherwise pointless after bootstrap                               |
| `./Caddyfile:ro`          | Front-end configuration                                                                                              | No — versioned in the repository                                                                 |
| `nonni-data`              | `nonni.db` — **accounts, albums, settings**, index, sessions, encrypted refresh token                                | **Yes. It's the only irreplaceable data.**                                                       |
| `nonni-cache`             | WebP derivatives                                                                                                     | No — regenerable on demand                                                                       |
| `caddy-data`              | Certificates and ACME account key                                                                                    | Desirable — otherwise reissued on every redeploy, and Let's Encrypt caps per domain and per week |
| `caddy-config`            | Caddy's internal state                                                                                               | No                                                                                               |

Backing up `nonni-data` alone isn't enough, for two distinct reasons. Without
`TOKEN_KEY`, the refresh token it contains is undecryptable: `.env` goes
along with it, then. And on an instance using a service account, Drive access lives
neither in the volume nor in `.env` but in `config/`, which Google doesn't reissue:
it goes along too. `backup.sh` takes all three. The full procedure —
stopping `app` so SQLite is at rest, `tar` of the volume, copying it off the
VPS — is in `deploy/README.md`, which addresses the installer.

Both services' logs are capped (`json-file`, 10 MB × 3).

## Hardening the machine

The repository carries the bootstrap for it: `deploy/cloud-init.yaml`, passed as "user data"
when the machine is created, sets up a Debian/Ubuntu system with a
key-only sudo `deploy` account, `PasswordAuthentication no`, `unattended-upgrades`
enabled without its interactive `dpkg-reconfigure`, Docker, `rclone`, Tailscale, and
`ufw` open on 22, 80, 443/tcp and 443/udp. Compose takes advantage of this:
the application publishes no port on the host, so there's nothing else to
open.

**The file assumes no hosting provider** (D63). Cloud-init is a _de
facto_ standard — a single open source implementation, which almost every
Linux cloud image ships, and which every major provider feeds under the name
"user data". Not a published standard: there is no RFC and no committee, and
exceptions exist (Fedora CoreOS and Flatcar use **Ignition**, Windows uses
**cloudbase-init**, and a minimal image may not ship the package). The
`deploy/README.md` names them and points to the manual procedure, rather than leaving
someone to wonder why nothing is happening.

`deploy/README.md` illustrates the operation with three different CLIs, in a
collapsed block presented on equal footing, precisely so that none reads as the
recommended path. The account is called `deploy`, not someone's first name: it's
a role, and a public repository doesn't create a system account under its author's name.

**Administrative access goes through Tailscale, and sequencing is the only
difficulty.** The file installs Tailscale but doesn't authenticate it:
`tailscale up` opens a URL to confirm in a browser, which is a human
action. Until that happens, SSH on the public IP is the only path
to the machine — closing it from the cloud-init would make it unreachable. So
port 22 stays open at bootstrap, and is closed by hand **after**
verifying `ssh deploy@<tailnet-name>` from a second terminal (`ufw delete allow
OpenSSH`, `PermitRootLogin no`, removing rule 22 from the upstream firewall, when
the provider offers one).
`disable_root: false` and `PermitRootLogin prohibit-password` keep the
key-only root account accessible during this interval; the provider's
serial console, outside the instance's network, is the last-resort safety net. All
of this is repeated at the top of `deploy/cloud-init.yaml` and in `deploy/README.md`:
it's the one place in the setup where a mistake costs a reinstall.

Tailscale requires no inbound opening — it goes out on UDP 41641 and
falls back to a DERP relay.

**The administration workstation must also be on the tailnet.** A tailnet
is only useful with at least two nodes: `ssh deploy@<tailnet-name>`, which becomes
the only door once 22 is closed, only resolves from a machine that has
itself joined the network. Cloud-init can do nothing about that side, and
it's the kind of omission that only shows up at the worst moment — right after
closing port 22. `deploy/README.md` therefore makes it § 0, before even
creating the machine.

**The machine has neither Node nor pnpm**, and this is deliberate: everything lives in
the image, pulled or built — there's no second runtime to keep up to date on the host. A
consequence worth remembering when documenting: the out-of-application
administration commands — `create-admin`, `reset-password` — have no
`pnpm` invocation on a server. They're launched inside the container, in their
compiled form (see "Scripts" below).

What stays outside the repository, because it depends on an account rather than
code: authenticating with the hosting provider, creating the tailnet **and
installing the Tailscale client on the administration workstation**,
the DNS `A`/`AAAA` record, and configuring the `rclone` remote for
backups.

## Deployment scripts — `deploy/`

Two bash scripts, run from the machine, which reposition themselves to the
repository root from `$0`.

| Script             | Effect                                                                                                                                                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/backup.sh` | `docker compose stop app`, `tar` of the `nonni-data` volume, restart, copy of `.env` and an archive of `config/` alongside, keeping the last 7 of each. Writes to `NONNI_BACKUP_DIR`, `./backups` by default. `--local` stops there; otherwise `rclone copy` to the remote from `NONNI_BACKUP_REMOTE`, `backups:nonni` by default. |
| `deploy/deploy.sh` | `git pull --ff-only`, `backup.sh --local`, then `docker compose pull app` and `up -d` — or `up -d --build` with the build override if `--build` is passed —, then **actively waits** for it to return to `healthy`. Failure ⇒ `docker compose logs --tail=50 app` and a non-zero exit code.                                        |

**Why `app` is stopped to back up.** SQLite runs in WAL mode: copying the
file during a write yields a database that needs recomposing. The stop lasts a few
seconds and makes the archive trivial to restore. Ruled out: a hot `db.backup()`,
correct but which would need triggering from outside the container, via a
route or a signal — more surface for a gain of a few seconds of
downtime per day.

**Why the script checks its own archive.** It refuses an archive that does
not contain `nonni.db`: this is exactly the symptom of the mis-named volume
above, and the only other moment it would show up would be the
restore. A **missing** `nonni-data` volume, by contrast, is a normal case —
a fresh install, nothing to back up — and the script exits 0, saying so.

**Why `deploy.sh` waits.** `docker compose up -d` returns as soon as the
container is launched, not when it's working: a failing migration or a
missing variable leaves a container restart-looping while everyone
thinks the deployment finished. The script relies on the image's `HEALTHCHECK`
and caps the wait at 150 s — a 20 s `start-period`, then three tries 30 s
apart before a container is declared `unhealthy`, plus a margin.

## Google Cloud-side configuration

In a **dedicated project**: the consent screen is unique per project and carries
the displayed name, the scopes and the publication status; housing several
applications there mixes them into the same authorisation request.

1. **APIs & Services → Library**: enable **Google Drive API**.
2. **OAuth consent screen**: type **External**, application name, support
   address.
3. **Publish the application.** An essential step: as long as it stays in
   "Testing" status, **Google expires the refresh token after 7 days**, and
   you have to reconnect every week. This is also one of the possible causes of
   the `invalid_grant` that `DriveService` detects (see
   [04](./04-securite-et-acces.md)).

   Publishing triggers no verification procedure unless it's requested:
   the application stays "published, unverified", capped at
   100 users. The only visible consequence: at the moment of consent, a
   "Google hasn't verified this app" screen, to get past via **Advanced
   settings → Go to**. Once only, and for the owner alone.
   (With Google Workspace, the "Internal" type avoids this screen; it isn't
   offered to `gmail.com` addresses.)

4. **Credentials → Create → OAuth client ID**, type **Web application**.
5. Under "Authorised redirect URIs", add **exactly** `PUBLIC_URL`
   followed by `/api/oauth/callback`. A single character of difference — `http` instead of
   `https`, a trailing `/`, an extra `www.` — produces a `redirect_uri_mismatch` at
   the moment of consent.

## Scripts

| Command                                          | Effect                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm create-admin <identifier> [password]`      | Creates the first administrator **in the database**, with the wildcard on albums — `admin` alone grants no album, and it does need to see the ones it's about to create. The only entry point when there's neither an account nor a bootstrap file. Refuses an identifier already taken. |
| `pnpm reset-password <identifier> [password]`    | Replaces an existing account's password and closes its open sessions. Handles the one case the application can't resolve on its own: the sole administrator has lost theirs and can no longer reach `/admin`. For any other account, go through `/admin`.                                |
| `pnpm hash-password`                             | Prompts for a password without displaying it and prints the `passwordHash:` line to paste. Only used to prepare a bootstrap `albums.yaml`. An argument is accepted but leaves a trace in the shell history.                                                                              |
| `pnpm --filter @nonni/server seed-demo [number]` | Fills the index **and** the cache with locally generated media, for working on the interface without a Drive account. Default: 240 per album.                                                                                                                                            |

`seed-demo` inserts into **every** album in the database and writes the five
cache variants (`t320`, `t640`, `t1280`, `full`, `hd`) so the pipeline never
tries to reach Drive. Two warnings: the **server must be restarted**
afterwards, since the cache is only inventoried at startup; and it must
not be run on a real instance — the next sync would remove these
entries, but they would pollute the albums in the meantime.

**These `pnpm` invocations assume a development workstation.** On a server
set up by `deploy/cloud-init.yaml`, there's no pnpm — only Docker. The
two commands that make sense in production are therefore launched in their
compiled form, the one `tsc` wrote to `dist/` and the `Dockerfile` copies
into the image:

```bash
docker compose exec app node packages/server/dist/scripts/create-admin.js <identifier>
docker compose exec app node packages/server/dist/scripts/reset-password.js <identifier>
```

`exec` requires `app` to be running; `docker compose run --rm app node …` does the
same before the first startup, which makes it possible to create the administrator
on a database that doesn't exist yet. Both go through a **process distinct**
from the server's, and that's what makes them safe: `ConfigRepo`'s in-memory
snapshot rebuilds on `PRAGMA data_version`, which only changes for
writes coming from elsewhere (see [03](./03-modele-de-donnees.md)).

`hash-password` has no container equivalent, and doesn't need one: it's
only used to prepare a bootstrap `albums.yaml`, which happens before
deployment.

## Checks

```bash
pnpm verify   # typecheck, lint, check:format, tests, check:specs, check:links
```

Server tests run with Node's native runner (`node --import tsx
--test`): no test framework among the dependencies.

`check:format` is a `prettier --check`: it flags what `pnpm format`
would rewrite. Without it, formatting wasn't checked anywhere and drifted — five
files on `main` had strayed from it (D75).

Two checks cover documentation, and neither judges the prose:
`tools/check-specs.mjs` compares what the code exposes to what the specs
mention; `tools/check-links.mjs` resolves the relative links and anchors
of the three documents that reference one another (D64). Both also run
on `pre-push`. External links are not followed: that would require the
network, and a check that fails because a third-party site is slow eventually gets
disabled.

`check-specs.mjs` also covers **decision consistency**: an
identifier defined twice, a file name that doesn't match its decision's
title, or a `(Dxx)` reference to a missing decision. `check-links.mjs`
can't see this last case — a `(D67)` in plain text isn't a link.

It likewise checks that a specs document **cited as text** between backticks
does in fact exist. A cited path is neither a link nor a decision reference:
it escaped both, and so survived a rename.

### Seeing emails for real

The tests verify what `buildCommentMail`, `buildAlbumUpdateMail` and
`buildVerificationMail` compose — subject, links, escaping. They say
nothing about rendering in a client, nor about the MIME encoding of accented characters, which
can only be seen after a send. A dummy relay is enough:

```bash
docker run -d --rm --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit
# then, in .env: SMTP_URL=smtp://localhost:1025 and MAIL_FROM=Gallery <gallery@example.com>
```

Mailpit accepts everything, relays nothing, and renders the messages at
`http://localhost:8025`. It's the only way to try emails without sending
mail to a real address, and without making a test depend on a remote
relay.
