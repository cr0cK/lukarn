# D6 — No video transcoding

**Context.** The videos in Drive are MP4 and MOV files, some of them large.

**Decision.** `GET /api/media/:id/original` forwards the `Range` header unchanged to Drive
and copies `Content-Length` / `Content-Range` from the response. The browser reads the
original format, with native seeking.

**Rejected.** On-demand or background ffmpeg: a modest VPS does not have enough CPU, the
transcoded versions would need to be stored, and a job queue would need to be managed.
Also rejected: rewriting the `Range` on the server, which would require reconstructing
`multipart/byteranges` responses.

**Consequences.** A format the browser cannot read cannot be played at all — there is no
fallback. `media/range.ts` therefore rejects multiple ranges and units other than
`bytes`: an invalid `Range` is **ignored** and the entire file is served, as recommended
by RFC 9110.
