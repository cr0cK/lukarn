# D260813b — The logo lives in `DATA_DIR` and every upload is rasterised

**Confidence.** observed — packages/server/src/branding/store.ts, git ls-files → exit 0 · 2026-08-23

**Context.** An instance may want its own logo rather than the Lukarn mark: a
family crest, an association's badge, a photograph. Accepting one raises three
questions that are usually answered badly — where it is stored, what it is
allowed to be, and how the icons derived from it are kept fresh.

The dangerous one is the second. A logo is an image, and the most convenient
image format for a logo is SVG. An SVG is also a document: it can carry
`<script>`, `onload=` and `<foreignObject>`, and served from our own origin it
runs with the session cookie in scope. An administrator uploading their own file
is not the threat; an administrator pasting a file from somewhere else is.

**Choice.** `DATA_DIR/branding/`, with `BrandingStore`
(`packages/server/src/branding/store.ts`) as its only writer.

- `logo.png` — the operator's upload, **rasterised to PNG on arrival**, whatever
  arrived. sharp already reads SVG, PNG, JPEG and WebP, so nothing is refused for
  its format; what leaves the store is a bitmap in every case. No
  operator-supplied SVG is ever served, which closes the whole class rather than
  filtering it. A `Content-Type` check would have been the reflex answer, and it
  checks a value the client chooses.
- `generated/` — the derived sizes (192, 512, maskable 512, apple 180), written
  on first miss and discarded wholesale on any branding change. Four small files
  are cheaper to rebuild than a rule deciding which of them a colour change
  invalidated.
- Half a megabyte, enforced by `bodyLimit` on that route alone; everywhere else
  keeps the 64 KB that fits a JSON payload. The body is held whole before sharp
  sees it, so the limit is what stops a request being used to occupy memory.

**Why `DATA_DIR` and not `CACHE_DIR`.** The cache is disposable by definition —
`MediaCache` evicts from it, and `deploy/backup.sh` deliberately leaves it out
because everything in it can be rebuilt from Drive. An uploaded logo can be
rebuilt from nothing. Putting it under `DATA_DIR` means the existing backup, which
archives that volume whole, already covers it: a custom logo survives a restore
with no change to the script, and nobody has to remember that it exists.

**Why one URL for two things.** `GET /api/branding/logo` answers with the
built-in mark as SVG, or the upload as PNG, with the `Content-Type` saying which.
No caller — favicon, sign-in screen, top bar, administration preview — has to
know which is in force, and none of them changes when an operator uploads or
resets. The icons keep their own URLs because they are PNG in both cases: an
email client renders no SVG, and Safari renders none for a home-screen icon.

**Cache headers.** `no-cache` with an `ETag`, not the `immutable` lifetime media
derivatives get. These URLs are stable while their content is not — the opposite
of a media URL, which carries a content fingerprint. The browser therefore has to
ask, and the usual answer is a 304 carrying no bytes. Pages already open are told
separately (`packages/web/src/lib/branding.ts`): they make no request, so a
version in the URL is what turns a saved logo into a reloaded one.
