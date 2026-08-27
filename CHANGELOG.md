# Changelog

Notable changes, newest first. Versions follow [semantic versioning], and the
section matching a `v*` tag becomes the body of its
[GitHub release](https://github.com/cr0cK/lukarn/releases). These notes are
therefore written once, reviewed in a pull request, and not rewritten in a web
form afterwards.

For an instance in service, **read the migration notes before updating.** Nothing
in this application migrates volumes or renames files on its own.

[semantic versioning]: https://semver.org

## [Unreleased]

### An album, or one photograph, opened by a link

Sending photographs to somebody outside the household meant giving them an account,
or attaching files to a message. Neither is right for a grandmother who will look
once, or for a friend who is in one picture.

**Administration → Links** issues a link. Choose an album, or type the identifier of
a single photograph, give it a label so you remember who it went to, and optionally a
date after which it stops working. The address it produces is copied with one button
and sent the way you would send the photographs themselves. Anybody holding it can
open it; that address is the whole credential.

What the recipient opens carries your instance's name and its logo above what you
shared. No album list, no sign-in form, no sign that anything else is here. They can browse the album, open a photograph, zoom it and download it,
exactly as an account does. If you shared a single photograph, they never see which
album it came from: not on the page, not in the address, not in any message the
gallery sends them afterwards.

They can comment, and that still costs a verified email address. They give one, type
the six digits sent to it, and their name signs the message. It lands in the same
conversation an account sees on that photograph. Somebody who opens a shared **album**
is subscribed to its new photos, as anyone opening it would be. Somebody sent a single
photograph is subscribed to nothing, since they were not given an album.

The list shows, for every link, whether it still works and when it was last opened,
which is what tells you a message arrived. **Revoking** a link closes it immediately
for whoever holds it, including a browser already open on it, and keeps the record of
when it was used. **Deleting** it removes the link and that record together. Somebody
opening a link you took back is told so in those words, rather than being shown a page
that says the address does not exist; the difference matters when they were sent it a
month ago by somebody they know.

A link is a credential of its own. It never appears in the account list, and it
grants exactly what you chose when you made it.

### An account can be one person, invited by email

Until now an account was a password, and whoever had it was whoever had it. A
household sharing one is the case this application was built for, and it stays
exactly as it is. What was missing is the other case: somebody who should have an
account of their own, whose name follows them from a phone to a laptop without
being proved again on each.

Creating an account in **Administration → Accounts** now takes either a password,
as before, or an email address. An address sends an invitation instead of setting a
password. The recipient opens the message, types the six digits it carries, and
gives the name their comments will be signed with; somebody who has already
commented here keeps the name they gave then. From then on that account is that
person: they are known as soon as they sign in, on every device, they sign in with
a code sent to that address rather than with a password, and their comments are
signed without an address being confirmed again. There is still no public
registration form, and nobody can create an account for themselves.

An invitation also carries a language, chosen where it is sent from. The control
sits with the address, starts on the language you are reading the interface in, and
names each language in its own words. The message goes out in that language, sending
it again repeats it, and the gallery opens in it when its recipient signs in on a
browser that has not been given a language of its own. Whoever picks a language in
Settings keeps it: that choice wins over the one an invitation carried.

The sign-in screen has a second field for it, under the username and the password.
The invitation carries a link that opens that screen with the address already
filled in, and the six digits are still typed by hand. Anyone arriving later types
the address and asks for a code. A code that goes astray can be sent again from
there, and the screen says plainly that an invitation which has run out cannot be
renewed by pressing that button: ask whoever invited you to invite again.

An account already in use can be converted the same way, from its row in the list.
Read the confirmation before agreeing to it. The moment the recipient enters their
code, that account's open sessions close on every device, its paired screens are
unpaired and its password stops working, so anyone else behind it is signed out and
has to be given an account of their own. Converting a key three people share is the
wrong move for that reason. The right one is to leave it alone.

The account list gains a column saying which of four things each account is: a
shared key, a person, an invitation still open until its date, or an account whose
invitation expired with nobody taking it up. That last state is the only way an
owner ever finds out that a message went nowhere, and the row offers inviting again
and deleting side by side. An invitation lasts seven days.

Two things to know before using it. Invitations need SMTP configured, the same
relay comments already need; without one the form says so rather than creating an
account nobody can enter. And an account bound to a person holds no password at
all, so if somebody loses access to their address, an administrator takes the
account back by unbinding it and setting a password in the same step, which closes
its sessions and unpairs its screens as a conversion does.

Nothing changes for an account that keeps a password. Its sessions, its albums, its
paired screens and the way anyone signs in with it are untouched.

### Emails are written to their reader

Every message the gallery sends now addresses the person receiving it, in both
languages. The French ones had been written the way a screen is labelled, which put
"À saisir dans la page restée ouverte" and "Ne le transmettre à personne" into what
is, for the person opening it, a letter. Verification codes, new-comment and
new-photo notifications and the two unsubscribe pages are all affected. Nothing
about what they do has changed.

### The front end addresses the application by an alias

An instance served by the Caddy this repository ships is unaffected. An instance
served by a front end shared with another application was exposed to a name
collision: the `Caddyfile` proxied to `app:8080`, compose gives every container
its service name as an alias on every network it joins, and most compose files
call their service `app`. Docker then answered that name with either application,
in turn, request after request. The site kept working most of the time and served
the neighbour the rest of it.

The upstream is now `lukarn:8080`, an alias declared in `docker-compose.yml`. An
instance reached through a proxy of its own, over the published `127.0.0.1:8080`,
is not concerned at all: the alias is a name inside docker, and a proxy dialing a
port on the host never resolves it. Nothing was removed either, so anything still
addressing the container as `app` keeps working.

Updating takes `git pull` and `docker compose up -d` on the whole project, which
is what `deploy/deploy.sh` runs. Recreating the front end alone, before the
application has been given the alias, leaves Caddy asking for a name that does not
resolve yet.

## [1.2.0] — 2026-08-17

### Three new storage backends alongside Google Drive

An album could only read a folder of a Google account. Storage is now an
interface with four implementations behind it, and one instance can connect
several at a time. Each album names the storage it reads.

- **Local folder.** Photographs on a disk, or on a NAS mounted beside the
  container, are read where they are. Nothing is uploaded or copied, and videos
  still seek. Point `STORAGE_LOCAL_ROOT` at the directory the server may read and
  mount it read-only. `/admin` then picks a folder inside that directory and
  cannot reach outside it, so an administrator password does not become a way to
  read the rest of the machine.
- **S3-compatible bucket** (MinIO, Garage, Backblaze, Scaleway, Amazon): an
  address, a bucket name and a read-only key pair. The secret key is stored
  encrypted and never shown again. Tick **Address the bucket by path** for MinIO,
  and for any bucket whose name is not a valid domain name.
- **WebDAV server** (Nextcloud, ownCloud, Synology, Apache `mod_dav`): an
  address, an optional folder under it, a username and an app password.
- **Video thumbnails where the storage holds no preview.** A video used to show a
  grey tile with a play icon, so a holiday clip and a screen recording looked
  alike. A frame is now taken from the video itself, one second in, and cached
  like any other thumbnail. This needs ffmpeg, which the container image carries.

Two behaviours differ from Drive. Drive names a file by an identifier that
survives a rename, so a renamed photograph keeps its comments; the other three
name a file by its path, so renaming it creates a new photograph. Drive also
returns EXIF data and a preview with its listing, where the others return bytes:
the capture date is read from the file itself, and a HEIC or RAW file that
nothing here can decode has no thumbnail.

### Storage is now its own section of /admin

**Storage** sits at the top of the library group, above Albums, in the order an
instance is set up: connect a source, then draw albums from it. It used to sit
inside **Server**, between the sync interval and the cache budget. The cache
stays under Server, since it serves every storage at once.

- **Each connection shows its state and a Test button** that asks the backend and
  reports what it answered, such as a wrong key or an unreachable host. Until now
  a misconfigured connection produced an album that stayed empty, with no stated
  reason.
- **A connection can be edited** instead of deleted and added again: a mistyped
  endpoint, a rename, a local folder that moved, a rotated key. Albums reading a
  connection refuse its deletion, so until now the connections worth repairing
  were exactly the ones that could not be.
- **Signing an account out keeps the connection.** Its credentials are cleared,
  the albums reading it still point somewhere, and reconnecting takes one button.
- **Deleting a storage an album still reads is refused**, and the albums to move
  are listed by title. The deletion used to go through and leave their
  photographs failing to load.
- **An album can read a whole storage, with no folder to name.** Leave the folder
  empty and the album covers everything the connection declares. Drive still
  requires one, since it names folders by identifier rather than by path.
- **Adding a storage asks for a name.** The **Identifier** field is gone: it
  wanted a value only the machine reads, and warned it could never be changed.
  The name now decides it, and two storages may share a name.

### Migration notes

Nothing to do. The stored Google authorisation moves into the new connections
table without being re-encrypted, and every album keeps reading what it read
before. An instance authenticating with a service account is covered too.

Reading a folder on the machine is the one capability that has to be granted from
outside `/admin`: add `STORAGE_LOCAL_ROOT` and a read-only mount, as the README
shows. Nothing else in this release adds a variable.

### Fixed

- **Form fields are visible again in the dark theme.** Every input, list and text
  area sat on the same shade as the panel behind it, so a field was a rectangle
  drawn by its border alone. That is legible on a bright screen and invisible on
  a dim one.
- **A new installation is told to run a command that exists on the machine
  reading it.** An instance started from the image with no account yet asked its
  operator for `pnpm create-admin`, which the image does not carry. The startup
  log and the sign-in screen now give the form for the image as well.

## [1.1.0] — 2026-08-15

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

### A light theme, for the rooms that have windows

The gallery has only ever been dark. That is right for photographs and wrong for
a bright kitchen at eleven in the morning, where a black page is a mirror.

- **Settings now offers Light beside Dark**, and it applies at once — the page,
  the panels, the menus, administration.
- **Until you choose, your device chooses.** A phone or a computer set to light
  opens the gallery light, and one set to dark opens it dark. Choosing here
  settles it for good on that browser: a phone that turns itself dark at night
  will not undo the decision every evening.
- **Opening a photo still puts it against near-black**, whatever the rest of the
  application is doing. A photograph is judged against what surrounds it, and a
  white ground shifts every exposure in it. What sits beside the photo — the
  information panel, the comments, the sheet a phone pulls up — follows the
  theme like everything else.
- The choice belongs to the browser rather than the account, as the language
  already does, so one shared key can be read light on a phone and dark on the
  television in the same evening.

### Your own settings, on a page instead of at the bottom of a menu

Choosing the language meant opening the account menu and scrolling past "Sign
out" — a preference filed among the things you do to a session, one click away
from leaving.

- **A Settings page, at the top of the account menu and open to everybody.** The
  language lives there now, as a list showing which one is in force. On a phone
  each setting is a row you tap to open, the same way administration reads.
- **The theme is listed beside it**, which is the entry above: the place to look
  for it turned out to be the right one before it did anything.

Whatever comes next — the size of the thumbnails, how many fit across the grid —
lands on that page rather than lengthening the menu. As before, these choices
belong to the browser you are reading on and not to the account, so a shared key
can be read in two languages at once.

### The account is a person everywhere

The corner of the bar used to hold the first letter of your username, the phone's
Account tab a little drawing of somebody, and the menu they both open began with
your name pushed out of line with everything under it.

- **The same person is drawn in all three places**, so the mark you press is the
  mark you land on, and your name now lines up with Settings, Administration and
  Sign out as what those actions apply to.
- Nothing is fetched from anywhere for it: no photo, no avatar service, no
  address handed to a third party — the drawing comes with the page, as the
  letter did.

### The gallery says what it runs, and when something newer exists

Until now, an instance could not tell you which version it was: the number lived
in the tag, in the image's labels and in these notes, and nowhere the application
could read. Finding out meant going to the machine.

- **"Powered by Lukarn v1.2.3" sits at the foot of the account menu**, on a phone
  and on a desktop, next to a link to this file — what changed, in every version,
  where the version is displayed.
- **An administrator is told when a newer release is published**, as a badge
  giving its number and linking to its notes. Nothing updates itself and nothing
  offers to: replacing the image is still `./deploy/backup.sh` then
  `./deploy/deploy.sh`, taken deliberately, on the machine.
- **The instance asks at most once every six hours, and only while an
  administrator is looking at the answer.** Nobody else's visit costs a request,
  and `UPDATE_CHECK_URL=` in the `.env` switches it off entirely — then nothing
  leaves the machine for it. An instance built from source reports `dev` and
  contacts nobody at all.

The startup log now opens on the version too, which is the first thing worth
knowing when one instance behaves unlike another.

### Fixed

- **An installed application no longer draws under the notch or the home bar.**
  The interface declared `viewport-fit=cover` without reading a single
  `env(safe-area-inset-*)`, so the top row sat beneath the clock. On iOS the
  status bar was already excluded by choice, so what this returns there is the
  space above the home indicator.
- **Hints, counters and "never" are quiet again.** Placeholder text, the
  character counters under a description and "never" in the visits table asked
  for a shade the palette never defined, so each fell back to the colour it
  inherited — the loudest one available. "never" once more reads as fainter than
  a real date beside it.
- Opening a photo carries its thumbnail into place instead of cutting to a
  full-screen image, on browsers that support view transitions.
- The magnifier now sits on the middle of the search field in the phone's search
  sheet, rather than six pixels below it.

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

[unreleased]: https://github.com/cr0cK/lukarn/compare/v1.2.0...main
[1.2.0]: https://github.com/cr0cK/lukarn/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/cr0cK/lukarn/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/cr0cK/lukarn/releases/tag/v1.0.0
