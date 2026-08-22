# 01 — Vision and scope

## The problem

Google Drive's native preview is a file browser, not a photo gallery: it has no
justified grid, no chronological grouping, no sorting by capture date, and poor
keyboard navigation. Sharing a photo folder also assumes that the recipient has
a Google account, while a Drive sharing link grants access to anyone who obtains
it.

The application replaces this preview with a self-hosted gallery that reads where
the owner keeps their photographs and exposes it behind an account, one album at a
time. Drive was the first place it read, and the section below names the others.

## More than one storage, and more than one kind

Google Drive is the **first** storage read, and no longer the only kind.
`packages/server/src/storage/` holds `StorageProvider`, the three operations that
actually reach a storage; everything downstream reads a `StorageEntry` and never a
Drive field (D260815f).

**A folder on the machine** — photographs already on a disk, or on a NAS mounted
beside the container, served without being uploaded anywhere. That folder is chosen
by whoever runs the server, not by whoever administers it: `STORAGE_LOCAL_ROOT`
names one directory and `/admin` picks a subfolder under it (D260816d, and
[04](./04-security-and-access.md)).

**An S3-compatible bucket** — MinIO, Garage, Ceph, Backblaze and Amazon alike,
declared from /admin with an endpoint, a bucket and a read-only key pair. It adds
no dependency: the signature is computed here and the listing read by the element
reader WebDAV shares (D260816e).

**A WebDAV server** — Nextcloud, ownCloud, an Apache `mod_dav`, a Synology —
declared with an address, a folder and an app password (D260816f).

None of the three can do what only Drive can, and the difference is a scope
statement rather than an omission. Drive names a file with an identifier that
survives a rename, so a photograph dragged into another folder keeps its comments;
everywhere else a file is named by its path, and renaming it makes it a new
photograph (D260816c). Drive also returns EXIF data and holds a preview inside its
listing, where the others hold neither — the indexer reads the bytes, and a video
poster is cut by ffmpeg (D92, D260816b).

Reading **several accounts** was excluded for as long as `oauth_token` carried
`CHECK (id = 1)`: one instance, one Drive. That was the schema stating a scope
decision, and a table of connections lifts it — an instance may now read a Drive
for the family album and another for the archives (D260815g). What has not
changed is that an album reads **one** storage: it names it, and moving it
elsewhere reindexes it.

## Intended users

There are two roles, and only two. The second comes in two kinds since 1.3, which
differ by who holds the credential rather than by what may be seen:

| Role                        | How many         | What they do                                                                                      |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| The owner                   | One per instance | Declares the storages the instance reads, manages accounts and albums from `/admin`               |
| An account that is a key    | A few accounts   | Signs in with a username and a password, which a household may pass around, and views its albums  |
| An account that is a person | Any of those     | Invited by email, signs in with a code sent to that address, and is known by name on every device |

An **account need not be a person**: by default it is an access key, and nothing
prevents an entire household from sharing one, which has been the intended use
since `albums.yaml`. When signing a comment on such an account, each person
identifies themselves with their name and address, verified by a code (see
[04](./04-security-and-access.md)).

Since 1.3 an account may instead be **bound to one verified identity**
([D260819](./08-decisions/D260819-an-account-may-be-bound-to-a-person-rather-than-a.md)).
The owner invites it by email, the recipient enters the six digits the message
carries and gives the name their comments will be signed with, and from then on
that account is that person: known as soon as the session opens, on a phone and
on a laptop alike, and entered with a code sent to that address rather than with
a password
([D260819b](./08-decisions/D260819b-a-bound-account-signs-in-with-a-code-sent-to-its.md)).

A visitor never has a Google account and never sees a storage URL, signed or
otherwise. All content passes through the server, which fetches it with the
credential the album's connection holds.

## Two languages, chosen by the reader

The interface, the server's refusals, its emails and its unsubscribe pages exist
in English and in French. A visitor gets the language of their browser and can
change it from the account menu; the choice is remembered by that browser, not by
the account, because one access key may open the same albums on a phone and on a
television in the living room.

Adding a third language means two files and no other decision — the catalogues
are typed against each other, so a forgotten sentence stops the build rather than
reaching a screen (see [07](./07-frontend.md)).

## Deliberately out of scope

These omissions are not gaps to fill; they are choices that keep the project
manageable.

| Excluded                                                              | Why                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Writing anything to a storage                                         | The interface every backend implements has no write operation: the requested Drive scope is `drive.readonly`, and a local folder is mounted `:ro`, so the guarantee holds at the deployment level too. No app bug can destroy the originals.     |
| Editing, retouching, persisted rotation                               | The originals belong to the storage that holds them; the app only produces disposable derivatives.                                                                                                                                               |
| Registration, forgotten passwords                                     | The owner creates every account from `/admin`, with a password or with an invitation sent to an address. An invitation changes who types the secret, never who may open the door: there is still no public form, and nobody signs themselves up. |
| Public link sharing                                                   | Every media route requires a session. A link copied to a third party gives them nothing.                                                                                                                                                         |
| Facial recognition, tags                                              | Recognising a face means processing the content, and therefore downloading every original, which indexing is specifically designed to avoid. Searching does exist, over the text the library already holds rather than over the pixels (D96).    |
| Public comments, or comments signed with a Google account             | Commenting requires the session that already grants access to the album. A third-party identity would create a second population of users without permissions, which would need reconciling with `user_albums` (D33).                            |
| **Unrestricted** comment editing, reactions, mentions, nested threads | This is what separates a conversation under a photo from a forum. Replies have only one level. Authors may correct a typo for **30 s** after posting (D57); after that, deletion remains the only remedy.                                        |
| Transcoding a video the browser can already play                      | An `avc1` file is relayed as it stands, `Range` by `Range`, which gives native seeking at no processor cost. Only a codec no current browser decodes — `hvc1`, `hev1` — is prepared, once, in the background and at low priority (D6).           |
| Query-built albums (dates, tags)                                      | An album names one container on one storage, and that is all. The mapping remains easy to verify visually in `/admin`.                                                                                                                           |
| Correcting the location of **one photo**                              | Locations are corrected by day. Per-photo correction would require an override table outside `media` — which `upsertMany` rewrites entirely on every sync —, merging it wherever GPS data is read, and a map picker (D51).                       |
| A map                                                                 | Coordinates are used to name a day, not for browsing. A map would require third-party tiles in an app that sends no browser requests outside the instance. The name a day carries is searchable as text, like the rest of the library.           |
| Multi-tenancy                                                         | One instance serves one household. Several **storages** are supported since 1.2 — a table of connections, an album names one — but every account of an instance sees the same library, filtered by album permissions.                            |

## Constraints that shaped the design

**A modest VPS.** The target: one container, a few hundred MB of RAM, no Postgres
alongside it, no Redis, and no separate worker. Hence in-process SQLite, a disk
cache with an in-memory inventory, in-memory login throttling, and sequential
rather than parallel synchronisation. The application is a single service in
`docker-compose.yml`; the only other one is the reverse proxy that terminates TLS
in front of it.

**The Drive API quota.** Every call counts, and a gallery that queries Drive on
every scroll burns through it quickly. The solution is a local index populated by
`files.list`, which already returns dimensions and EXIF without downloading a
single byte of any photo (`packages/server/src/sync/sync.ts`). An album with
several thousand photos can be indexed in a handful of requests.

**One owner, however many storages.** A connection carries its own encrypted
secret, and an album names the connection it reads (D260815g). Nobody chooses a
storage while browsing: the album has already chosen, so there is still no account
selection and no user-to-connection join. What `/admin` monitors is one line per
connection rather than one for the instance.

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
- **Searching what the library says about itself**: album titles and descriptions,
  day notes, the places a day was given, and the description a photo carries. A
  result is somewhere to go rather than a line of text to read, and the index is
  maintained by the schema, so a write path added later cannot forget it (D96).
- **A video plays where it can, and is prepared where it cannot.** What the browser
  decodes is relayed untouched, `Range` by `Range`. What no browser decodes —
  an iPhone's HEVC — gets an H.264 version cut in the background, one at a time, at
  low priority, and the original stays available throughout (D6). Its poster
  comes from the preview the storage holds, or from a still cut by ffmpeg where it
  holds none (D92).
- Per-photo comments with one reply level, moderated after the fact from `/admin`
  and notified by email. They are signed by an **identity** — a name and an address
  verified by code — separate from the access key, which a household can share.
  Without an SMTP server, no code is sent and comments remain unavailable.
- **An account can be one person, invited by email**. The owner creates it with an
  address instead of a password, or converts an account already in use; the
  recipient enters the code the invitation carries and gives the name their
  comments will be signed with. That account is then entered with a code sent to
  that address, and it signs by itself on every device it opens. An account
  created with a password is untouched (see D260819 and D260819b).
- **Activity feed**: the latest comments from albums the visitor is authorised to
  view, across all albums and photos, in a drawer opened from the top bar. A
  conversation should not be discovered only by opening the right photo by chance:
  without this view, a message could appear and fade away without any of its
  recipients seeing it (see D82).
- **Installable on a phone, in the theme of the room it is read in.** Added to the
  home screen it opens without an address bar and without a password to type
  again, its service worker holding the shell and never a photo (D71). The
  interface follows the device between a light and a dark ramp until a reader
  settles it for that browser, and an open photo keeps its near-black surround in
  both (D260815d).
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
