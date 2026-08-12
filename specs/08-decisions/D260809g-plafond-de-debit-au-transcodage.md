# D260809g — A derivative can no longer be larger than its source video

**Context.** [D260809b](./D260809b-transcodage-video.md) anticipated a derivative
1.5 times smaller than its source, and the first production batch did yield that
figure: 1,234 MB of originals for 818 MB of output across twenty videos. The
average concealed a case nobody had considered — **three of those twenty
derivatives were larger than their originals**:

| Source         | H.264 derivative |
| -------------- | ---------------- |
| 30.3 MB — 12 s | 35.5 MB          |
| 34.0 MB — 13 s | 37.5 MB          |
| 50.1 MB — 20 s | **66.8 MB**      |

This is the normal behaviour of `-crf`: a **variable** bit rate, with no upper
bound. On a busy scene — handheld footage of foliage, the worst case already
identified by D260809b — x264 spends whatever is needed to maintain the requested
quality, leaving an already well-encoded phone HEVC far behind. The store then
keeps a file that costs disk space **and** bandwidth without providing anything
in return.

**Decision.** The video bit rate is capped based on that of the source,
calculated from the file actually downloaded: `-maxrate` uses the room left by
audio and the container, with `-bufsize` at twice that value. CRF 23 remains:
together, they form what x264 calls constrained CRF — target the quality and
clip only when it costs more than the cap.

The cap therefore affects only pathological cases. The other seventeen videos
in the same batch were far below their source and are encoded exactly as before.

**The cap is 0.95 / 1.15 of the source bit rate, not 1.** Two adjustments are
stacked, and each is measured:

- **5% for the container** — the MP4 header and the index that `+faststart`
  moves to the front. Targeting the source bit rate exactly would produce a file
  slightly larger than the source.
- **15% for x264 overshoot** — the adjustment missing from the first version of
  this decision. `-maxrate` is not a cap on the average: it is a VBV constraint
  over the `-bufsize` window, which the encoder exceeds when the source is too
  difficult for the allotted bit rate. Measured with ffmpeg 7.1 using
  `veryfast`: **+9 to +10%** on a realistic source and **+14%** on pure noise,
  the theoretical worst case.

Without the second adjustment, the container margin alone allowed the
derivative to grow larger than its source again — the cap would have failed in
exactly the case for which it exists. For the 50.1 MB file in the table, 5%
alone allowed 52.3 MB of output; together, the two adjustments cap it at 47.5 MB
in the worst case and about 44 MB with the overshoot actually observed.

**Duration comes from the index, size from the disk.** `durationMs` crosses the
`Transcoder` interface because it is the only one of the two values the producer
cannot obtain without another `ffprobe`. The size, by contrast, is measured on
the received file rather than read from the index: this is what ffmpeg will
actually encode, and Drive sometimes reports no size or a stale one.

**Rejected — discarding a derivative larger than its source.** This was the
natural reaction, but it defeats the feature: the video becomes unplayable
again, leaving only the Download button from
[D79](./D79-une-video-illisible-le-dit-et-se-laisse-telecharger-au-lieu.md).
What is being bought is playability, not a smaller file — D260809b already says
so. It would also have required a persistent marker in the database, and
therefore a migration; without one, the hourly pass would encode the file again
each time only to discard it every time.

**Rejected — raising CRF or dropping to `-preset medium`.** Both save space
everywhere, including on the seventeen videos that have no problem: one degrades
a picture that was fine, while the other doubles processor time. The flaw is
local to three files, so the remedy must be local too.

**Consequences.** On a very busy scene from a high-bit-rate source, the picture
is slightly worse than before this change — that is the cost, paid only where
the derivative would have exceeded its source. The cap at 0.83 of the source bit
rate applies slightly more broadly than the three cases in the table: the two
videos from the same batch that came out at 86% and 98% of their originals are
affected too. This is deliberate — a derivative at 98% of its source is no more
valuable than the ones being corrected.

Below 500 kbit/s, no cap is applied: a very short source or an incorrectly
reported duration would produce an absurd cap, and 1080p constrained that low
would be unwatchable. A slightly large derivative is better than one that cannot
be watched. A video whose index has no duration is treated the same way and
falls back to CRF alone, which is the previous behaviour.

**The three derivatives already produced are not regenerated.** Their store key
depends only on the file and its fingerprint, not on the encoding arguments:
they remain available as they are until eviction or a content replacement on
Drive. Regenerating them would require knowing the arguments used for each one,
information that is not stored — for three files and 40 MB, that is one column
too many.
