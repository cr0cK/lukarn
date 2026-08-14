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

### The phone stops being a narrow desktop

The interface was a desktop layout degraded downwards: every control lived in a
top bar, out of reach of the thumb holding the device. It is now laid out from
the phone up, and **nothing changes above 768 px** — the desktop keeps its bar,
its side panel and its keyboard navigation.

- **A bottom tab bar** — Albums, Search, Activity, Account — carries what moves
  between pages, and the top bar keeps only what describes the page it is on.
  The bar retracts while scrolling down and returns on the first upward
  movement: 65 px permanently reserved was the largest single thing taking room
  from the photos.
- **Panels and menus arrive from the bottom edge.** A side panel that covered
  the screen from the top and a menu pinned to the upper right corner are now
  sheets, dismissed by the same drag that opens them, or by a tap on their grip.
  In the viewer, one sheet carries both: the photo's details at rest, the
  conversation and the technical data when pulled up.
- **The viewer opens on the photo**, without a header, arrows or caption over
  it. A tap brings them back, as in any phone gallery. What was written about
  the photo joins the album and the date at the top; the bottom carries the
  actions — information, comments, download.
- **Pinching a photo enlarges the photo.** Two fingers used to reach the
  browser's page zoom, which magnifies pixels already rendered; the gesture now
  requests the 4096 px variant, like every other way of zooming here.
- **Searching happens where the search button is**, in a sheet with the keyboard
  raised, instead of moving the focus to a field at the opposite end of the
  screen.
- **Administration is a list of sections** rather than six tabs scrolling
  sideways two at a time, and each setting is a row showing its current value,
  opening onto its field.
- **Touch targets are 48 px**, against the 36 px a cursor was aimed at, and text
  is 5 % larger — a phone is held further from the eye than a screen on a desk.

### Fixed

- **An installed application no longer draws under the notch or the home bar.**
  The interface declared `viewport-fit=cover` without reading a single
  `env(safe-area-inset-*)`, so the top row sat beneath the clock. On iOS the
  status bar was already excluded by choice, so what this returns there is the
  space above the home indicator.
- Opening a photo carries its thumbnail into place instead of cutting to a
  full-screen image, on browsers that support view transitions.

## [1.0.0] — 2026-08-13

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
- **Readable in English or French**, each reader choosing for themselves. Emails
  arrive in the language their recipient reads, recorded against the identity that
  subscribed.
- **Borders and outlines hold on engines older than Chromium 85**, the television
  browsers among them: the style sheet initialises its own variables for every
  engine rather than behind a feature detection none of them satisfy.

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
- **The gallery's name is a setting too**, and the album list's header carries it
  rather than the word "Albums".

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

[unreleased]: https://github.com/cr0cK/lukarn/compare/v1.0.0...main
[1.0.0]: https://github.com/cr0cK/lukarn/releases/tag/v1.0.0
