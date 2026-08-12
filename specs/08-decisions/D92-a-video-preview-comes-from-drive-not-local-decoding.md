# D92 — A video preview comes from Drive, not local decoding

**Context.** A video had no image. `serveRendered` responded with 415 whenever
`kind !== 'photo'`, prewarming skipped it, the grid displayed a grey tile with a
play icon, and the viewer opened on a black rectangle while the stream started.
In a holiday album where one shot in twenty-five is video, one tile in twenty-five
said nothing about its contents.

The justification was one word: [D6](./D6-no-video-transcoding.md) — no
transcoding, since ffmpeg consumes CPU unavailable on a modest VPS.

**Decision.** Serve as the video thumbnail **the preview Drive produces from its
first second**, exposed by `thumbnailLink`. Nothing is decoded locally and D6
remains intact: this is the field `MediaRenderer.downloadDriveThumbnail()`
downloads from the source to handle HEIC files libvips cannot read — a path
already in service, not invented for this occasion.

Three pieces make it safe:

- **`media.has_thumbnail`**, filled by sync from `hasThumbnail` in `files.list`.
  Drive does not always have a preview — exotic codec or a file uploaded seconds
  ago — and without this column the grid would request an image doomed to a 415
  on every page load.
- **`render(..., 'poster')`**, which skips downloading the original. Without
  this shortcut, a 48 MB MP4 would be fetched and then discarded by
  `MAX_DECODE_BYTES` for every thumbnail: precisely the cost being avoided.
- **The viewer's `poster`**, the 1280 thumbnail already in the disk cache and
  often in the browser cache. The black rectangle disappears without another
  request.

Scope stops there: grid thumbnail and poster. No hover playback and no extraction
of a chosen frame — both require decoding.

**Consequences.** Prewarming also prepares videos with a preview, and a video
costs **less** than a photo: a few dozen KB of preview instead of several MB of
original. The two remaining 415 responses are precise — `full` or `hd` on a
video, `thumb` on a video without a preview — and the frontend normally never
reaches them because `MediaItem.hasPreview` says beforehand whether an image can
be requested.

**The album cover continues to reject video**, but for a different reason: the
problem is no longer a missing render, but that the preview belongs to Drive. It
may be absent from a re-encoded file, and the cover is the only image whose
absence is visible from the home page with no fallback —
[D80](./D80-an-album-cover-is-chosen-on-the-photo-and-falls-back.md) only
covers a photo leaving the index.

**Rejected.** Extracting a frame with ffmpeg — D6, and the cost is the same for a
thumbnail or a stream: decoding is required. Also rejected: requesting Drive's
preview each time without storing it in the disk cache, making every grid tile
depend on a network call where the existing cache already treats a thumbnail like
any other WebP derivative. Finally: displaying the preview without a play badge,
which would make video indistinguishable from a photo until clicked.
