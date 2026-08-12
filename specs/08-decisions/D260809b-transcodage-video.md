# D260809b — Video transcoding, rejected by D6, becomes viable with figures

**Context.** [D6](./D6-pas-de-transcodage-video.md) rejected transcoding on
three objections, expressed without measurements: "the CPU of a modest VPS
cannot keep up, transcoded versions would have to be stored, and a job queue
would have to be managed". It was not wrong; it simply had no order of magnitude.

The album that prompted this decision provides one: **25 of 38 files use HEVC**,
all from the same phone. On a computer, two videos in three do not open —
[D79](./D79-une-video-illisible-le-dit-et-se-laisse-telecharger-au-lieu.md) and
[D98](./D98-un-decodage-qui-echoue-sans-erreur-et-un-tourniquet-de-trop.md) made
them honest, not playable. Each of the three objections now has a quantified
answer:

| D6 objection                 | What actual use shows                                                                                                                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The processor cannot keep up | Everything is 1080p, never 4K. With `libx264 -preset veryfast -threads 1`, 1080p runs **at around real time** on one core, as measured: the ten minutes of footage take roughly ten minutes of processor time to convert, **once**, in the background, at low priority. |
| Storage is required          | Measured across twenty of these videos: 1,177 MB of originals for 780 MB of output, making it **1.5 times smaller**, or roughly 95 MB per minute of 1080p. The store is bounded and purgeable like the image cache — 5 GB by default, or one hour of footage.           |
| A queue is required          | One more loop alongside prewarming, reusing exactly the same guards.                                                                                                                                                                                                    |

**Decision.** An H.264 version is prepared **in advance, one at a time, in the
background**, and **only for codecs that no current browser can decode** —
`hvc1` and `hev1`. The rule is based on the codec, never on a file size or a
number of files: transcoding an `avc1` would spend minutes of processor time
degrading an image that everyone can already play.

Four points underpin this decision.

**The codec is read from the file in the same pass as the date.**
`readVideoCodec` traverses `moov → trak → mdia → minf → stbl → stsd` and keeps
the first track whose `hdlr` is `vide` — a phone video has at least one audio
track, often placed before the video, and taking the first available `stsd`
would yield `mp4a` for every other file. The read shares the `Range` window from
[D97](./D97-la-date-d-une-video-vient-du-fichier-pas-de-sa-date-de.md):
separating them would double the number of requests to reread the same bytes.
The `video_codec` column has three states — never examined, examined without a
result, and the codec itself — and the first pass populates it without backfill,
with rows written by D97 being read exactly once.

**A separate store, with its own budget.** `CACHE_DIR/video`, a second
`MediaCache` instance: inventory, LRU, eviction, and `.tmp` clean-up at startup
were already implemented. What could not be shared was the budget — a thumbnail
can be recreated in a few seconds, a video in several minutes of processor time,
and a shared LRU would let browsing the grid evict an hour's work. Each
`MediaCache` inventories and clears only its own shelves; otherwise the one for
`CACHE_DIR` would count the video store as its own, and "clear cache" from
/admin would remove both.

**The client chooses its source.** The server does not decide: it exposes
`videoCodec` with the item, and the browser calls `canPlayType` with the actual
codec. D98 rejected `canPlayType` — rightly, when used with `video/mp4` alone,
which returns `maybe` everywhere and reveals nothing. With the codec, the answer
is definite. A direct and deliberate consequence: **Safari and an iPhone keep
the full-quality original** because they have nothing to gain from a re-encoded
version. Transcoding is a fallback only where there was nothing.

**Slowness is the mechanism, not a flaw.** One task at a time, `ffmpeg` reniced
to 15 and using a single thread, stopping on the store's budget, when the setting
is disabled, and on shutdown — the process is then killed, or a ten-minute
encoding would outlive the container that launched it. The server must remain
responsive throughout: without that condition, D6 would still be right.

**Rejected.** Transcoding **on demand**, on the first request: an HTTP response
held open for ten minutes, and as many simultaneous `ffmpeg` processes as there
are curious users. The `not_ready` 404 says "not yet" instead, and the viewer
turns it into a waiting message beside D79's Download button.

Also rejected: **replacing the original**. It remains available, with or without
transcoding — the prepared version is one more derivative, never a substitute.

Finally rejected: **adaptive quality**, or HLS. One rendition, 1080p, CRF 23.
Splitting it into segments and publishing several bit rates would require a
manifest, a JavaScript player, and as many times the storage, for a family
gallery whose videos last a minute.

**Consequences.** The container image grows by approximately **250 MB**: this is
`ffmpeg`, it is the cost of entry, and it is stated as such in
[06](../06-configuration-et-deploiement.md). Without it, the server starts with
a warning, and the affected videos keep D79's message.

A newly arrived video is not immediately playable — it says so, and **starts
playing by itself** when its version arrives: the viewer requests the first byte
again every twenty seconds while it waits. Without this watch, the 404 would
have been a dead end for someone who remained on the screen, and the only way
out would have been to reopen the photo — which nothing prompted them to do.

**What this buys is playability, not a smaller file.** The first real batch
measures it unambiguously: only 1.5×, where the initial estimate expected five.
Handheld 1080p at 30 frames per second, with foliage, is roughly the worst case
for an encoder, and `veryfast` does not help — it is the preset that maintains
real time on one core, and it is what makes transcoding acceptable on a small
server. Dropping to `medium` or raising the CRF would save space at the expense
of processor budget or image quality; that was not the goal here.

And what this decision does not do: it improves no video that is already
playable, and reduces no stream. A 200 MB `avc1` remains a 200 MB `avc1`.

**D6 is not rewritten.** Its original observation still holds — the original
format is served unchanged, with `Range` relayed and native seeking; that is
still what happens for everything the browser can play.
