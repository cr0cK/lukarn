<img src="./assets/lukarn-logo.svg" alt="Lukarn" width="320">

[![verify](https://github.com/cr0cK/lukarn/actions/workflows/verify.yml/badge.svg)](https://github.com/cr0cK/lukarn/actions/workflows/verify.yml)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](./LICENSE)

A self-hosted gallery for browsing the photos and videos of a Google Drive
account, in place of Drive's own preview: justified grid grouped by month,
keyboard-driven fullscreen viewer, dark theme.

_Lukarn_ is Gothic for a lantern — the thing you pick up to go and look in the
dark. It is also the word the linguists put forward, next to Irish _luacharn_,
when they argued that French _lucarne_ came from Latin _lucerna_: the small
opening in a roof that lets the light in and lets you see inside. Either reading
suits an application whose whole job is to open one window onto photos that
would otherwise stay in the dark of someone else's Drive.

The mark keeps both readings. Its dot sits high and to the right — where a
dormer sits in a roof, and where the shutter release sits under a thumb: the
opening that lets the light in is also the lens it came through.

Access is by username and password, and a credential can be handed to several
people; each person then declares a name and an address in order to comment.
From `/admin`, the owner declares which Drive folders become albums and who may
open them — enough to share one album without exposing the rest of the Drive.

| Where to go                 |                                                                                |
| --------------------------- | ------------------------------------------------------------------------------ |
| Run it locally              | [Below](#run-it-locally)                                                       |
| Connect it to a Drive       | [`deploy/README.md`](./deploy/README.md#3-give-the-server-access-to-the-drive) |
| Deploy and operate a server | [`deploy/README.md`](./deploy/README.md)                                       |
| Understand how it is built  | [`specs/README.md`](./specs/README.md)                                         |
| Contribute                  | [`CONTRIBUTING.md`](./CONTRIBUTING.md)                                         |
| Report a vulnerability      | [`SECURITY.md`](./SECURITY.md)                                                 |
| See what changed            | [`CHANGELOG.md`](./CHANGELOG.md)                                               |

## Two authentications, not to be confused

|                         | Who           | When                  | What it opens                  |
| ----------------------- | ------------- | --------------------- | ------------------------------ |
| **Access to the Drive** | The owner     | Once, at install time | The photos the server may read |
| **Username / password** | Every visitor | Every session         | The albums assigned to them    |

Visitors never see Google and need no Google account. The application holds a
single credential — the owner's — and serves every photo through it.

### Giving the server access to a Drive

Two ways, and the choice is worth the thirty seconds because they age
differently.

A **service account** — the one to prefer — is a Google identity that owns
nothing. You create one in the Google Cloud console, download its JSON key once,
and then share album folders with its address the way you would share them with a
person. No consent screen, nothing to renew, and the server never sees more of
the Drive than the folders handed to it. The cost is one share per new album.

**OAuth** connects the owner's own Google account instead. Nothing to share per
album, but it grants read access to the **whole** Drive, shows Google's "hasn't
verified this app" screen at every consent, and the refresh token expires after
six months of inactivity.

Both, step by step — creating the project, enabling the Drive API, the key, the
share and the trap that turns a forgotten folder into a silently empty album:
[**Give the server access to the Drive**](./deploy/README.md#3-give-the-server-access-to-the-drive).

## What it does

- **Photos and videos**: JPEG, PNG, WebP, HEIC, MP4, MOV. Videos stream with
  native seeking, without transcoding.
- **Accounts and albums administered from the application**, with per-user
  rights, no restart and no file to edit. No sign-up: the owner creates the
  accounts.
- **EXIF**: capture date, camera, lens, aperture, shutter speed, ISO,
  geolocation. Chronological ordering on the real capture date. A day can carry a
  note and a place, the latter derived from coordinates.
- **Per-photo comments**, with one level of reply. Since a credential may be
  shared by a whole household, the writer declares a name and an address at write
  time, and a code received by email confirms it. Administrators can hide and
  restore comments from `/admin`.
- **Email notifications** for new comments, replies, and an album's new photos.
  Every message carries an unsubscribe link.
- **Installable on a phone**: added to the home screen, it opens full-screen
  with no address bar and no password to type again. The service worker caches
  the application shell only — never a photo, never an API response.
- **Everything goes through the server**: no Google URL is ever exposed to the
  browser. Thumbnails are generated as WebP and cached on disk.

Drive is only ever read: the requested scope is read-only.

### Keyboard shortcuts

|                |                                     |
| -------------- | ----------------------------------- |
| `← ↑ ↓ →`      | Move around the grid                |
| `Enter`        | Open fullscreen                     |
| `Home` / `End` | First / last photo                  |
| `←` `→`        | Previous / next photo in the viewer |
| `Esc`          | Close                               |
| `F`            | Fullscreen                          |
| `I`            | Information and EXIF                |
| `C`            | Comments                            |
| `D`            | Download the original               |
| `Z`            | Zoom                                |
| `Space`        | Play / pause video                  |
| Swipe          | Previous / next photo, by finger    |
| `?`            | Show this list                      |

## Run it locally

For development, or to see the application running without a server, a domain
name or a Google account. Node ≥ 22 and pnpm are all that is needed.

```bash
pnpm install
pnpm --filter @lukarn/shared build   # before anything else — see below
```

**Building `shared` is not optional.** `@lukarn/shared` is exposed through its
`dist/`, not through its sources: on a fresh clone, `pnpm dev` and
`pnpm create-admin` both fail with
`ERR_MODULE_NOT_FOUND … @lukarn/shared/dist/index.js` until it has been built. It is
the same reason the full `pnpm build` imposes the order `shared` → `web` →
`server`.

Then the `.env`, which is required even locally:

```bash
cp .env.example .env
openssl rand -hex 32   # → SESSION_SECRET
openssl rand -hex 32   # → TOKEN_KEY
```

The server refuses to start without those two secrets. The rest of the file can
stay as it is: the default `PUBLIC_URL` (`http://localhost:8080`) suits
development, and without Google credentials the application starts and simply
reports that Drive is not configured.

```bash
pnpm create-admin alice   # first account, password prompted
pnpm dev                  # API on :8080, front on :5173 (proxying /api)
```

**Without a Drive account**, a demo dataset fills the index and the cache with
locally generated media:

```bash
pnpm --filter @lukarn/server seed-demo 300
```

Restart the server afterwards: the disk cache is inventoried only at startup, so
the thumbnails `seed-demo` has just written are invisible to it until then.

Before proposing a change:

```bash
pnpm verify   # typecheck, lint, tests, and the spec drift check
```

## Architecture

pnpm monorepo, a single container in production — the Fastify server serves both
the API and the built front end.

```
packages/
├─ shared/   Types shared between the API and the front end
├─ server/   Fastify · SQLite · Google Drive · image cache
└─ web/      React · Vite · Tailwind
```

A few choices that explain the rest:

- **The index lives in SQLite**, fed by a walk of the Drive folders. The grid is
  therefore read locally, with no network latency and no quota consumption.
- **Nothing is downloaded during indexing**: `files.list` already returns
  dimensions and EXIF data, which makes syncing an album of several thousand
  photos near-instant.
- **Because dimensions are known in advance**, the grid computes its layout
  before any image loads: no reflow, and virtualisation keeps a few dozen DOM
  nodes even on a 10,000-photo album.
- **Thumbnails are cached on disk** with LRU eviction. Concurrent renders of the
  same image are deduplicated, so an opening grid triggers exactly one download
  per file.
- **Videos are not transcoded**: `Range` requests are relayed as-is to Drive,
  which gives native seeking at zero CPU cost.

Design documents live in [`specs/`](./specs/), which explain **why** it is built
this way. Start with [`specs/README.md`](./specs/README.md).

## Security

- Passwords hashed with argon2id; login attempts rate-limited with progressive
  backoff.
- Sessions in the database, revocable immediately, signed `httpOnly` cookie.
- Every media access checks that the user is entitled to an album containing it.
  A forbidden album answers 404, never 403: its existence is not observable.
- Google refresh token encrypted with AES-256-GCM using a key derived from
  `TOKEN_KEY`, which is absent from the database.
- OAuth consent protected by an anti-CSRF `state` and restricted to
  administrators.
- **Security headers on every response** — CSP with `script-src 'self'`, so a
  `<script>` slipped into an album title or a comment does not execute, plus
  `nosniff`, `frame-ancestors 'none'`, `no-referrer`, and HSTS as soon as
  `PUBLIC_URL` is `https`. They come from the application, not the proxy, so they
  hold in development and behind an unconfigured front end as well.
- **Only the front end is reachable.** The application publishes no port on the
  host. `X-Forwarded-For` is trusted only when it comes from a private network;
  otherwise a client would forge its own on every attempt and never be slowed by
  the login backoff.

Details in [`specs/04`](./specs/04-security-and-access.md). Found a hole? Please
report it privately — [`SECURITY.md`](./SECURITY.md) says how, and what counts.

## License

[AGPL-3.0-only](./LICENSE) — Copyright (C) 2026 Alexis Mineaud.

Run it, study it, change it, pass it on. The one obligation worth knowing: if you
deploy a modified version and let anyone reach it over a network, section 13
requires you to offer those users the source of _your_ version. Running it
unmodified for your family asks nothing of you.

Lukarn is not affiliated with, endorsed by, or sponsored by Google LLC. Google
Drive is a trademark of Google LLC, named here only to say which service the
application reads.
