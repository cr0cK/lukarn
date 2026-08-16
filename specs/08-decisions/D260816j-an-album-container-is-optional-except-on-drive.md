# D260816j — An album container is optional, except on Drive

## Context

Creating an album on a bucket, a folder or a WebDAV server required naming a
folder **inside** it. The connection already declares a root — a
`STORAGE_LOCAL_ROOT` subpath, an S3 prefix, a DAV folder — so the field asked for
a second level of nesting that a great many installations do not have. A bucket
holding one gallery, a NAS folder mounted for exactly this: both had to invent a
subfolder, or type one that does not exist and find out at the first sync.

## Decision

An empty container means **the whole of what the connection declares**, for every
kind addressed by path: `local`, `s3`, `webdav`.

The storage layer already worked this way and had done since each backend landed.
`LocalFolderService.within` resolves an empty reference to the base directory,
`S3Service` omits the `prefix` query entirely when it is empty, and both `s3.ts`
and `webdav.ts` already write `container || '/'` when reporting a failure — the
code anticipated the value the forms refused to send. Nothing in a provider
changed for this decision.

What changed is the two places that forbade it:

- `validateContainerInput` lost its "required" branch for non-Drive kinds, and
  `extractContainer` returns `''` rather than `null` for empty input. `null` still
  means **invalid** — a path climbing out with `..` — which is the distinction the
  form's submit guard reads.
- `createAlbumSchema.folderId` lost `.min(1)`. The schema cannot know the kind at
  parse time, so the refusal moved to where the connection is already resolved,
  beside `unknown_storage`.

`folder_id` stays `TEXT NOT NULL`. Empty is not null, so there is no migration.

## Drive is the exception, and not by omission

Drive addresses a folder with an **opaque identifier issued by Google**, not a
path. There is no empty identifier, so "the root" has no representation to store —
and the nearest thing Drive offers, the magic `root`, would mean the entire Drive
on a `drive.readonly` scope that covers all of it. An album silently spanning
someone's whole Drive is not a default; it is the thing D46 and the folder-sharing
model exist to avoid.

So `emptyFolderRefused` reads the kind rather than the value alone, and the album
routes answer `400` with a message naming the difference instead of a schema error
about a string length.

## Consequences

The album deletion dialog had to stop naming Drive. It printed "the files stay in
folder `<id>`", which was already wrong for a bucket and would now render an empty
`<code>` for an album covering its whole storage. It became two sentences chosen on
whether there is a folder to name — and, in passing, stopped mentioning a backend
the album may have nothing to do with.

`validate.container` ("Enter the folder to read.") has no caller left and is gone
from both catalogues.

## Rejected

_Requiring the container everywhere and letting people type `.`_ — a path that
means "here" is a convention to learn, and `extractContainer` would have to strip
it back out before storing, which is the same code with a worse field.

_Defaulting the field to the connection's own root as visible text_ — it reads as a
value somebody chose, so editing the connection later would leave albums pinned to
a path that used to be the root. Empty stays empty and follows the connection.
