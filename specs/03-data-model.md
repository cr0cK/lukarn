# 03 — Data model

Single database: `${DATA_DIR}/lukarn.db`, opened by `packages/server/src/db.ts`.

## Pragmas

| Pragma                 | Rationale                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `journal_mode = WAL`   | Grid reads do not block the sync writing in the background.                                |
| `synchronous = NORMAL` | Acceptable durability/throughput tradeoff: the index can be rebuilt.                       |
| `foreign_keys = ON`    | Essential since migration 3: this enforces the `ON DELETE CASCADE` rules on `user_albums`. |
| `busy_timeout = 5000`  | A concurrent write waits instead of returning `SQLITE_BUSY`.                               |

## Tables

### `media`

The index. One row = one file of one storage **in one album**. Which storage is
not a column here: it comes from the album (`albums.connection_id`), and
`getFileMeta` joins it so the media proxy can resolve a provider.

| Column                                                                                                        | Type    | Note                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `album_id`                                                                                                    | TEXT    | Album ID as stored in the `albums` table. No foreign key: the index is cleaned explicitly (see below).                                                                                                                   |
| `id`                                                                                                          | TEXT    | The backend's reference when it is an identity (a Drive file id), otherwise `sha1(connectionId\|path)` truncated to 32 characters — D260816c.                                                                            |
| `name`                                                                                                        | TEXT    | File name; used for the download `Content-Disposition`.                                                                                                                                                                  |
| `mime_type`                                                                                                   | TEXT    | Returned unchanged on `/original`.                                                                                                                                                                                       |
| `kind`                                                                                                        | TEXT    | `CHECK (kind IN ('photo','video'))`.                                                                                                                                                                                     |
| `size`                                                                                                        | INTEGER | Nullable: Drive does not always report a size.                                                                                                                                                                           |
| `width` / `height`                                                                                            | INTEGER | **Already corrected for EXIF rotation** by `toUpsert`. This lets the frontend calculate the layout without loading an image.                                                                                             |
| `taken_at`                                                                                                    | TEXT    | ISO 8601 UTC. Photo: EXIF date when known, otherwise `modifiedTime`. Video: reconstructed from the file — see below.                                                                                                     |
| `taken_at_from_exif`                                                                                          | INTEGER | 0/1. The frontend writes "Taken" or "Modified" according to the value. Set to 1 whenever the date comes from the file, EXIF or container.                                                                                |
| `modified_time`                                                                                               | TEXT    | ISO 8601. Written on every sync, never read — retained; see "Columns written and never read" below.                                                                                                                      |
| `duration_ms`                                                                                                 | INTEGER | Videos only.                                                                                                                                                                                                             |
| `camera_make`, `camera_model`, `lens`, `iso_speed`, `exposure_time`, `aperture`, `focal_length`, `lat`, `lng` |         | EXIF, all nullable. Served by `/items/:mediaId`.                                                                                                                                                                         |
| `md5`                                                                                                         | TEXT    | Whatever the backend guarantees changes with the bytes: a Drive `md5Checksum`, an ETag, `size:mtime`. Carries the URL and ETag version, forms part of the disk-cache key, and is what lets a resync skip rereading EXIF. |
| `has_thumbnail`                                                                                               | INTEGER | 0/1: does the **storage** hold a preview? Drive is the only backend that says yes. It no longer decides whether a video has a thumbnail — D92.                                                                           |
| `video_codec`                                                                                                 | TEXT    | Codec of a video's video track, read from its `moov`. Three states; see below.                                                                                                                                           |
| `source_path`                                                                                                 | TEXT    | Path inside the container, for a backend whose reference is a path — the only way to fetch the bytes back, since `id` is a hash. NULL for Drive, whose file id survives a rename.                                        |
| `seen_at`                                                                                                     | TEXT    | Timestamp of the sync that saw this row. Basis for `deleteStale`.                                                                                                                                                        |
| `added_at`                                                                                                    | TEXT    | Date added to the index, written on INSERT and **never** by `ON CONFLICT DO UPDATE`. Nullable — see below.                                                                                                               |
| **PK**                                                                                                        |         | `(album_id, id)`                                                                                                                                                                                                         |

**In practice, `has_thumbnail` applies only to videos.** A photo always has a
render — the pipeline decodes it and falls back to the preview the backend holds
when libvips cannot read it —, while a video's image comes either from that
preview or, when the backend holds none, from a still cut by ffmpeg
([D92](./08-decisions/D92-a-video-poster-is-the-storage-s-preview-then-a-still.md)).

The column records **what the storage said it holds**, which outside Drive is
always no. The API therefore exposes not the column but the question being asked:
`MediaItem.hasPreview`, calculated by `toItem()` as
`kind === 'photo' || has_thumbnail === 1 || ffmpeg is available`. The frontend
requests a thumbnail "when one exists", without reproducing the rule itself — and
without that last term it would never request the poster ffmpeg would have
produced.

**A video's `taken_at` does not come from Drive.** `videoMediaMetadata` is limited
to `{width, height, durationMillis}`: there is no capture date. The sync therefore
reads the container's `creation_time` through a few `Range` requests and compares
it with the timestamp in the file name — `resolveVideoTakenAt`, with four rules
described in
[D97](./08-decisions/D97-a-video-s-date-comes-from-the-file-not-its-upload-date.md).
`taken_at_from_exif` is 1 for the first three and 0 for the last, where only the
upload date remained: the panel then writes "Modified", which is exactly what is
known. No migration accompanies this change — the sync upserts every file again,
and a video already dated from its file is reread only when its `md5` changes.

**`video_codec` has three states, and the distinction is not cosmetic.** It holds
the four-letter code written in the video track's `stsd` — `avc1`, `hvc1`, `hev1`
— and determines what the server prepares and which source the client requests
([D6](./08-decisions/D6-a-video-is-relayed-untouched-except-a-codec-no-browser.md)):

| Value       | Meaning                                                                            | Consequence                                                   |
| ----------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `NULL`      | Never examined: photo, row predating migration 14, or header Drive did not return. | The sync will reopen the file.                                |
| `''`        | Header read, no recognised video track.                                            | Never reread — persisting would reread it for nothing.        |
| `'hvc1'`, … | The codec as written in the file.                                                  | `hvc1` and `hev1` are prepared; the rest is served unchanged. |

Without the second state, an exotic container would be reopened on every
synchronisation indefinitely. The first state populates the column without a
backfill: the `md5` shortcut requires `video_codec` to be set, so videos indexed
by the previous PR are reread **once**, then bypassed like the others.

**`added_at` is not a duplicate of `seen_at`, and this is the trap in migration 5.** `seen_at` is rewritten for _all_ media on every synchronisation pass,
including known media: using it to count new items would count the entire album
every half hour. Once set, `added_at` never changes — making
`WHERE added_at > ?` reliable, which is what `MediaRepo.countAddedSince` reads.

Accepted corollary: rows indexed **before** migration 5 remain `NULL` and are
therefore excluded from every comparison. This is intentional — otherwise the
first new-content announcement would include the gallery's entire history.

### `sync_state`

One row per album: `album_id` (PK), `last_sync_at`, `status`
(`never` \| `running` \| `ok` \| `error`), `error`, `notified_at`.

`status` and `error` are overwritten on every attempt, but `last_sync_at` is
updated only on success (`sync/sync.ts`): `/admin` can therefore display "error,
last successful sync 3 hours ago".

`notified_at` holds the date of the latest new-content announcement sent by email
(`notifier.ts`). `SyncStateRepo.set()` never touches it, so it survives both
synchronisations and their failures; otherwise a failed sync would announce
everything again. `NULL` means "never announced", and the notifier's first run
sets the boundary **without sending anything**.

### `storage_connections`

Where the albums live. One row = one backend this instance reads, and
`albums.connection_id` names it.

| Column       | Type    | Note                                                                                                     |
| ------------ | ------- | -------------------------------------------------------------------------------------------------------- |
| `id`         | TEXT    | PK. A slug — `drive`, `archives-minio` — written into every album that reads it, so it never changes.    |
| `kind`       | TEXT    | `drive`, `local`, `s3` or `webdav`. Decides which implementation `storage/registry.ts` builds.           |
| `label`      | TEXT    | What /admin displays.                                                                                    |
| `settings`   | TEXT    | JSON, **nothing secret**: an endpoint, a bucket, a prefix, and a Drive connection's consented scope.     |
| `ciphertext` | TEXT    | The secret half, encrypted with `TOKEN_KEY` — see [04](./04-security-and-access.md). NULL until granted. |
| `account`    | TEXT    | What names the connection to a person: an address, a bucket, a URL.                                      |
| `granted_at` | TEXT    | When the secret was obtained. NULL for a connection nothing was granted to.                              |
| `revoked_at` | TEXT    | Non-NULL once the backend stopped accepting the secret.                                                  |
| `created_at` | TEXT    | ISO 8601.                                                                                                |
| `position`   | INTEGER | Display rank, like `albums.position`: creation dates collide on a seeded instance.                       |

**What `settings` and `ciphertext` contain belongs to the kind.**
`StorageConnectionRepo` encrypts and decrypts a string and knows nothing else about
it; a backend needing more than one value puts JSON there.

| Kind     | `settings`                                       | `ciphertext`                          |
| -------- | ------------------------------------------------ | ------------------------------------- |
| `drive`  | `scope`, the consented OAuth scopes              | the refresh token, on its own         |
| `webdav` | `url`, the endpoint; `root`, a folder beneath it | `{"username":…,"password":…}` as JSON |

Drive's is a bare token rather than an envelope because that is what `oauth_token`
held — which is what let migration 17 _copy_ the column instead of re-encrypting
it with a key the migration cannot be sure of.

An `s3` connection is the first to need two values, and stores
`{"accessKeyId":…,"secretAccessKey":…}` in that one string. Its `settings` hold
`endpoint`, `region`, `bucket`, `prefix` and `pathStyle` — an address, a region
and a name, none of which grants anything on its own, which is why they sit in
the clear beside the pair that does. `pathStyle` is the string `"true"` or
absent: `settings` is a map of strings end to end, and inventing a JSON boolean
for one field would make every reader of the column check two shapes.

A non-null `revoked_at` means "the backend rejected the secret". The row is
**retained** rather than deleted: an empty table would look like a fresh
installation, whereas the administrator needs to know _which_ connection lost its
authorisation. Disconnecting clears the secret and keeps the row, for a different
reason — its albums name it by id, and taking it away would leave them pointing at
nothing.

**No foreign key from `albums.connection_id`.** SQLite refuses to add a column
carrying a foreign key unless its default is NULL, and a nullable connection is the
state this design exists to prevent. `StorageConnectionRepo` refuses to delete a
connection an album still names (`409 storage_in_use`), which is the same guarantee
stated where its message can be read.

### `sessions`

`id` (PK, 32 random bytes in base64url), `username`, `created_at`, `expires_at`,
`commenter_id`, `last_seen_at`, `device`. One-year TTL (`sessions.ts`), extended
by the same amount once a session passes its half-life — the cookie is reissued at
the same time, otherwise the browser would discard its copy on the original date
and the extension would achieve nothing.

The last two columns hold visit telemetry (D260809h):

- **`last_seen_at`** — latest request received from this session. It requires no
  extra read: `SessionStore.get()` already reads the row again on every request,
  so one column is added to the SELECT. Rewriting it is limited to **once per hour
  per session**, following the same reasoning as expiry extension — without this
  threshold, every thumbnail in a grid would trigger an UPDATE. `NULL` for a
  session opened before migration 15, until its next request.
- **`device`** — `'mobile'`, `'tablette'`, `'ordinateur'`, or `'tv'`, inferred
  from the user-agent by `device.ts` **when the session is created, then
  discarded**. The full user-agent is stored nowhere: it is a fingerprint, while
  one of four classes cannot re-identify anyone. `NULL` when the login request has
  no header, and for sessions predating the migration.

### `device_pairings`

A pending pairing request while a screen without a keyboard obtains a session
(D260809c). This is a transient table: a row lives there for at most five minutes
and disappears as soon as the requesting device collects its session.

| Column                      | Role                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `user_code` (PK)            | The eight characters displayed on the requesting screen and included in the QR code. Stored **in plain text**: they appear on a television, so hashing would protect nothing the room cannot already see.                |
| `device_hash` (UNIQUE)      | HMAC of the 32-byte `deviceCode` returned only to the requester. This authorises session collection, never the displayed code. Hashed for the same reason as `verification_codes.code_hash`: a dump must reveal nothing. |
| `username`                  | The approving person's account, `NULL` until someone approves. `COLLATE NOCASE` and `ON DELETE CASCADE`, as wherever an account is referenced: a request approved by a deleted account dies.                             |
| `approved_at`, `created_at` | ISO 8601 UTC dates. A `NULL` `approved_at` means "pending".                                                                                                                                                              |
| `expires_at`                | Five minutes after creation. A longer request would leave an approvable code lingering on a powered-on screen.                                                                                                           |

Three points maintain the isolation:

- **The row is deleted when collected, not marked.** A `deviceCode` therefore
  yields only one session: replaying it produces the same response as an unknown
  code.
- **Approval creates no session** — it only records who approved. Otherwise a
  one-year session would be created for a screen that may have been turned off in
  the meantime (D260809c).
- **The hourly purge in `main.ts`** deletes expired requests alongside sessions
  and throttle counters. Without it, requests that are never approved would
  accumulate until restart.

### `users`, `albums`, `user_albums`, `settings`

The configuration: who can sign in, which containers are exposed and on which
storage, and the settings. Written **only** by `ConfigRepo` (`config-repo.ts`).

| Table         | Columns                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`       | `username` (PK, `COLLATE NOCASE`), `password_hash`, `admin`, `all_albums`, `commenter_id`, `created_at`, `updated_at`                                                                                   |
| `albums`      | `id` (PK), `title`, `description`, `connection_id`, `folder_id`, `recursive`, `group_by`, `sort_order`, `cover_media_id`, `position`, `created_at`, `updated_at`                                        |
| `user_albums` | `username`, `album_id`, composite PK, two `ON DELETE CASCADE` foreign keys                                                                                                                              |
| `settings`    | `key` (PK), `value` — JSON. Keys: `instanceName`, `primaryColor`, `syncIntervalMinutes`, `syncOnStartup`, `cacheMaxSizeGB`, `prewarmCache`, `transcodeVideos`, `videoCacheMaxSizeGB`, `moderationEmail` |

Key choices:

- **`COLLATE NOCASE` on `users.username`.** Login has always been case
  insensitive; uniqueness had to be as well, otherwise "Alexis" and "alexis"
  could coexist and login would select one arbitrarily. The collation provides
  both: the entered case is stored and displayed unchanged, while the primary-key
  index compares without case. A second lowercase column would do the same job at
  the cost of a risk that the two become unsynchronised. NOCASE folds only ASCII —
  the only characters `USERNAME_PATTERN` accepts.
- **The `*` wildcard is an `all_albums` boolean, not a relationship row.** An
  `album_id = '*'` row would require a fictitious album to satisfy the foreign
  key, or abandoning that key. More importantly, the wildcard must cover albums
  **created later**: a fixed list of relationships would not.
- **`connection_id`** names the storage this album reads, defaulting to `drive`
  — the row migration 17 creates for every instance. Changing it purges the album
  index exactly as changing `folder_id` does: the same path on another storage is
  another set of files, and the identifiers of the old one address nothing there
  (D26).
- **`position`** holds display order. `created_at` could not reproduce it because
  bootstrapping creates every album in the same millisecond.
- **`group_by`** (`CHECK (group_by IN ('month', 'day'))`, default `month`) is the
  grouping applied when opening an album. It used to live only in the URL, meaning
  nowhere: a trip is read by day, ten years of children's photos by month, and
  reopening the album restored the global default every time. The `?group=`
  parameter still takes precedence — this is a preference, not a constraint.
- **`sort_order`** (`CHECK (sort_order IN ('desc', 'asc'))`, default `asc`) is the
  reading order applied when opening an album, for the same reason as `group_by`:
  a trip is told from its first day to its last, while an evolving library is read
  from the end. The `?order=` parameter takes precedence, and the browser remembers
  per album what its reader chose — the column is only the third fallback (see
  [07](./07-frontend.md) and D99).
- **`cover_media_id`** is the photo chosen as the cover, or `NULL` to use the
  newest automatically. There is no foreign key to `media`, for the same reason as
  `comments.media_id`: `deleteStale` removes a row as soon as a synchronisation
  does not see it again, and a cascade would erase the choice after an indexing
  mishap. The fallback is therefore calculated on reads by
  `MediaRepo.stats(albumId, chosenId)`: a photo missing from the index — or one
  that is a video — yields to the newest without erasing the choice. Videos have
  had thumbnails since D92 and keep one even off Drive (D92), but a poster can
  still be absent — no preview on the backend and no ffmpeg in the image — while
  the cover is the only image whose absence is visible from the home page with no
  fallback. Because the Drive identifier is stable, a returning photo becomes the
  cover again.
- **`instanceName` and `primaryColor` are the instance's visible identity**, and
  they live here rather than in `.env` (D260813c). `instanceName` is seeded by
  `APP_NAME` while no value has been saved and ignored afterwards, the same
  bootstrap relationship `config/albums.yaml` has with accounts (D24).
  `primaryColor` is `#rrggbb`, defaulting to `#eb2020` — the red of the mark's
  dot — and everything else the interface paints with is derived from it by
  `derivePalette` (D260813). `ConfigRepo` folds both to one stored form on
  write: the name trimmed, the colour lower-cased, because that colour becomes an
  `ETag` and a generated-icon key where two spellings would be two entries. The
  logo itself is not in the database — it is a file under `DATA_DIR/branding/`
  (D260813b).
- **`commenter_id` binds this access key to a person**, or is `NULL` and the
  account is the shareable key it has always been. There is one axis rather than
  two kinds of instance: every rule written against a session — `canSee()` on
  every request, 404 and never 403, the account reread on every request — stays
  true without asking which kind of account it is looking at. The `UNIQUE` index
  over the column counts multiple `NULL`s as distinct, which is exactly "many
  unbound accounts, at most one account per person", and `ON DELETE SET NULL`
  means forgetting who somebody is never deletes their album grants. The column
  is written when a code is consumed and never at creation: a verified address
  proves that somebody controls an inbox, not that they accepted this account.
- **"No password" is one reserved argon2 hash**, declared in `crypto.ts` as
  `NO_PASSWORD_HASH`. `password_hash` is `NOT NULL` and stays that way: a nullable
  column would mean rebuilding `users` to express with a null what a constant
  expresses without touching the schema. An account created by address carries it
  until its invitation is consumed, and `/auth/login` compares it like any other
  hash, without branching. It is a constant rather than random bytes thrown away
  because two rules have to recognise it: the last-admin count, which excludes an
  account with this hash and no binding, and the account list, which shows an
  account with no way in. It is generated from CSPRNG bytes whose preimage is
  destroyed, never by hashing a readable literal, since a sentinel that is
  `argon2("NO_PASSWORD")` is a password opening every account holding it.
  `config.ts` refuses it in a bootstrap `config/albums.yaml`: that file runs before
  any mail could be sent, so it keeps creating shared keys.
- **`created_at` / `updated_at` are written by the application**, in ISO 8601 UTC,
  rather than by `CURRENT_TIMESTAMP`, which would produce a different format from
  the rest of the database.
- **There is still no address column on `users`.** An account may now name a
  person, and it does so through `commenter_id` rather than through a column of
  its own: one identity, one row, one place a rename applies. An unbound account
  remains an access key with nobody behind it, shareable by an entire household.
  The address notified of new comments is an instance setting
  (`settings.moderationEmail`) and binds nobody.
- **Resolving an address to an account is a query, not a snapshot lookup.**
  `ConfigRepo.userForEmail` joins `users` to `commenters` in SQLite, and it runs
  once per sign-in. What stays in memory is `canSee()`, which runs once per
  thumbnail: nothing added here may reach that path.

#### What binding an account writes

Three operations write more than the four tables above, and each is one transaction
owned by `ConfigRepo` because it owns the snapshot that must be rebuilt once the
transaction has committed. Neither `createUser` nor `updateUser` is reused inside
them: both invalidate that snapshot before returning, so composing them would
rebuild it from writes still open to rollback, and `PRAGMA data_version` does not
move for a write on the connection that made it.

| Operation                    | Writes                                                                     |
| ---------------------------- | -------------------------------------------------------------------------- |
| Create an account by address | `users` with the reserved hash, `verification_codes`                       |
| Consume an invitation        | `users`, `commenters`, `verification_codes`, `sessions`, `device_pairings` |
| Unbind                       | `users`, `sessions`, `device_pairings`                                     |

Consuming an invitation covers converting a shared key as well, with the same
statements: the account is bound, its address verified, the code spent, its password
replaced by the reserved hash, its sessions closed and its approved pairings deleted.
An account created by address has no password to replace, no session and no paired
screen, so those three do nothing there. On a shared key they are the point. Closing
the sessions alone would not be enough, since an approved `device_pairings` row
survives it and `claim()` turns it into a fresh session afterwards. **The new session
is opened after the commit**, by the route: a blanket close run afterwards would sign
out the person who just proved the address.

**A password cannot be set on a bound account**, and the refusal lives at the
`ConfigRepo` boundary rather than on the route, because `pnpm reset-password` writes
through the repository without passing any route. The single exception is unbinding,
which requires a password in the same transaction and closes the sessions: without
the rule an administrator sets a password on a bound account and signs as that
person, and without the exception unbinding leaves an account nobody can enter. The
command performs that unbind for a bound account, and says so as it does it.

### `commenters`

A **person**, as opposed to the access key in `users`.

| Column                 | Role                                            |
| ---------------------- | ----------------------------------------------- |
| `id`                   | PK, `AUTOINCREMENT`                             |
| `email`                | `NOT NULL UNIQUE COLLATE NOCASE` — the identity |
| `display_name`         | Name used to sign comments                      |
| `notify`               | Unsubscription                                  |
| `verified_at`          | `NULL` until the code has been entered          |
| `pending_display_name` | Requested rename, pending the code              |
| `locale`               | Language this person is written to in           |

Key choices:

- **The address IS the identity.** Identifying oneself again with the same
  address, from another device or after clearing cookies, recovers one's comments
  — and the right to delete them. Without this stable key, every browser would
  create another person, and nobody could delete their own messages any more.
- **`verified_at` is not decorative.** Identity is declarative: anyone behind the
  shared access key could sign another person's name or send notifications to a
  third party's inbox. The code sent by email prevents this.
- **The code itself is not here.** It lived on this table as four columns while
  there was one thing to prove; since migration 18 it is `verification_codes`
  below. What is left here is what a person is.
- **`pending_display_name` holds a rename until proof is supplied.** The name of
  an **already verified** identity changes only when the code is validated, never
  on request: otherwise knowing someone's address would be enough to rename them,
  and because a comment signature is reread on every request, their entire history
  would change name without a single code being entered. An identity not yet
  verified is written directly — nothing is signed by it.

- **`locale` exists so an email arrives in the language its recipient reads.** It
  is recorded from `Accept-Language` on every authenticated request, and only when
  it changes (`plugins/locale.ts`). It sits here rather than on `users` because a
  username is an access key a household may share, while an address lands in one
  inbox belonging to one reader — and the interface language stays in the browser,
  which is what a shared television needs. `NULL` until one of that person's
  requests announces a supported language; the instance's `DEFAULT_LOCALE` then
  applies (D260812d). Accepting an invitation **seeds** it with the language that
  invitation was written in, and only when it is `NULL`: that first email goes out
  before any request of theirs has arrived, while a value already stored came from
  their own browser and is the authoritative one. The rule lives in the statement
  rather than in a branch above it: `CommenterRepo.seedLocale` writes
  `WHERE id = ? AND locale IS NULL`, so a caller that forgot to look first finds
  nothing to overwrite, and the guard cannot be bypassed by a second caller
  (D260819c).

`sessions` holds a `commenter_id` (`ON DELETE SET NULL`): the session
**remembers** the identity; it does not define it. Losing one's identity therefore
never removes album access, which comes only from the access key. `users` holds a
`commenter_id` of its own with the same clause, and the two answer different
questions: the session's is what this device declared, the account's is who this
account **is**.

### `verification_codes`

The six digits sent to an address. `users` carries authorisation, `commenters`
carries identity, and a code is neither: it is a short-lived proof that whoever
typed it reads a given inbox. Written **only** by `VerificationCodeRepo`
(`verification-codes.ts`).

| Column              | Role                                                                       |
| ------------------- | -------------------------------------------------------------------------- |
| `target`            | The address, `NOT NULL COLLATE NOCASE` like `commenters.email`             |
| `purpose`           | `identity`, `signin` or `invite`, and half of the primary key              |
| `code_hash`         | HMAC of the digits, on `SESSION_SECRET`                                    |
| `expires_at`        | Fifteen minutes, or seven days for an invitation                           |
| `sent_at`           | Last delivery, read across every purpose of one address                    |
| `attempts`          | Five, whatever the purpose                                                 |
| `username`          | The account an invitation is for, `NULL` otherwise, FK `ON DELETE CASCADE` |
| `locale`            | Language the message was written in, `NULL` when nobody chose one          |
| `(target, purpose)` | Composite primary key                                                      |

Key choices:

- **The purpose is part of the key rather than a flag.** A code minted for one
  flow is then not merely refused by another, it is not found by it. With one
  pending code per address, verifying an address while signing in would overwrite
  one with the other, and the fourth purpose this shape anticipates would arrive
  with nowhere to sit.
- **A second, partial unique index covers `username WHERE purpose = 'invite'`.**
  One invitation per address is not the invariant that matters; one invitation
  per **account** is. Without it, inviting `mamie` at one address and then at
  another leaves two live codes racing to bind the same account, and reminting a
  pending invitation has no single row to work from. Minting an invitation
  therefore deletes any row matching either axis before inserting, in one
  transaction: both constraints refuse a duplicate, neither replaces it, and an
  upsert can name only one of them.
- **`username` is `COLLATE NOCASE`, which is not decoration.** `users.username`
  is `NOCASE`, so a child column left on the default would let `Mamie` and
  `mamie` both satisfy that partial index and both be invitations to one account.
  `ON DELETE CASCADE` stops a deleted account leaving its code behind, where
  recreating the same username would let the original recipient bind an account
  that may now be an administrator.
- **Two `CHECK`s carry invariants nothing else states**: one restricting `purpose`
  to the three values, and one making `username` non-null **exactly when** the
  purpose is `invite`. An invitation without an account has nothing to bind, and
  a sign-in code naming one would bind it without anybody proving the address.
- **Every column but `username` is stated `NOT NULL`.** A composite primary key
  does not impose it in SQLite, where a rowid table accepts a null inside one.
- **One send a minute is per address, across every purpose.** `code_sent_at` was
  one column per person; a per-row check would let an identity code and an
  invitation reach the same inbox in the same minute, which is the mail-bombing
  the rule exists to stop. Five attempts, in contrast, are per code — and are
  enforced for `invite` exactly as for the rest, because a seven-day life is what
  makes the ceiling rather than the deadline the thing that bounds guessing.
- **`locale` is the one thing the recipient of an invitation cannot tell us.** Every
  other message goes to somebody whose browser has announced a language, recorded on
  `commenters.locale` (D260812d); an invitation is composed for a person this
  instance has never met, so whoever invites them chooses it. It lives on the code
  rather than in the request that created it because it must outlive that request:
  sending the invitation again — from `/admin` or from the address itself — repeats
  the language of the first message, and consuming the code gives it to the identity
  that has none. `NULL` means nobody chose, and `DEFAULT_LOCALE` then applies exactly
  as before.
- **The hourly purge in `main.ts`** removes what has expired. The four columns
  this table replaced were overwritten in place and accumulated nothing; a table
  does. It needs no cap of its own: a request for an address nothing knows writes
  no row.

### `comments`

A discussion thread per media item **and per album**.

| Column                   | Role                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | PK, `AUTOINCREMENT`                                                                                                                     |
| `album_id`, `media_id`   | The pair to which the thread belongs                                                                                                    |
| `parent_id`              | `NULL` for a root, otherwise the root ID — never any deeper                                                                             |
| `commenter_id`           | The **author**, FK to `commenters` `ON DELETE CASCADE` — a person, not an access key                                                    |
| `account`                | The access key used to write, `COLLATE NOCASE`, FK to `users` `ON DELETE SET NULL` — retained for moderation                            |
| `body`                   | The message. **The only column rewritten afterwards**, and only by its author within 30 s (D57)                                         |
| `created_at`             | Publication date. **Never** changes, even after a correction: the message must retain its place in a thread others were already reading |
| `hidden_at`, `hidden_by` | Moderation after publication                                                                                                            |

Structural choices:

- **`AUTOINCREMENT` rather than the ordinary rowid.** Otherwise SQLite reassigns
  the identifier of a deleted row. Notification emails contain a link to a
  comment and remain in an inbox for months: a recycled ID would make an old
  message point to someone else's conversation. This also makes ID order match
  write order, allowing sorting and pagination on a simple integer.
- **The thread belongs to the `(album_id, media_id)` pair.** The same Drive file
  indexed under two albums has two conversations. Combining them would show a
  visitor remarks made in an album they are not authorised to view, contradicting
  the isolation in [04](./04-security-and-access.md).
- **No foreign key to `media`.** `deleteStale` removes a photo as soon as a
  synchronisation does not see it again — renamed folder, interrupted sync, trip
  through the Drive bin. A cascade would destroy comments after a simple indexing
  mishap, even though the Drive identifier is stable: a returning photo recovers
  its thread. The cost is a possible orphan comment, which moderation displays
  without a file name.
- **`parent_id` uses `ON DELETE SET NULL`, not `CASCADE`.** Deleting an identity
  removes its messages (cascade on `commenter_id`), but replies written by others
  belong to them: they move to the top level rather than disappearing with it.
- **`account` uses `ON DELETE SET NULL`.** This is the access key used when
  writing, retained for moderation: it identifies which shared password a
  problematic message came through, and therefore which one to change. Deleting
  an account must not remove comments that do not belong to it — they belong to
  their author.
- **`album_id` uses `ON DELETE CASCADE`.** Deleting an album removes its comments:
  they referred to content that is no longer exposed.

### `album_subscriptions`

Who wants to be notified about new photos in an album. Written by
`subscriptions.ts`, read by `notifier.ts`.

| Column         | Role                                     |
| -------------- | ---------------------------------------- |
| `commenter_id` | The person. FK `ON DELETE CASCADE`       |
| `album_id`     | The album. FK `ON DELETE CASCADE`        |
| `state`        | `CHECK (state IN ('auto', 'opted_out'))` |
| `created_at`   | Date the album was first opened          |
| **PK**         | `(commenter_id, album_id)`               |

Two key choices:

- **A state, rather than the mere presence of a row.** Because subscription is
  automatic (D41), deleting the row when unsubscribing would recreate it when the
  album is reopened the next day — exactly what makes people hate a service.
  Subscription uses `INSERT OR IGNORE`, which leaves an existing `opted_out` row
  unchanged.
- **Verification is enforced by SQL.** Subscription uses
  `INSERT … SELECT … WHERE verified_at IS NOT NULL`: a merely declared address
  may belong to a third party, and this gallery has no reason to write to them.

### `album_visits`

Who opened which album and when. Written by `telemetry.ts` from
`routes/albums.ts`, read by the "Visits" tab in `/admin` (D260809h).

| Column       | Role                                                                         |
| ------------ | ---------------------------------------------------------------------------- |
| `album_id`   | The album opened. **No foreign key** — see below                             |
| `username`   | The access key, `COLLATE NOCASE` like `users.username`                       |
| `session_id` | The browser. A bucket for counting distinct visitors, **not a relationship** |
| `day`        | `YYYY-MM-DD` in UTC                                                          |
| `visits`     | Album openings — the first grid page, never subsequent ones                  |
| `photos`     | Photos opened in the viewer                                                  |
| `last_at`    | ISO date of the last action counted on this row                              |
| **PK**       | `(album_id, username, session_id, day)`, table declared `WITHOUT ROWID`      |

Three key choices:

- **Aggregated on write**, through an `INSERT … ON CONFLICT DO UPDATE` that
  increments the relevant counter. One row per request would produce tens of
  thousands of rows per day that would need indexing, aggregating, and purging;
  only around ten remain. What is lost is the exact time of every action, and
  therefore every intraday chart — an accepted tradeoff.
- **No foreign keys**, to either `sessions` or `albums`. Signing out destroys the
  session, and a cascade would take the viewing history with it; a deleted album
  would erase its own past traffic, which remains true. The album title therefore
  comes from an outer join and is `null` in this case, with the screen displaying
  the identifier.
- **`WITHOUT ROWID`**: the table is entirely defined by its composite primary key,
  so the implicit secondary index would serve no purpose.

What is **not** stored: no IP address, no raw user-agent, and never the opened
media item — that would be someone's viewing history in an application where an
access key is shared.

### `album_days` and `geo_places`

What happened on a given day, and where. Written by `places.ts` (derived
locations) and the administration API (manual input); `geo_places` is the
geocoder cache (`geocoder.ts`).

| Table        | Columns                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| `album_days` | `album_id` (FK `ON DELETE CASCADE`), `day`, `description`, `place`, `cells`, `updated_at`, PK `(album_id, day)` |
| `geo_places` | `cell` (PK), `label`, `fetched_at`                                                                              |

Key choices:

- **`day` is a UTC day in `YYYY-MM-DD` form**, exactly the key that `dayKey()`
  calculates in the frontend. A local day would move a 23:30 photo into another
  section, and the note would end up on the wrong day.
- **`place` and `cells` are two columns, not one.** `cells` is derived from EXIF
  and rewritten on every pass; `place` is entered manually and **takes
  precedence**. A label fixed once and for all would force a choice between never
  recalculating days and calling Nominatim again on every pass — when separated,
  recalculation is free and labels appear by themselves when they arrive (see
  [D48](./08-decisions/D48-geocoding-runs-in-the-background-and-its-cache-is-a-one.md)).
- **Recalculation never overwrites manual input.** `replaceCells` performs
  `DO UPDATE SET cells = excluded.cells` **and nothing else**: slipping an
  `excluded.description` in there would erase everything the administrator wrote
  during every hourly clean-up. A day whose positioned photos disappear from the
  index loses its `cells`; its note survives — the day still happened.
- **`geo_places.label = NULL` is not a failure.** It is a completed geocoding with
  no usable result — open sea, desert — and the row exists specifically to avoid
  asking again. A network failure writes **no row** and will be retried on the next
  pass. The cache is shared between albums: two trips to the same place count as
  one call.

`settings` holds JSON values and defaults live in the code (`defaultSettings`):
a missing key is not an anomaly, and adding a setting requires no migration.

**Memory cache.** `canSee()` is called on every media request, and therefore for
every thumbnail in a grid. `ConfigRepo` keeps an in-memory snapshot (albums,
accounts, permissions, settings), rebuilt on the first read after a write. As the
sole writer of these four tables, it cannot serve a stale snapshot.

### `media_notes`

What happens in **one** photo. The album says where people were and the day says
what they did there; "Léa jumps off the pontoon, third attempt" cannot be derived
from the file name, EXIF, or the day's note. Written by `MediaRepo`, the only class
that owns this table.

| Table         | Columns                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `media_notes` | `album_id` (FK `ON DELETE CASCADE`), `media_id` (**no FK**), `description`, `updated_at`, PK `(album_id, media_id)` |

Key choices:

- **The scope is the album, not the Drive file.** The same file indexed under two
  albums has two descriptions, just as it has two comment threads. Combining them
  would show a visitor what was written in an album they cannot open (D12).
- **No foreign key to `media`**, for the same reason as `comments.media_id` and
  `albums.cover_media_id`: `deleteStale` removes a photo as soon as a
  synchronisation does not see it again — temporarily in the Drive bin during a
  rollback, renamed folder, interrupted sync. A cascade would destroy manually
  written text that nothing can regenerate after an indexing mishap. The Drive
  identifier is stable, so a returning photo recovers its description (see
  [D83](./08-decisions/D83-a-description-per-photo-scoped-to-the-album.md)).
- **No clean-up touches it.** Neither `deleteStale`, `clearAlbum`, `pruneAlbums`,
  nor the `ON CONFLICT DO UPDATE` in `upsertMany` — the same invariant as
  `AlbumDayRepo`: a background pass never overwrites manual input. The only
  deletion comes from the cascade on `albums`, meaning deletion of the album
  itself.
- **An empty row does not exist.** `setDescription` performs a `DELETE` when the
  received value is `null`, empty, or blank: retaining it would grow the table
  without expressing anything beyond an absent row.

`listItems` and `getDetail` read the description through a
`LEFT JOIN media_notes ON (album_id, media_id)`. The `SELECT` becomes `media.*`:
both tables have an `album_id` column, and a bare star would make the row ambiguous
when read. The join is **one-to-one** on the `media_notes` primary key — it neither
duplicates nor loses rows, so cursor pagination is unchanged. This is enforced by
`packages/server/test/media-notes.test.ts`, which paginates an album where two out
of five photos have descriptions.

Videos are included, unlike for the cover: a video deserves a caption, and
nothing in the pipeline prevents it.

### The four FTS5 search tables

These make "where are the Marseille photos" searchable. They are created by
**migration 11** and read by `SearchRepo` (`search.ts`); no application code writes
to them.

| Table             | Indexed columns        | External content |
| ----------------- | ---------------------- | ---------------- |
| `albums_fts`      | `title`, `description` | `albums`         |
| `album_days_fts`  | `description`, `place` | `album_days`     |
| `media_notes_fts` | `description`          | `media_notes`    |
| `geo_places_fts`  | `label`                | `geo_places`     |

All use `content='<table>', content_rowid='rowid'` — **external content**: the FTS
table stores only the index, never a copy of the text, and joins its source table
by `rowid`.

Key choices:

- **SQL triggers maintain them, not application code.** Three per table (`_ai`,
  `_ad`, `_au`), in the documented FTS5 form: deletion uses
  `INSERT INTO x_fts(x_fts, rowid, …) VALUES('delete', …)` with the **old** values,
  the only way for FTS5 to find the terms to remove from a row that no longer
  exists. These texts are written from six places — `ConfigRepo.saveAlbum`,
  `AlbumDayRepo.upsertNote` and `.replaceCells`, `Geocoder`,
  `MediaRepo.setDescription`, and cascades on `albums`. Reindexing from code would
  require forgetting none of them, now or in any future write path; a stale index
  is invisible and merely returns fewer results
  ([D96](./08-decisions/D96-the-search-index-is-maintained-by-the-schema-not-the-code.md)).
- **The `AFTER DELETE` triggers cover cascading deletes.** Deleting an album
  removes its days and photo descriptions through `ON DELETE CASCADE`, and the
  index follows without any explicit `DELETE` — verified on
  `better-sqlite3@12.11.1` (SQLite 3.53.2), including `integrity-check`.
- **Tokenizer `unicode61 remove_diacritics 2`**: "ete" finds "été", and "nim"
  finds "Nîmes", without a manually maintained normalised column.
- **`geo_places` has no `album_id`** — it is a cache shared between albums. A
  label is attached to a day through `json_each(album_days.cells)`, leaving
  isolation to `album_days`, the only table that knows which album is involved.

## Index

| Index                                                      | Purpose                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idx_media_album_taken (album_id, taken_at DESC, id DESC)` | Chronological grid sorting and cursor resumption. SQLite traverses the same index backwards for `order=asc`, so one index covers both directions.                                                                                                                                 |
| `idx_media_id (id)`                                        | `albumsContaining(mediaId)`, called on **every** media request for access control. Without it, every thumbnail would trigger a full scan.                                                                                                                                         |
| `idx_sessions_expires (expires_at)`                        | Hourly purge of expired sessions.                                                                                                                                                                                                                                                 |
| `idx_user_albums_album (album_id)`                         | "Who has access to this album", displayed by `GET /api/admin/albums`. The reverse direction is already covered by the `(username, album_id)` primary key.                                                                                                                         |
| `idx_comments_thread (album_id, media_id, id)`             | Thread reads, the count served with media details, and the `GROUP BY media_id` returning counts for a whole album (D54) — SQLite reads the album slice already ordered by media. Sorting by `id` is sufficient because it increases over time, so there is no `created_at` index. |
| `idx_comments_parent (parent_id)`                          | Attaching replies to their root and moving them to the top level when the parent disappears.                                                                                                                                                                                      |
| `idx_comments_commenter (commenter_id)`                    | "My comments": those the current reader may delete.                                                                                                                                                                                                                               |
| `idx_album_subscriptions_album (album_id)`                 | "Who is subscribed to this album", the notifier's only read. The reverse direction is already covered by the `(commenter_id, album_id)` primary key.                                                                                                                              |
| `idx_album_visits_day (day)`                               | Both aggregations in the "Visits" tab, each bounded by `day >= ?`, and the annual purge. The primary key starts with `album_id`, so it does not serve this filter.                                                                                                                |

There is no index on `(album_id, added_at)`: new items are counted once per hour
per album, and the `(album_id, id)` primary key already bounds the scan to the
relevant album. An additional index would impose a cost on every synchronisation
for an hourly read.

There is no index for `MediaRepo.geolocatedPoints`, the locations-pass read,
either: `idx_media_album_taken` already bounds the scan to the album and returns
rows in chronological order, which clustering requires. An index on
`(album_id, lat)` would avoid only the `lat IS NOT NULL` filter for an hourly read
— the same tradeoff. `album_days` and `geo_places` are read by primary key.

## The composite primary key `(album_id, id)`

A Drive file present in two albums (typically nested folders that are both
declared) produces **two rows**. Consequences to understand:

- Metadata is duplicated. This is accepted: the cost is a few hundred bytes per
  duplicate, compared with a join on every grid read.
- `getDetail(albumId, id)` is scoped to an album; `getFileMeta(id)` is not. The
  columns it reads from `media` (`name`, `mime_type`, `kind`, `size`, `md5`,
  `has_thumbnail`, `source_path`) describe the file rather than its membership,
  and the connection it serves comes from the album it joins — but the two rows
  can **diverge** between synchronisations, when one has already seen a new
  version of the file that the other does not yet know. The selection is therefore
  `ORDER BY seen_at DESC, album_id ASC LIMIT 1`: the most recently seen row
  describes the file as it exists in Drive today. A `LIMIT 1` without sorting
  would let SQLite return the old one, and the cache would produce a derivative
  from a stale fingerprint, served under an ETag that declares it immutable.
  `album_id` breaks ties so that two consecutive calls return the same result.
- `albumsContaining(id)` returns **all** containing albums. Authorisation grants
  access as soon as one is visible to the user — this is the correct rule: the
  file is already legitimately accessible through that path.
- `deleteStale` for one album does not affect rows for the same file in other
  albums. The disk cache is indexed by file ID alone, so albums share their
  thumbnails, as intended.

## Migrations

`MIGRATIONS` is an array of SQL strings in `db.ts`. `migrate(db)` reads
`PRAGMA user_version` and applies everything that follows, each migration in its
own transaction, with a `ROLLBACK` and explicit message on failure.
`user_version` therefore means "number of applied migrations".

**Absolute rule: never modify a published migration.** Running instances have
already executed that SQL; editing it would rerun it nowhere and cause the actual
schema to diverge from the assumed schema. Every change adds an entry at the end
of the array.

`packages/server/test/migrate.test.ts` enforces the invariants: a fresh database
reaches the latest version, a version 1 database gains `revoked_at` without losing
its token or index, a version 3 database gains comments **and `users` changes by
exactly one column, migration 18's `commenter_id`, which arrives empty** — existing
access keys retain their hashes, an upgraded key stays a shared key, and open
sessions are not invalidated —, `migrate` is idempotent, and a failure leaves
`user_version` unchanged so that recovery restarts from the same step.

Current state:

| Version | Contents                                                                                |
| ------- | --------------------------------------------------------------------------------------- |
| 1       | Initial schema: `media`, `sync_state`, `oauth_token`, `sessions`, and their indexes.    |
| 2       | `ALTER TABLE oauth_token ADD COLUMN revoked_at TEXT`.                                   |
| 3       | `users`, `albums`, `user_albums`, `settings`: configuration moves into the database.    |
| 4       | `commenters`, `comments`, and their indexes; `sessions.commenter_id`.                   |
| 5       | `album_subscriptions` and its index; `sync_state.notified_at`; `media.added_at`.        |
| 6       | `commenters.pending_display_name`.                                                      |
| 7       | `album_days`, `geo_places`; `albums.group_by`.                                          |
| 8       | `albums.cover_media_id`.                                                                |
| 9       | `media_notes`: one description per photo, scoped to the album.                          |
| 10      | `media.has_thumbnail`: does Drive have a preview of this file?                          |
| 11      | The four FTS5 search tables, their triggers, and their `rebuild`.                       |
| 12      | `albums.sort_order`: the album's default reading order.                                 |
| 13      | `device_pairings`: pair a screen without a keyboard instead of typing a password.       |
| 14      | `media.video_codec`: which codec does a video's video track use?                        |
| 15      | `album_visits` and its index; `sessions.last_seen_at` and `sessions.device`.            |
| 16      | `commenters.locale`: the language this person is written to in.                         |
| 17      | `storage_connections`, from `oauth_token`; `albums.connection_id`; `media.source_path`. |
| 18      | `users.commenter_id`; `verification_codes`; the four code columns leave `commenters`.   |
| 19      | `verification_codes.locale`: the language an invitation is written in.                  |

Migration 19 is additive and touches no row: the column arrives as `NULL` on every
code, and the instance's `DEFAULT_LOCALE` keeps applying to the invitations already
pending. Nullable is the point rather than a convenience — `DEFAULT 'en'` would
freeze the language of the day into rows nobody chose it for, and "chosen" would
stop being distinguishable from "never asked", which is the difference the resend
reads. `packages/server/test/migrate.test.ts` verifies it on a version 18 database
holding an invitation: the code survives with no language, and both unique
constraints still refuse a second invitation to one account.

Migration 18 binds an account to a person and moves the code apparatus out of
`commenters`. Both halves are one migration because they are one decision:
`users.commenter_id` names the identity an account **is**, and a second use of a
code — signing in — turns the four columns D39 put on `commenters` into one column
set with two meanings. `users` carries authorisation, `commenters` carries
identity, and a code is neither, which is the sentence that stops the next reader
wondering why sign-in touches a table called `commenters`.

**Pending codes are invalidated by the upgrade**, deliberately rather than as a
side effect: codes live in SQLite and survive a restart today, so this is a
fifteen-minute cost paid once, at a moment somebody chose. `pending_display_name`
**stays** — the rule it enforces is about the name and not about the code (D42),
and dropping it would restore a rename this repository already closed. Nothing
indexes the four departing columns, so `ALTER TABLE … DROP COLUMN` applies without
recreating the table. `packages/server/test/migrate.test.ts` verifies this on a
version 17 database holding an account and an identity with a code pending: the
columns are gone, the row survives verified, the table of codes arrives empty, and
both unique constraints, the collation and the cascade hold.

**Migration 17 is the one that moves something rather than adding it**, and the
line to read twice is the one that does not appear: `ciphertext` is **copied, not
re-encrypted**. Re-encrypting would mean decrypting with `TOKEN_KEY` inside a
migration, where a wrong or missing key destroys an authorisation only new Google
consent can restore. The `drive` row is inserted **whether or not a token exists**,
because two installations depend on it — a fresh database, whose albums default to
it, and a service-account installation, which never had an `oauth_token` row at all
(D260815g). `packages/server/test/migrate.test.ts` covers both, and checks that a
version 1 database still arrives with its token intact sixteen migrations later.

Migration 16 is additive and touches no row: the column arrives as `NULL` for
every identity, and the instance's `DEFAULT_LOCALE` applies until one of that
person's requests announces a language. Nothing is backfilled — a language
inferred from an old email would be a guess, and the first request corrects it
anyway.

Migration 15 is additive and touches no rows: the table arrives empty — nothing
reconstructs past traffic — and both `sessions` columns arrive as `NULL`. A
running instance applies it without closing a session or changing an expiry: the
device of existing sessions remains unknown, and their `last_seen_at` is populated
on their next request. `packages/server/test/migrate.test.ts` verifies this on a
version 14 database containing an account, an open session, and a media item — and
also verifies that `album_visits` references **nothing**, because the absence of a
foreign key is the entire point of its shape (D260809h).

Migration 13 creates an empty table and nothing else: a running instance applies
it without changing a row or affecting any open session. It also opens no new
access path — pairing delegates an existing key, and the approving screen must
already be signed in (D260809c). `packages/server/test/migrate.test.ts` verifies
this on a version 12 database containing an account and a session.

Migration 14 is additive and has no backfill: the column remains `NULL` on all
existing rows, and the next synchronisation fills it one video at a time. See the
three `video_codec` states above — `NULL` triggers rereading, and the empty string
stops it.

Migration 12 adds the reading order, and is the only one so far that **changes the
behaviour of existing albums**: the column arrives as `'asc'`, whereas they
previously opened from newest to oldest. The opposite would have preserved an
order nobody chose — it was the only possible value while it lived in a global
constant, and it introduced a trip through its final day (D99). The owner switches
it back album by album from /admin, and each visitor does so for themselves from
the grid. `packages/server/test/migrate.test.ts` verifies this on a version 11
database containing an album: the row survives and the column arrives as `asc`.

Migration 11 makes the library searchable. It creates the four external-content
FTS5 tables described above, their twelve triggers, then runs one
`INSERT INTO x_fts(x_fts) VALUES('rebuild')` per table. **This `rebuild` is the
point of the migration**: without it, the triggers would index only subsequent
writes, and a running instance would remain silent about everything it already
contains — meaning everything for an album that is no longer edited.
`packages/server/test/migrate.test.ts` verifies this on a version 10 database
containing an album, an annotated day, a photo description, and a geocoded
location: all four are searchable after the update.

Migration 10 adds the Drive preview, set to `0` on every existing row. The default
is deliberate: an already indexed video displays no preview until the next
synchronisation fills the column — only the sync knows what Drive has. A temporary
absence is better than a burst of requests destined for a 415, one per video per
grid load. `packages/server/test/migrate.test.ts` verifies this on a version 9
database containing a video: the row survives and the column arrives as 0.

Migration 9 adds the photo descriptions table. It arrives empty and touches no
existing row: a running instance applies it without any visible change until
someone describes a photo. `packages/server/test/migrate.test.ts` verifies this on
a version 8 database containing an album and a media item — and also verifies that
the table references **only** `albums`, because the absence of a foreign key to
`media` is the entire point of its shape.

Migration 8 adds the chosen cover. It arrives as `NULL` on every row, preserving
the previous behaviour: every album continues to display its newest photo until
an administrator selects another one.

Migration 7 adds support for annotating a day and naming the location already
carried by its photos. It touches no existing data: both tables arrive empty —
`places.ts` fills them on the first pass — and `albums.group_by` arrives as
`'month'`, the grouping the URL already applied when there was no preference. A
running instance applies it without any visible change until its owner sets an
album to "day".

Migration 6 adds `commenters.pending_display_name`, empty on existing rows:
`COALESCE(pending_display_name, display_name)` therefore returns the name already
in place when the first code is validated, and nobody is renamed by the update.

Migration 5 adds two columns that arrive as `NULL` on a running database, which is
the whole point: an empty `media.added_at` excludes history from new-content
counts, while an empty `sync_state.notified_at` sets the boundary without sending.
An updated instance therefore announces **nothing** retroactively.
`packages/server/test/migrate.test.ts` verifies this on a version 4 database
containing an album, a verified identity, a media item, and a sync state.

Migration 4 separates what the application previously conflated: it creates
`commenters` and `comments` without touching a single `users` column. A running
instance applies it without affecting its access keys or open sessions.

Migration 3 creates empty tables. `bootstrap.ts` and `ConfigRepo` fill them at
startup from `config/albums.yaml` if the installation had one (see
[06](./06-configuration-and-deployment.md)) —
`packages/server/test/bootstrap.test.ts` verifies that after the update, a running
instance recovers its accounts, permissions, settings, index, and OAuth token.

## Cursor-based pagination

`MediaRepo.listItems(albumId, limit, cursor, order)` returns `limit` rows and reads
`limit + 1` to determine whether more exist, without a `COUNT`.

The cursor is `base64url("<taken_at>\u0000<id>")` — simple encoding, not a
secret. The separator is the null byte: neither an ISO date nor a Drive identifier
can contain one, whereas a space would remain a gamble on identifier shape. It is
written as `\u0000` in the source and **never literally** — a null byte makes git
classify the file as binary and stop displaying its diffs. Resumption uses:

```sql
WHERE album_id = ?
  AND (taken_at <op> ? OR (taken_at = ? AND id <op> ?))
ORDER BY taken_at <dir>, id <dir>
```

where `<op>` is `<` and `<dir>` is `DESC` for `order=desc`, or `>` and `ASC` for
`asc`. Both switch together: allowing them to differ would reread the page already
served. `order` comes from a closed union validated by zod, never from a raw string
— this makes interpolation acceptable here.

**Why not `OFFSET`.** A synchronisation may insert or delete media while the user
scrolls. With `OFFSET`, each insertion before the window shifts it: the reader
would see a photo again or skip one. The cursor identifies a **position in sort
order**, not a rank: regardless of what happens before it, the next page resumes
strictly after the last row returned. `packages/server/test/repo.test.ts` verifies
that a complete traversal produces neither duplicates nor omissions, and that an
unreadable cursor restarts from the beginning rather than failing.

The secondary sort on `id` is not decorative: without it, two photos with the same
`taken_at` (burst, bulk import) would have an indeterminate order, and the cursor
would not know which one had already been served.

### Moderation queue

`CommentRepo.listForModeration(query)` paginates on the same principle, with a
cursor reduced to the identifier: `AUTOINCREMENT` makes ID order match write
order, so there is no second field for breaking ties.

`query` carries a filter (`all`, `visible`, `hidden`), an album, a search, and the
bounds. Conditions are built **once** and used by two queries: the page and a
`COUNT(*)` returning `total`. Writing them twice would let them diverge, and the
total would report a corpus different from the one being listed. The count omits
the cursor — it is the size of the filtered corpus, not the remainder — and does
not need the album and media `LEFT JOIN` clauses, which do not change the row
count.

Search uses `LIKE '%…%'` on the body, declared name, and address, with `ESCAPE`.
**Escaping is not decorative**: `%` and `_` are `LIKE` wildcards, and without it a
search containing `%` would return the entire corpus, while `_` would replace any
character — it would search for something other than what was entered without any
indication.

`hideAllFrom(commenterId, by)` and `showAllFrom(commenterId)` process all messages
from an identity at once and return the number of affected rows. The
`AND hidden_at IS NULL` clause (or `IS NOT NULL`, respectively) preserves the date
of an already hidden message: the date of the original decision matters, following
the same rule as an individual action.

**No index was added for these queries** (D67). A `LIKE '%…%'` search is a scan no
index can serve, the corpus is bounded by what humans write, and
`idx_comments_thread` continues to cover the gallery's hot path. Revisit beyond
tens of thousands of comments.

### Activity feed

`CommentRepo.listFeed(query)` serves the visitor's activity drawer: the same
identifier cursor and reverse-chronological page, but restricted to albums the
visitor is authorised to view.

**`albumIds` is the only isolation barrier**, and it comes from `albumsFor()` —
never from the request. An empty list returns an empty page, not the whole corpus:
the latter is what a forgotten `IN ()` would produce, and this is the first case
covered by the test.

Again, **no new index** (D82). `ORDER BY c.id DESC` follows primary-key order:
SQLite traverses the table backwards and stops at the `LIMIT`. An
`(album_id, id DESC)` index would do no better — SQLite cannot merge the order of
several `IN` slices, so it would then have to sort. The unfavourable case is known
and accepted: an account that sees only one album out of fifty must traverse the
comments from the other forty-nine before collecting its page.

## What is not in the database

- Image derivatives: files on disk under `CACHE_DIR`, inventoried in memory at
  startup.
- Login throttle counters: in memory, lost on restart — deliberately (see
  [08](./08-decisions/)). Bounded in number and purged hourly; otherwise a burst of
  invented usernames would make them grow without limit.

## Columns written and never read

Three columns appear in no read query. They are **retained** — SQLite removes a
column only by recreating the table, which is not worth the benefit on a running
database (see
[D28](./08-decisions/D28-three-columns-written-but-never-read-are-retained.md))
— and `db.ts` explains their purpose:

| Column                               | Why it remains                                                                                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `media.modified_time`                | Chronological marker from which `taken_at` is derived as a last resort; allows recalculation without reindexing.                                                                   |
| `storage_connections.settings.scope` | Consented scope of a Drive connection: when `SCOPES` changes, it will show whether the stored token still covers what is requested. It was `oauth_token.scope` until migration 17. |
| `sessions.created_at`                | Only trace of a session's age — the first question asked after suspicious access.                                                                                                  |

Accounts, albums, and settings, however, **have been in the database** since
migration 3. `config/albums.yaml` now serves only to bootstrap a fresh
installation. Operational consequence: the `lukarn-data` volume now contains the
accounts, and is the only thing that needs backing up.
