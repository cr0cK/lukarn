# D98 — Decoding that fails without an error, and one spinner too many

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** Of those same forty videos, twenty-seven use HEVC (`hvc1`). Chromium
decodes the AAC track and ignores the video track: sound plays, no image arrives,
`videoWidth` remains 0, and `totalVideoFrames` remains 0 — with **no `MediaError`
emitted**, because the container and audio track are valid. The fallback in
[D79](./D79-an-unplayable-video-says-so-and-can-be-downloaded-instead.md)
listens for `error`, so it never triggered. The `poster` remained beneath the
controls, appearing as a frozen image — worse than D79's corrected black screen
because nothing signalled failure.

In the same place, two spinners overlapped on opening: the viewer's and the
browser controls' native spinner, both centred on the player.

**Choice.** Failure is detected from what arrived, not an error that never will:
`loadeddata` and `playing` mark video unplayable when `videoWidth === 0`. At both
points, a decodable video track must have delivered a frame; zero width can only
mean one thing. D79's unchanged message and **Download** button then appear.

And the viewer spinner disappears: the `poster` occupies the wait, and native
controls carry their own indicator. With video reduced to a binary state, it no
longer uses `previewOverlay`, which returns to governing photos only.

**Rejected.** Probing `canPlayType` before displaying — already rejected by D79,
for a reason confirmed by this defect: every browser responds `maybe` for
`video/mp4`, saying nothing about the contained codec. The chosen detection costs
no probe and observes the exact case, HEVC or otherwise.

Also rejected: listening only to `playing`. A video whose autoplay is refused by
the browser never emits that event, leaving failure invisible until the first
click on Play.

**Consequences.** This PR does not make HEVC playable — it makes videos say they
are not. Transcoding remains to be done, and the codec recognition it requires is
now present.
