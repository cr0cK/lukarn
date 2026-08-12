# 01 — Vision and scope

## The problem

Google Drive's native preview is a file browser, not a photo gallery: it has no
justified grid, no chronological grouping, no sorting by capture date, and poor
keyboard navigation. Sharing a photo folder also assumes that the recipient has
a Google account, while a Drive sharing link grants access to anyone who obtains
it.

The application replaces this preview with a self-hosted gallery that reads the
owner's Drive and exposes it behind a username and password, one album at a time.

## Intended users

There are two roles, and only two:

| Role      | How many         | What they do                                                                   |
| --------- | ---------------- | ------------------------------------------------------------------------------ |
| The owner | One per instance | Connects their Drive once via OAuth, manages accounts and albums from `/admin` |
| Visitors  | A few accounts   | Sign in with a username/password and view their albums                         |

An **account is not a person**: it is an access key, and nothing prevents an
entire household from sharing one — that has been the intended use since
`albums.yaml`. When signing a comment, each person identifies themselves with
their name and address, verified by a code (see [04](./04-securite-et-acces.md)).

A visitor never has a Google account and never sees a Google URL. All content
passes through the server, which obtains it with the owner's single token.

## Deliberately out of scope

These omissions are not gaps to fill; they are choices that keep the project
manageable.

| Excluded                                                              | Why                                                                                                                                                                                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Writing anything to Drive                                             | The requested scope is `drive.readonly` (`packages/server/src/drive/service.ts`). No app bug can destroy the originals.                                                                                                    |
| Editing, retouching, persisted rotation                               | The originals belong to Drive; the app only produces disposable derivatives.                                                                                                                                               |
| Registration, forgotten passwords                                     | The owner creates accounts from `/admin`. There is no public form and no email to send.                                                                                                                                    |
| Public link sharing                                                   | Every media route requires a session. A link copied to a third party gives them nothing.                                                                                                                                   |
| Facial recognition, search, tags                                      | These would require processing the content — and therefore downloading every original, which indexing is specifically designed to avoid.                                                                                   |
| Public comments, or comments signed with a Google account             | Commenting requires the session that already grants access to the album. A third-party identity would create a second population of users without permissions, which would need reconciling with `user_albums` (D33).      |
| **Unrestricted** comment editing, reactions, mentions, nested threads | This is what separates a conversation under a photo from a forum. Replies have only one level. Authors may correct a typo for **30 s** after posting (D57); after that, deletion remains the only remedy.                  |
| Video transcoding                                                     | ffmpeg on a modest VPS consumes CPU that is not available. `Range` requests are relayed unchanged to Drive. A video does have a thumbnail, but it comes from the Drive preview: no bytes are decoded here (D92).           |
| Query-built albums (dates, tags)                                      | An album is a Drive folder, full stop. The mapping remains easy to verify visually in `/admin`.                                                                                                                            |
| Correcting the location of **one photo**                              | Locations are corrected by day. Per-photo correction would require an override table outside `media` — which `upsertMany` rewrites entirely on every sync —, merging it wherever GPS data is read, and a map picker (D51). |
| Map, location search                                                  | Coordinates are used to name a day, not for browsing. A map would require third-party tiles in an app that sends no browser requests outside the instance.                                                                 |
| Multi-tenancy, multiple Drives                                        | The `oauth_token` table has a `CHECK (id = 1)` constraint: one instance, one Drive.                                                                                                                                        |

## Constraints that shaped the design

**A modest VPS.** The target: one container, a few hundred MB of RAM, no Postgres
alongside it, no Redis, and no separate worker. Hence in-process SQLite, a disk
cache with an in-memory inventory, in-memory login throttling, and sequential
rather than parallel synchronisation. `docker-compose.yml` has only one service.

**The Drive API quota.** Every call counts, and a gallery that queries Drive on
every scroll burns through it quickly. The solution is a local index populated by
`files.list`, which already returns dimensions and EXIF without downloading a
single byte of any photo (`packages/server/src/drive/sync.ts`). An album with
several thousand photos can be indexed in a handful of requests.

**A single Drive owner.** There is only one encrypted refresh token in a
single-row table. This simplifies everything: no account selection, no
user-to-token join, and only one point of failure to monitor in `/admin`.

**The visitor's network.** The grid must be usable before a single image arrives:
dimensions come from the index, so the layout is calculated while empty and does
not move afterwards (see [07](./07-frontend.md)).

## The result

- Justified grid grouped by month or day, virtualised, with a reversible
  chronological order. The album determines its default grouping: a trip is read
  by day, ten years of children's photos by month.
- **A day can be annotated** and display the location indicated by its photos. An
  album used to be only a dated grid: nothing in it said what happened. The note
  is entered in the album beside the photos it describes; the location is inferred
  from EXIF coordinates through background reverse geocoding, and corrected
  manually when it is inaccurate. The album description is finally displayed —
  it used to be entered from `/admin` but shown nowhere.
- A keyboard-controlled full-screen viewer with EXIF and original-file download.
- Photos (JPEG, PNG, WebP, HEIC…) and videos (MP4, MOV) — anything `classify()`
  recognises as `image/*` or `video/*`.
- WebP thumbnails generated on demand and cached on disk with LRU eviction.
- Per-photo comments with one reply level, moderated after the fact from `/admin`
  and notified by email. They are signed by an **identity** — a name and an address
  verified by code — separate from the access key, which a household can share.
  Without an SMTP server, no code is sent and comments remain unavailable.
- **Activity feed**: the latest comments from albums the visitor is authorised to
  view, across all albums and photos, in a drawer opened from the top bar. A
  conversation should not be discovered only by opening the right photo by chance:
  without this view, a message could appear and fade away without any of its
  recipients seeing it (see D82).
- **Pairing a screen without a keyboard**: a television displays a QR code, an
  already signed-in phone approves it, and the screen receives the session. Typing
  a masked password with a remote control is the most painful way to open a family
  gallery, yet this is precisely the screen where people view it. Pairing delegates
  existing access; it creates none (see D260809c).
- **Email announcement of new photos in an album**, sent to verified identities
  that have opened that album. Nobody spontaneously returns to a self-hosted
  gallery: without this announcement, uploaded photos and the comments they might
  prompt would have no audience. Subscription is automatic and unsubscription is
  per album (see D41).
