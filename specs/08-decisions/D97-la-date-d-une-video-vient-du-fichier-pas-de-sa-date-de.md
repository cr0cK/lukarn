# D97 — A video's date comes from the file, not its upload date

**Context.** An import of forty videos was grouped entirely under "Today".
Drive exposes no capture date for video — `videoMediaMetadata` is limited to
`{width, height, durationMillis}`, while `imageMediaMetadata` carries a photo's
full EXIF. `toUpsert` therefore fell back to `modifiedTime`, the upload time:
forty rows with `taken_at_from_exif = 0` and the same second, for files recorded
over eight days. The by-day grid, the default view, became false for an entire
trip.

**What could not be reused.** Drive transcoding: the v3 API exposes no transcoded
stream, and `https://drive.google.com/file/d/<id>/preview` responds with 401
without a Google session — embedding it would require publicly sharing files.
`thumbnailLink` carries no metadata.

**Choice.** The file is the source, read without downloading it. The start of the
container is traversed with `Range` requests: `drive/mp4.ts` follows the chain of
top-level boxes from offset 0 to `moov`, whose `mvhd` carries the recording date.
At most four 64 KB windows, 2.3 on average across the forty real files, with
40/40 resolved.

`resolveVideoTakenAt` (`drive/metadata.ts`) then chooses between sources in order
of confidence:

1. **A timestamped name corroborated by the container** — `YYYYMMDD_HHMMSS`
   within 26 h of the file's `creation_time`. It carries the device's local time
   at recording start, exactly the convention of photo EXIF.
2. **The container alone**, minus duration: its header is written when recording
   stops, not when it starts.
3. **The name alone**, for a container that cannot be opened.
4. **`modifiedTime`**, the only case leaving `taken_at_from_exif` at 0 — the
   panel then says "Modified on", exactly what is known.

**Nothing here is specific to a timezone or format.** No offset is assumed,
calculated, or stored: the rule chooses between two sources and corrects neither.
This is necessary because devices write `creation_time` in different clocks —
local time on some, UTC on others — and the container does not say which. The
26 h tolerance is not an hourly constant: it exceeds the largest real offset on
Earth (±14 h) plus a recording, and only rejects a name unrelated to the file. A
manually renamed `.webm` or `.avi` falls to 3 or 4 without special handling.

**Rejected.** Scanning bytes for the `moov` signature instead of following
sizes. It fails on real files: thirteen of forty contain an old `moov` neutralised
as `free`, still holding a complete `mvhd` dated months earlier, while the real
`moov` is elsewhere. Following the chain from offset 0 is the only safe boundary.

Also rejected: rewriting dates in a migration. Synchronisation upserts every file
again, so a resync is enough — and a migration would have to guess what no column
contains.

**Consequences.** A video already dated from its file whose `md5` is unchanged
keeps its date without rereading a byte (`MediaRepo.fileTakenAt`): an album resync
costs no more than before. A video still using `modifiedTime` — unreadable header
or temporarily unavailable Drive — is retried on the next pass because
`taken_at_from_exif` controls the shortcut. A read failure never fails sync; only
revoked authorisation propagates, because otherwise an entire album would be
dated from the wrong source before anyone noticed.

`moov` also carries GPS (`udta/©xyz`) and device model; neither is currently used,
but the door is open.
