---
code: STR
status: done
version: v1.0
amended: [v1.1, v1.2]
created: 2026-08-02
builds-on: GAL
---

# Lukarn — STR specification

STR covers the read-only storage abstraction, all four storage backends (Google Drive, local folder,
S3-compatible bucket, and WebDAV server), media indexing and metadata extraction, disk caching, and
image/video rendering. It builds on [GAL](GAL.md), whose rules all still apply. It predates the
spec delivery process, so it has no plans, and describes the application as it stands.

## Storage interface and multi-connection model

- All storage backends implement a single strictly read-only `StorageProvider` interface with three
  runtime operations (`list`, `fetch`, `preview`) plus `probe` and `guard` (D260815f).
- An instance can hold multiple named `storage_connections` rows of any supported kind
  (`drive`, `local`, `s3`, `webdav`), each storing non-secret settings in clear JSON and encrypted
  credentials in `ciphertext` (D260815g).
- Every album references exactly one `connection_id`; changing an album's `connectionId`,
  `folderId`, or `recursive` flag purges that album's indexed media and starts a fresh sync (D26).
- Deleting a storage connection that is still referenced by at least one album is refused.
- Connection identifiers (`id`) are derived slugs that never change once created (D260816h).

## Supported backends

- **Google Drive** (`drive`):
  - Supports either a service account (`GOOGLE_SERVICE_ACCOUNT_FILE`, taking precedence and seeing
    only folders shared with its address, returning 409 on OAuth start/disconnect) or OAuth 2.0
    consent (`drive.readonly` + `userinfo.email`, encrypted refresh token) (D46).
  - Uses stable Drive file IDs (`refKind: 'identity'`) so comments and links survive folder moves
    and renames; ignores Drive shortcuts to avoid loops; receives EXIF and `thumbnailLink` from
    `files.list` without downloading originals during sync (D3, D260816c).
  - Detects `invalid_grant` revocations (marking `revoked_at` and failing fast until reconnected)
    and retries transient `429`/rate-limit `403` responses with exponential backoff (excluding
    `downloadQuotaExceeded` and permission 403s).
- **Local folder** (`local`):
  - Available only when `STORAGE_LOCAL_ROOT` is set in the environment; connections pick a
    relative subpath (rejecting absolute paths and `..`).
  - Re-validates `realpath` against `STORAGE_LOCAL_ROOT` on configuration, listing, and fetch,
    dropping any symlink escaping the root before it can enter the index (D260816d).
  - Serves `Range` requests directly from disk streams and uses `size:mtimeMs` as version.
- **S3-compatible bucket** (`s3`):
  - Connects via endpoint, bucket, optional prefix, and read-only access/secret key pair using an
    in-tree AWS SigV4 signer and XML parser with zero SDK dependencies (D260816e).
  - Signs the client `Range` header when present and uses `delimiter=/` for folder listings;
    excludes RAW extensions since buckets provide no fallback previews.
- **WebDAV server** (`webdav`):
  - Connects via base URL, root folder, and credentials (HTTP Basic, HTTPS recommended, HTTP
    allowed on private networks); strips query strings, fragments, and embedded userinfo from URLs
    and rejects `.` / `..` segments to fence reads to the root (D260816f).
  - Lists collections via `PROPFIND` `Depth: 1` and maps paths (`refKind: 'path'`) into the index.

## Synchronisation and metadata indexing

- Synchronisation runs at startup (`syncOnStartup`), on a configurable interval
  (`syncIntervalMinutes`, `0` disables), manually via `/api/admin/resync`, after OAuth consent, and
  when an album is created or its source scope changes.
- Albums synchronise sequentially (max 5000 folders per album, batch commits of 500 rows) to
  respect Drive quotas; a `StorageRevokedError` aborts remaining albums on that connection without
  blocking other connections (D27).
- Interrupted syncs keep already committed batches and leave `lastSyncAt` at the previous complete
  pass while setting `syncStatus: 'error'` (D27).
- For non-Drive backends, capture date, orientation, dimensions, camera EXIF, and GPS coordinates
  are extracted from a single 64 KB header window (JPEG `APP1` or HEIC `meta`/`iinf`/`iloc`) once
  per unchanged file version (D260816b).
- For videos across all backends, MP4 top-level boxes are traversed via up to four 64 KB `Range`
  windows to extract recording date and video-track codec (`avc1`, `hvc1`, `hev1`) once per
  unchanged version, falling back to filename timestamps and modification time (D6, D97).
- Three write-only audit/compatibility columns are retained rather than dropped:
  `media.modified_time` (chronological fallback when EXIF is absent), OAuth `scope` (stored in
  `storage_connections.settings`), and `sessions.created_at` (session age audit trail) (D28).

## Media rendering, caching, and video transcoding

- Thumbnails (`320`, `640`, `1280` WebP) and viewer variants (`full` ≤ 2560 px, `hd` ≤ 4096 px) are
  generated on demand with `sharp` without upscaling beyond source dimensions (D19, D260809g).
- Concurrent `sharp` decodes are throttled by a semaphore (`cpus - 2`, bounded 2–4) acquired
  before downloading originals (D32); originals exceeding 80 MB or un-decodable formats (HEIC/RAW
  where libvips lacks support) fall back to `provider.preview()`, never exposing upstream URLs.
- Video posters use `provider.preview()` first (Drive) and fall back to cutting a still frame via
  `ffmpeg` (D92); if neither succeeds or if `full`/`hd` is requested on a video, the media route
  returns `415`.
- Transient storage timeouts (120 s on content downloads, disabled on `Range` video relays) and
  rate-limit failures return `503` with `Retry-After`, never `500` and never cached (D60).
- Derivatives live in `CACHE_DIR` (256 hash-sharded subdirectories) with an in-memory size index
  loaded at startup (`MediaCache.load()`) and background LRU eviction down to 90% of
  `cacheMaxSizeGB` (re-checking access stamps before `unlink` and logging failed removals).
- Prepared playable H.264 MP4 videos (transcoded from `hvc1`/`hev1` in the background by `ffmpeg`
  at low priority, single-threaded, capped to source bitrate via `-maxrate`/`-bufsize`) use a
  separate `CACHE_DIR/video` store and `videoCacheMaxSizeGB` LRU budget (D6, D260809g).
- Optional background thumbnail prewarming (`prewarmCache`, skipped when no storage is connected)
  renders all three thumbnail widths from one original download, running after sync and during
  hourly housekeeping (D45, D58, D61).
