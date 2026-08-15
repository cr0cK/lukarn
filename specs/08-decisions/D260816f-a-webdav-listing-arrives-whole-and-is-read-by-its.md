# D260816f — A WebDAV listing arrives whole and is read by its decoded path

**Context.** `storage/webdav.ts` lists a collection with a `PROPFIND` at `Depth: 1`
and receives a `<d:multistatus>` in which every entry names itself with an
`<d:href>`. That href is the only thing tying an entry to the file `fetch()` will
later ask for, and it is where servers disagree with each other.

Nextcloud answers with a root-relative path under a prefix nobody typed —
`/remote.php/dav/files/alexis/Photos/caf%C3%A9%20%2B%20plage%20%231.jpg`. An Apache
`mod_dav` may answer with a full absolute URL, and behind a reverse proxy that URL
names the host Apache was configured with rather than the one this instance dialled.
Both percent-encode, and neither promises to do it the way `encodeURIComponent`
would: a `~`, a `!` and a `+` are each optional to escape.

The application needs something else entirely. `StorageEntry.ref` is used three
ways — as the next container to traverse (`sync/sync.ts` pushes a folder's `ref`
onto its queue), as the argument to `fetch()`, and as `media.source_path`, which is
hashed into the media identifier and stored. So it has to be a stable, readable,
root-relative path, and it has to survive being turned back into a URL.

**Decision.** An href is resolved against the collection's URL, split into path
segments, and each segment decoded. The connection's own root is decoded the same
way and compared **segment by segment**; what remains, joined with `/`, is the ref.
Asking for it again re-encodes each segment with `encodeURIComponent`.

Two consequences follow from that, and both are deliberate.

_The host is ignored._ Only the path is compared. An href announcing
`http://apache.internal:8080/dav/…` still resolves to a ref, which is what keeps a
server behind a reverse proxy readable at all. The cost is that a hypothetical
server answering about a genuinely foreign host would be believed; a WebDAV server
that lies about its own resources has already been trusted with the bytes.

_Encoding is normalised, not preserved._ Comparing decoded segments is what makes
one code path read a Nextcloud and a `mod_dav`, whose escaping differs. The cost is
a name that cannot survive a round trip: a literal `%` a server failed to escape
decodes to itself and re-encodes to `%25`, and a raw `#` in an href is read by
`new URL` as a fragment and truncates the name. Both are server bugs, both produce
a visible 404 rather than a wrong file, and both are rarer than the servers this
choice supports.

_Rejected: keeping the raw href as the reference._ It round-trips perfectly, and it
is the wrong string to store. It carries `remote.php/dav/files/<user>`, so moving a
Nextcloud account renames every file in the index; it is not a path, so an album's
folder could not be typed as one; and it is not a container `list()` could be
called with.

**A `PROPFIND` has no pages.** RFC 4918 defines no continuation token: a `Depth: 1`
request answers with the entire collection or with nothing. `list()` therefore
returns `cursor: null` always, and the parameter exists only because the interface
has one — Drive's `nextPageToken` is what it was shaped around.

The accepted cost is that one collection is one XML document, held whole in memory
while it is parsed. Ten thousand entries at roughly 400 bytes of properties each is
a few megabytes, on a request that happens once per folder per synchronisation. The
bound on a runaway tree stays where it already was, `MAX_FOLDERS` in `sync/sync.ts`,
which limits how many such documents a single album can ask for.

_Rejected: paging by hand_, by listing at `Depth: 1` on subfolders only and never
on a large flat folder. It answers a problem nobody has — a folder of ten thousand
photos with no subfolders is not how anyone stores photographs — and it would trade
a bounded allocation for a per-server heuristic about when a collection is "too
big".

**Consequences.** `StorageEntry.version` is the `getetag`, with its quotes and any
weak `W/` prefix stripped: `routes/media.ts` embeds it in `"<mediaId>-<version>-<variant>"`,
and a value still carrying quotes produces a malformed `ETag` header, which browsers
answer by never revalidating.

A server that states no `getcontenttype` gets one guessed from the extension. This
is not tidiness: a distribution `mime.types` typically has no HEIC entry, `classify()`
ignores anything that is not `image/` or `video/`, and the visible result is an album
silently missing every photo from a recent iPhone, with no error anywhere to explain
it.

`packages/server/test/webdav.test.ts` holds all of this to account against a local
stub answering both a Nextcloud reply and a `mod_dav` one — including a name with a
space, a `+`, a `#` and an accent going out to the listing and coming back as a
request target. **None of it has been run against a real Nextcloud**, which is the
gap this decision cannot close on its own.
