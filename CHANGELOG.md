# Changelog

Notable changes, newest first. Versions follow [semantic versioning], and the
section matching a `v*` tag becomes the body of its
[GitHub release](https://github.com/cr0cK/lukarn/releases) — so these notes are
written once, reviewed in a pull request, and not rewritten in a web form
afterwards.

For an instance in service, **read the migration notes before updating.** Nothing
in this application migrates volumes or renames files on its own.

[semantic versioning]: https://semver.org

## [Unreleased]

### An identity of its own, and one each instance can change

- **The Lukarn mark** — a rounded black square, a white `L`, and a dot standing
  for both the lucarne and the lens — on the sign-in screen, in the top bar, as
  the browser tab icon, on a home screen and at the head of every email. It is
  drawn as source rather than exported, so it can be recoloured.
- **The gallery's colour is a setting.** One colour in `/admin` → Identity, and
  the buttons, the selected section, the focus outline and the mark's dot follow,
  along with a softer tint derived from it for hovered rows. It applies without
  a reload and without a restart.
- **The logo can be replaced** with an image of your own, from the same screen.
  Whatever you upload is converted to a PNG on arrival, and every size a phone or
  a mail client asks for is generated from it.
- **The gallery's name is a setting too**, and the album list's header now carries
  it rather than the word "Albums".

### Migration notes

- **`APP_NAME` becomes a bootstrap value.** An instance in service keeps its name:
  the variable seeds the new setting on the first start after updating, and is
  ignored from then on. Rename from `/admin` → Identity afterwards; editing the
  `.env` will no longer change anything.
- **The accent colour changes from blue to red** on any instance that has never
  chosen one — that red is the default identity, not a fixed choice. Set the old
  `#7aa2ff`, or any other colour, in `/admin` → Identity.
- Nothing to do about the backup: the uploaded logo lives in `DATA_DIR`, which is
  already archived whole.
- **The containers are renamed** to `lukarn-app-1` and `lukarn-caddy-1`. Compose
  used to name them after the clone directory; it now names the project itself.
  The first deployment recreates both, which costs the seconds `deploy.sh`
  already spends on its health gate. No volume is touched, so nothing is lost —
  the certificates included.

### Fixed

- **Borders, dividers and outlines were absent on browsers older than
  Chromium 85.** Tailwind's initialisation of its own variables sits behind a
  detection written for Safari and Firefox, so on any other engine without
  `@property` the values were never set and `border-style` fell back to `none`.
  The build now applies them to every engine.

## [1.0.0] — 2026-08-11

First published release. The application has been running in production for
several months; this is the point at which it becomes something someone else can
install.

### The gallery

- **Photos and videos from a Google Drive account** — JPEG, PNG, WebP, HEIC, MP4,
  MOV — in a justified grid grouped by month or by day, with a keyboard-driven
  fullscreen viewer. Drive is only ever read: the requested scope is read-only.
- **The index lives in SQLite**, fed by a walk of the Drive folders, so the grid
  is read locally with no network latency and no quota consumption. Nothing is
  downloaded while indexing — `files.list` already returns dimensions and EXIF —
  which makes syncing several thousand photos near-instant.
- **Layout computed before any image loads**, dimensions being known in advance:
  no reflow, and virtualisation holds a few dozen DOM nodes on a 10,000-photo
  album.
- **EXIF** — capture date, camera, lens, aperture, shutter speed, ISO, position —
  with chronological ordering on the real capture date. A day can carry a note and
  a place, the latter derived from coordinates through an optional reverse
  geocoder.
- **Videos stream without transcoding**: `Range` requests are relayed to Drive as
  they come, which gives native seeking at no CPU cost. The exception is a codec
  no browser decodes, prepared with ffmpeg and never larger than the original.
- **Installable on a phone.** Added to the home screen it opens full-screen, with
  no address bar and no password to type again. The service worker caches the
  application shell only — never a photo, never an API response.

### Sharing and comments

- **Accounts, albums and rights administered from `/admin`**, with no file to edit
  and no restart. There is no sign-up: the owner creates the accounts.
- **Per-photo comments** with one level of reply. A credential may be shared by a
  whole household, so the writer declares a name and an address at write time, and
  a code received by email confirms it. Administrators hide and restore comments
  from a moderation queue.
- **Email notifications** for new comments, replies and an album's new photos,
  each carrying an unsubscribe link.
- **An activity feed** per album, because a conversation nobody stumbles upon is a
  conversation nobody has.
- **Device pairing** for a television or a tablet, by code rather than by typing a
  password on a remote control.

### Security

- Passwords hashed with argon2id, login attempts slowed by a progressive backoff.
- Sessions in the database, revocable immediately, behind a signed `httpOnly`
  cookie.
- Every media request checks entitlement to an album containing it. **A denied
  access answers 404, never 403**: the existence of what you cannot see is not
  observable.
- The Google refresh token encrypted with AES-256-GCM under a key derived from
  `TOKEN_KEY`, which is absent from the database.
- Security headers — CSP with `script-src 'self'` included — set by the
  application rather than the proxy, so they hold in development and behind an
  unconfigured front end as well.
- **No Google URL ever reaches the browser.** Every photo is served through the
  server, thumbnails generated as WebP and cached on disk with LRU eviction.

### Operating it

- **One container in production**, Fastify serving both the API and the built
  front end, with Caddy in front for TLS.
- **A published image**, `ghcr.io/cr0ck/lukarn`, so updating compiles nothing on
  the machine. Building from source stays a first-class path, one overlay file
  away, for a host that is not `linux/amd64` or anyone who would rather not depend
  on a registry.
- `deploy/backup.sh` archives the data volume, its `.env` and `config/`, verifies
  its own archive actually contains the database, keeps the last seven, and ships
  them off-machine through rclone.
- `deploy/deploy.sh` backs up, updates, and **waits for `/api/health`** to confirm
  the application came back — a `docker compose up -d` returns when the container
  starts, not when it works.

### Notes for an instance running the pre-1.0 code

The project was called `googledrive-viewer`, and its volumes, database file,
cookies and browser keys carried a `gdv` prefix. **They do not rename themselves.**

- **Before the first `docker compose up`**, copy `gdv-data` to `lukarn-data` and
  rename `gdv.db` inside it — the exact commands are in
  [`deploy/README.md`](./deploy/README.md#backup). Skipping this starts the
  application on an empty database, accounts and index included.
- **Everyone signs in once more**: the session cookie changed name, so open
  sessions stop being recognised. The rows in the database survive.
- **Read markers restart from zero**, living in the browser under a renamed key.
  Comments already read announce themselves as new, once.
- Backup archives already on disk keep their `gdv-` prefix, which pruning no
  longer recognises. Delete them by hand once a `lukarn-` archive has restored
  successfully.
- **Backups are written to `backups/`**, not `sauvegardes/`, and the default
  rclone remote is `backups:lukarn`. Rename both, or keep the old ones by setting
  `LUKARN_BACKUP_DIR` and `LUKARN_BACKUP_REMOTE`. Pruning only looks in the
  directory it is given.
- The SSH hardening file laid down by `cloud-init.yaml` is now
  `99-hardening.conf`. Machines already bootstrapped keep
  `99-durcissement.conf`, and there is nothing to migrate — the rename only
  applies to machines created afterwards.

[unreleased]: https://github.com/cr0cK/lukarn/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/cr0cK/lukarn/releases/tag/v1.0.0
