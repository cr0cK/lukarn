# D260815f — A storage interface, and Drive as its first implementation

**Context.** `packages/server/src/drive/` spoke to the Google Drive API directly,
and everything downstream spoke Drive with it. `Syncer` held a `drive_v3.Drive`
and read `Schema$File` fields; `MediaRenderer` built a `thumbnailLink` URL and
fetched it itself; `VideoTranscoder` and `GET /api/media/:id/original` called
`fetchFile`. Five error classes carried Drive in their names, and three HTTP error
codes carried it in their payloads.

Nothing about that was accidental: there was one storage, and naming it was
honest. [01](../01-vision-and-scope.md) nevertheless recorded that a second one
was intended, and named what it would cost — an interface where `drive/service.ts`
sat, a way for an album to record which storage it belongs to, and a migration for
the single-row `oauth_token` table. This is the first of the three.

The measurement that made it small: **exactly three operations reach the
storage.** Listing a container's metadata during synchronisation, reading bytes
with an optional `Range`, and fetching a preview the backend already holds.
Everything else — the SQLite index, the disk cache, the renderer, the justified
grid, prewarming, transcoding, access control — was already storage-neutral, and
had been since [D2](./D2-local-index-rather-than-on-the-fly-drive-calls.md) put an
index between Drive and every read.

**Decision.** `StorageProvider` (`storage/provider.ts`) declares those three
operations plus `probe()` for /admin and `guard()` for failure translation.
`storage/drive.ts` implements it; `sync/` consumes it. The listing crosses the
boundary as `StorageEntry` — a backend-native `ref`, a `folder` flag, a `version`
(whatever the backend guarantees changes with the bytes), and `media`, the
pre-parsed metadata **or `null`**.

That last null is the load-bearing part of the design. Drive is unusual in
returning EXIF data inside `files.list` and holding a JPEG preview for files it
cannot otherwise show; a folder on a disk does neither. Modelling both as nullable
answers rather than as guarantees is what lets a second backend exist without the
indexer or the renderer growing a branch per kind: `media: null` means "read the
bytes yourself", `preview()` returning `null` means "there is nothing here to fall
back to".

The error taxonomy is renamed one-for-one — `StorageNotConnectedError`,
`StorageKeyMismatchError`, `StorageNotConfiguredError`, `StorageRevokedError`,
`StorageUnavailableError` — with the message, not the class, carrying the Drive
wording. `routes/media.ts` follows: `drive_revoked`, `drive_disconnected` and
`drive_unavailable` become `storage_revoked`, `storage_disconnected` and
`storage_unavailable`.

**Rejected.** _Waiting for the second backend to extract the interface_ is the
usual advice, and it assumes the second backend is what teaches the shape. Here
the shape was already known — three call sites, listed above — and the cost of
waiting is that the extraction lands in the same pull request as a new backend,
where a reviewer can no longer tell a refactor from a feature.

_A provider that also owns the index_ — one object per backend, holding its own
sync and its own cache — was rejected for the opposite reason: it would multiply
by four what only ever needed one implementation. The index is the same table
whatever produced its rows.

_Letting the provider `guard()` itself_, so callers stop wrapping, reads better at
every call site and loses the property that matters: an authorisation may be
withdrawn between the moment a call is prepared and the moment it fails, and only
the caller knows which unit of work to abandon — a whole album's sync, or one
thumbnail.

**Consequences.** `guard()` coverage stopped being uneven, which fixed a real
defect: `/original` and both preview paths in `MediaRenderer` were **not** wrapped,
so a revoked token surfaced there as a bare 500 rather than the 503 the front end
knows how to retry. Rewriting those call sites was the occasion to notice.

Test fakes shrank. A fixture for synchronisation used to reproduce Drive's
behaviour — `api().files.list` answering a `q` clause parsed with a regular
expression; it is now a function returning entries. The renderer's fakes lost
`api()` and `fetchAuthorized` and kept two functions.

`api()` is `protected` rather than private, joining `accessToken` and `delay` as a
declared test seam, and `packages/server/test/storage-drive.test.ts` uses it to
hold the new translation to account: the fingerprint reaching `version`, the
rotation flag, `null` metadata staying `null`, the page token relayed opaquely,
and the preview fetched at the requested size **with** its `Authorization` header.

Nothing else changed. The API kept every route and payload, the schema kept every
column, and `md5` remains the column name behind `StorageEntry.version` — renaming
it is a migration, and this pull request has none. What a person sees is
unchanged, which is why `CHANGELOG.md` has no entry for it.
