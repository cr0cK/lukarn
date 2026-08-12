# D3 — Indexing without downloading

**Context.** Indexing thousands of photos must neither take hours nor exhaust the quota.

**Decision.** `files.list` with
`fields: id, name, mimeType, size, modifiedTime, md5Checksum, imageMediaMetadata,
videoMediaMetadata` — dimensions, EXIF date and camera data arrive in the listing
response. No photo data is downloaded during a synchronisation.

**Rejected.** Downloading each file to extract its EXIF data with `exifr` or sharp:
gigabytes of data transfer for metadata that Drive already provides.

**Consequences.** This depends on the quality of the EXIF data seen by Drive. When it is
missing, `takenAt` falls back to `modifiedTime` and `takenAtFromExif` is `false`, which
the information panel reports honestly ("Modified on" rather than "Taken on").
