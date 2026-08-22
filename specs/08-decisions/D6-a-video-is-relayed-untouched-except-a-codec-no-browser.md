# D6 — A video is relayed untouched, except a codec no browser decodes

**Confidence.** observed — media/range.ts, git ls-files → exit 0 · 2026-08-23

**Context.** Videos are MP4 and MOV files, some of them large. Handed to the
browser as they stand, they cost the server nothing and seek natively. The
exception is the codec the browser cannot open at all: **25 of the 38 files** in
the album that reopened this question are HEVC, all from the same phone, and two
videos in three would not play on a computer.

**Decision.** `GET /api/media/:id/original` forwards the `Range` header unchanged
to the storage and copies `Content-Length` / `Content-Range` from the response.
The browser reads the original format, with native seeking. This is what happens
to everything it can play.

For `hvc1` and `hev1` — and for no other codec — an H.264 version is prepared **in
advance, one at a time, in the background**, and served from
`GET /api/media/:id/playable`. The rule keys on the codec, never on a file's size
or on how many there are: transcoding an `avc1` would spend minutes of processor
time degrading an image everybody can already play.

**The client chooses its source.** The server does not decide: it exposes
`videoCodec` with the item and the browser calls `canPlayType` with the actual
codec. Bare `video/mp4` returns `maybe` everywhere and reveals nothing
([D98](./D98-decoding-that-fails-without-an-error-and-one-spinner-too.md)); with
the codec the answer is definite. A deliberate consequence: **Safari and an iPhone
keep the full-quality original**, having nothing to gain from a re-encode.
Preparation is a fallback where there was nothing, never a substitute.

**The codec is read from the file in the same pass as the date.** `readVideoCodec`
walks `moov → trak → mdia → minf → stbl → stsd` and keeps the first track whose
`hdlr` is `vide` — a phone video has at least one audio track, often placed first,
and taking the first available `stsd` would yield `mp4a` for every other file. The
read shares the `Range` window of
[D97](./D97-a-video-s-date-comes-from-the-file-not-its-upload-date.md); separating
them would double the requests needed to reread the same bytes. `video_codec` has
three states — never examined, examined without result, and the codec — so the
first pass populates it with no backfill.

**A separate store, with its own budget.** `CACHE_DIR/video`, a second
`MediaCache`: inventory, LRU, eviction and `.tmp` clean-up were already written.
What cannot be shared is the budget. A thumbnail is recreated in seconds and a
video in minutes of processor time, so a shared LRU would let someone browsing the
grid evict an hour of work. Each `MediaCache` inventories and clears only its own
shelves; otherwise "clear cache" from /admin would take both.

**Slowness is the mechanism, not a flaw.** One task at a time, `ffmpeg` reniced to
15 and held to a single thread, stopping on the store's budget, when the setting is
turned off, and on shutdown — the process is killed there, or a ten-minute encode
would outlive the container that started it. `plafondDebit` caps the output bitrate
at the source's, without which `-crf` is a variable bitrate with no ceiling and
three derivatives in twenty came out larger than their original
([D260809g](./D260809g-a-derivative-can-no-longer-be-larger-than-its-source.md)).

**Rejected.** **On-demand transcoding**, on the first request: an HTTP response
held open for ten minutes, and as many simultaneous `ffmpeg` processes as there are
curious visitors. `/playable` answers `404 not_ready` instead, which the viewer
turns into a waiting message beside the Download button
([D79](./D79-an-unplayable-video-says-so-and-can-be-downloaded-instead.md)).

**Replacing the original**: it stays available, transcoded or not. The prepared
version is one more derivative.

**Adaptive quality**, or HLS. One rendition, 1080p, CRF 23. Segments and several
bitrates would need a manifest, a JavaScript player and as many times the storage,
for a family gallery whose videos last a minute.

**Rewriting the `Range` on the server**, which would mean reconstructing
`multipart/byteranges` responses. `media/range.ts` therefore refuses multiple
ranges and units other than `bytes`: an invalid `Range` is **ignored** and the
whole file is served, as RFC 9110 recommends.

**Consequences.** The image carries `ffmpeg`, roughly **250 MB**, stated as such in
[06](../06-configuration-and-deployment.md). Without it the server starts with a
warning and the affected videos keep D79's message.

A newly arrived video is not immediately playable. It says so, and **starts by
itself** when its version lands: the viewer asks for the first byte again every
twenty seconds while it waits. Without that watch the 404 would be a dead end for
whoever stayed on the screen.

**What this buys is playability, not a smaller file.** Measured over twenty videos:
1,177 MB of originals for 780 MB of output, 1.5× where the first estimate expected
five. Handheld 1080p at 30 frames per second, with foliage, is close to the worst
case for an encoder, and `veryfast` does not help — it is the preset that holds
real time on one core, which is what makes this acceptable on a small server.
Dropping to `medium` or raising the CRF would trade processor budget or image
quality for space, which was not the goal. A 200 MB `avc1` remains a 200 MB `avc1`.
