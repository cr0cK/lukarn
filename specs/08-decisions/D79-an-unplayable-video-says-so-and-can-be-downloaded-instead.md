# D79 — An unplayable video says so and can be downloaded instead of loading forever

**Context.** [D6](./D6-no-video-transcoding.md) rejects transcoding and states
the consequence: "a format the browser cannot read is not playable at all — no
fallback". The consequence was correct; the interface did not handle it. The
viewer's `<video>` element listened for `loadeddata` and nothing else. A playback
failure therefore left `loaded` as `false` forever, with the spinner turning on a
black screen without a word.

Two ordinary causes, both verified in a browser:

- **The codec.** An iPhone records in HEVC whenever "High Efficiency" is enabled,
  which is the factory setting. Chrome on Linux and Windows does not decode HEVC:
  `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`. This is not an exceptional case for a
  family gallery populated from phones.
- **The source.** Drive unavailable, token revoked, quota exceeded: `/original`
  responds with 503, and the player stops on the same silent error.

**Decision.** `error` on the element replaces the player with a message and a
**Download** button. The displayed combination is not decided in JSX but by
`previewOverlay` (`lib/preview.ts`), which already served photos — video passes
`measured: false`, since it has no server preview to show. The rule therefore
lives in one place, tested across all combinations.

The message names the format instead of saying "an error occurred": the video is
almost always intact and playable on another device. Downloading is the only
fallback D6 leaves — it is the original file, which the server already relays.

**Rejected.** Transcoding unsupported formats on the fly: exactly what D6
rejects, and the reason has not changed. Also rejected: probing `canPlayType`
before displaying, to warn rather than observe. Every browser's `maybe` response
for `video/mp4` says nothing about the codec actually contained, and Drive's
`mimeType` does not reach codec level — the probe would be wrong in both
directions, while `error` records what actually happened.

**Consequences.** The spinner is now a bounded state: it ends on an image or a
message. The grid thumbnail is unchanged — a video remains a plain tile showing
its duration, with no distinction there between one that will play and one that
will not; finding out would require decoding it.
