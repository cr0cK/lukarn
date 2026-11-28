# D92 — A video poster is the storage's preview, then a still cut by ffmpeg

**Confidence.** observed — media/transcode.ts, git ls-files → exit 0 · 2026-08-23

**Context.** A video had no image. `serveRendered` answered 415 whenever
`kind !== 'photo'`, prewarming skipped it, the grid showed a grey tile with a play
icon, and the viewer opened on a black rectangle while the stream started. In a
holiday album where one shot in twenty-five is a video, one tile in twenty-five
said nothing about its contents.

Drive is generous here and the other backends are not. `files.list` exposes a
preview of the first second through `thumbnailLink`, at no download cost. A local
folder, a bucket and a WebDAV server hold files, not previews of them, and
`preview()` answers `null` for all three — so an album read from one of them would
have had no video tile at all, not one in twenty-five.

**Decision.** The **renderer** owns a video's poster, as a chain: the preview the
backend holds, then a still cut from the video by ffmpeg, then `NoPreviewError`.

`render(..., 'poster')` skips downloading the original when the backend has a
preview; without that shortcut a 48 MB MP4 would be fetched and then discarded by
`MAX_DECODE_BYTES` for every thumbnail, which is the cost being avoided. The still
is `-ss 1 -frames:v 1`, one second in — recordings routinely open on a black frame
while the sensor settles, and a grid of black tiles is worse than the grey one it
replaces. It goes through the `FfmpegRunner` seam in `media/transcode.ts`, so tests
never call the binary, and it is stored **in the image cache** under the same key
as any other derivative rather than in the bounded store of playable videos: it is
one WebP among thousands, evicted by the same LRU.

`routes/media.ts` does **not** decide this. It translates `NoPreviewError` into the
same 415 as before, and reads no column to get there.

**`media.has_thumbnail` keeps its meaning and stays truthful**: what the storage
said it held at sync time, which outside Drive is no. What widened is
`MediaItem.hasPreview`, the field the interface reads to decide whether to request
an image at all. It means _an image can be obtained_ — the backend holds one, or a
still can be cut — and without that widening the server would produce a poster no
browser ever asks for.

The viewer's `poster` is the 1280 thumbnail already in the disk cache and often in
the browser cache, so the black rectangle disappears with no extra request.

Scope stops at the grid thumbnail and the poster. No hover playback, and no
extraction of a chosen frame.

**Consequences.** Prewarming prepares videos too. One with a backend preview costs
**less** than a photo — a few dozen KB instead of several MB of original. One
without costs a **full download**, because `moov` may sit at the end of the file
and a partial fetch yields nothing; that is precisely why prewarming does it, so
the wait belongs to a background pass rather than to somebody opening an album. It
is capped at two minutes, since the still runs inside a render slot and a stalled
storage would otherwise hold one of the four while a grid of photos waits.

**Without ffmpeg in the image, nothing changes for a backend holding no preview**:
`hasPreview` stays false, prewarming skips the video rather than downloading it
hourly to fail on the same missing binary, and the route answers 415 exactly as
before.

Two 415 responses remain, and they are precise: `full` or `hd` on a video, and a
poster neither route could produce. The front end normally reaches neither, because
`MediaItem.hasPreview` says in advance whether there is an image to ask for.

**The album cover still rejects a video**, for a reason that survived the widening:
a poster can be absent — no preview on the backend and no ffmpeg in the image — and
the cover is the only image whose absence shows from the home page with no
fallback. [D80](./D80-an-album-cover-is-chosen-on-the-photo-and-falls-back.md) only
covers a photo that has left the index.

**Rejected.** Having the **indexer** write `has_thumbnail = 1` for every video when
ffmpeg is available, leaving the route untouched. One line shorter, and it makes the
column describe this container rather than the storage: the day ffmpeg leaves the
image, every video row is stale, the route stops refusing, and a reader gets a
failed render instead of a stated refusal — correctable only by a full resync.

Reading only the first megabytes of the video to cut the frame from. It works for
files written `moov`-first and silently produces nothing for the phone recordings
that put it last, which is most of them.

Requesting the backend's preview on every request without storing it in the disk
cache, which would make every grid tile depend on a network call where the existing
cache already treats a poster like any other WebP derivative.

Displaying the preview with no play badge, which would leave a video
indistinguishable from a photo until clicked.
