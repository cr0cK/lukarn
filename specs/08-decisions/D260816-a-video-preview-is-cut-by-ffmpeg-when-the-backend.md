# D260816 — A video preview is cut by ffmpeg when the backend holds none

**Context.** [D92](./D92-a-video-preview-comes-from-drive-not-local-decoding.md)
gave every video a tile by serving the preview Drive produces from its first
second, and explicitly **rejected extracting a frame with ffmpeg** on the grounds
of [D6](./D6-no-video-transcoding.md) — a modest VPS has no CPU to spare.

Three of that decision's four load-bearing facts have since changed.

- **ffmpeg is already in the image and already runs.** D6 was reopened by
  [D260809b](./D260809b-video-transcoding-rejected-by-d6-becomes-viable-with.md),
  which transcodes HEVC videos in the background, reniced, one at a time. The
  binary is installed, the seam that runs it exists, and the cost of one still is
  a rounding error beside the ten CPU minutes a transcode already spends.
- **Drive is no longer the only backend.** A local folder, a bucket and a WebDAV
  server hold files, not previews of them: `preview()` answers `null` for all
  three. Under D92 that meant _no video in such an album had a tile at all_ —
  not one in twenty-five, as before D92, but every single one.
- **`media.has_thumbnail` stopped being able to answer the question.** It records
  what the storage said at sync time, and outside Drive it says no. The media
  route refused before rendering on that column, so it would have refused every
  poster on every non-Drive album before ffmpeg was ever asked.

**Decision.** The **renderer** owns a video's poster, as a chain: the preview the
backend holds, then a still cut from the video by ffmpeg, then `NoPreviewError`.
`routes/media.ts` no longer reads `has_thumbnail`; it translates that error into
the same 415 as before.

The still is `-ss 1 -frames:v 1`, one second in — recordings routinely open on a
black frame while the sensor settles, and a grid of black tiles is worse than the
grey one it replaced. It is produced through the existing `FfmpegRunner` seam in
`media/transcode.ts`, so tests never call the binary, and it is stored **in the
image cache** under the same key as any other derivative rather than in the
bounded store of playable videos: it is one WebP among thousands, evicted by the
same LRU.

`has_thumbnail` keeps its meaning — what the storage holds — and stays truthful.
What widened is `MediaItem.hasPreview`, which the interface reads to decide
whether to request an image: it now means _an image can be obtained_, which for a
video is "the backend holds one, or a still can be cut". Without that widening
the server would produce a poster no browser ever asks for.

**Consequences.**

- **A Drive video Drive never processed now gets a tile**, where it previously
  got a 415. It costs one download and one ffmpeg run, cached thereafter.
- **A poster costs a full download**, because `moov` may sit at the end of the
  file and a partial one yields nothing. This is why prewarming does it: the
  wait belongs to a background pass, not to somebody opening an album. It is
  capped at two minutes, since the still runs inside a render slot and a stalled
  storage would otherwise hold one of the four while a grid of photos waits.
- **Without ffmpeg nothing changes.** `hasPreview` stays false, prewarming skips
  the video rather than downloading it hourly to fail on the same missing binary,
  and the route answers 415 exactly as before.

**Rejected.** Having the **indexer** write `has_thumbnail = 1` for every video
when ffmpeg is available, leaving the route untouched. It is one line shorter and
it makes the column describe this container rather than the storage: the day
ffmpeg leaves the image, every video row is stale, the route stops refusing, and
a reader gets a failed render instead of a stated refusal — correctable only by a
full resync.

Also rejected: reading only the first megabytes of the video to cut the frame
from. It works for files written `moov`-first and silently produces nothing for
the phone recordings that put it last, which is most of them.
