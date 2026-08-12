# D60 — A Drive download has a deadline, except when relaying a video

**Context.** `DriveService.send()` called `fetch` without an `AbortSignal`. Node
then inherits undici's default: **five minutes**. But the render limiter slot is
taken **before** the download — deliberately, because the original in memory is
what weighs heavily (D32). Two stalled downloads on a dual-core VPS therefore
freeze all renders for five minutes, which is indistinguishable from a permanent
block in the browser. This was the initial diagnosis of a cold album's slowness,
and it was wrong in that particular case — but the mechanism did exist.

**Choice.** `AbortSignal.timeout(120_000)` on content downloads, **and only those**.
The discriminator already exists: `send(url, token, range?)`.

- **Without `range`** — downloading an original to produce a derivative, bounded
  by `MAX_DECODE_BYTES` (80 MB): deadline. 120 s covers 80 MB over a slow line and
  leaves considerable headroom for the common case of around ten megabytes.
- **With `range`** — relaying a video to the browser, which consumes it at its own
  pace: **no deadline**. `AbortSignal.timeout` is a _total_ deadline, not an
  inactivity timeout; it would stop playback after two minutes.

**Fallback has three layers**, and that is the real decision — a deadline alone
merely turns a wait into an empty tile.

1. **The Drive preview**, already in place: the `catch` in `build()` falls back
   to `thumbnailLink`, which weighs a few kilobytes where the original weighs
   eight million. On a saturated line, this is precisely what is most likely to
   get through.
2. **A 503 with `Retry-After`, never a 500.** `DriveUnavailableError`
   distinguishes the transient — deadline exceeded, rate limited beyond the
   retries — from the permanent, a format that libvips cannot decode. A 500 says
   "broken" and causes the client to give up; a 503 says "come back". No cache
   header accompanies a failure: nothing is stored, so the next request genuinely
   retries.
3. **Two retries in the thumbnail, with a doubled and jittered delay.** Without
   them, the 503 would be useless: an `<img>` does not retry by itself, and the
   tile would remain empty until the page reloaded. The jitter is not cosmetic —
   thirty thumbnails fail together on a cold grid, and synchronised retries would
   again saturate the same six connections (D59).

**Rejected.** _One deadline for all Drive traffic_: it would stop video, the kind
of regression only seen in production while watching a film. _A server-side
retry_: it would hold the limiter slot longer, worsening exactly what is being
fixed. _Taking the limiter slot after the download_: the original would then sit
in memory without being accounted for, precisely what D32 rejected. _A global
error banner_ when many thumbnails fail: machinery for a state the retries clear
on their own.

**Consequences.** The worst case becomes 240 s — the original and then the Drive
preview both stalling — compared with 600 s previously. One constant governs
both, deliberately: a preview would deserve a shorter deadline, but two settings
for a gain of a few seconds in an already rare case are not worth the complication.
An `<img>` does not know the received status code, so both retries also happen on
a 404, costing two unnecessary requests for media that has genuinely disappeared
— this is rare, and the opposite would cost far more.
