# D83 — A description per photo, scoped to the album

**Context.** An album has a description and a day has a note, but a specific
photo had nothing. Yet this is where context is needed most: "Léa jumps from the
jetty, third attempt" cannot be inferred from the filename, EXIF, or the day note,
which describes the whole day. A family gallery is viewed years later, and what
was not written down is lost.

**Choice.** A `media_notes (album_id, media_id, description, updated_at)` table
with primary key `(album_id, media_id)`. Text is entered from the gallery while
viewing the image; the mutation goes through
`PATCH /api/admin/albums/:id/items/:mediaId`, the only prefix responding with 403
(D50). The same split as the day note and cover, for the same reason.

**The scope is the album, not the Drive file.** A file present in two albums —
nested folders, both declared — has two descriptions, just as it has two comment
threads. A description keyed only by `media_id` would be simpler to write and
wrong to read: it would show a visitor what was written in an album they cannot
access, contradicting D12's partitioning. The accepted price is describing the
same photo twice if it must be described in both places — a rare case, and still
a choice.

**No foreign key to `media`**, the heart of the entry. `deleteStale` removes a
photo from the index as soon as a synchronisation does not see it: in the Drive
bin before a rollback, a renamed folder, or a sync interrupted midway. A cascade
would destroy hand-written text that nothing regenerates after a temporary
indexing problem — unlike a thumbnail. Since the Drive identifier is stable, a
returning photo automatically recovers its description. This is the reasoning of
`comments.media_id` (D35) and `albums.cover_media_id` (D80), and it applies even
more strongly here because a lost description cannot be reconstructed.

A corollary that must remain: **no housekeeping touches this table.** Neither
`deleteStale`, `clearAlbum`, `pruneAlbums`, nor `upsertMany`'s
`ON CONFLICT DO UPDATE` — the same invariant as `replaceCells` in `AlbumDayRepo`,
where an accidental `excluded.description` would erase everything on every
hourly pass. Only the cascade from `albums` deletes it.

**Carried with the item, not in a bulk call.** Album comment counts travel as a
block (D54), and this could have done the same. Three reasons not to. The viewer
must display the caption on a photo just reached with an arrow, at the same time
as the item itself — not after a second request returns. A one-to-one `LEFT JOIN`
on a primary key is negligible beside the index traversal the page already does.
And a block of "all album descriptions" would carry kilobytes of text for photos
that may never be viewed, where a count is one integer.

**Rejected.** A `media.description` column. It would avoid the join, but
`upsertMany` rewrites the whole row on every synchronisation: it would have to be
excluded from `DO UPDATE` — a one-character silent omission in an already
twenty-column query. It would also disappear with the photo, exactly what this
entry seeks to prevent.

Also rejected: refusing videos, as `coverId` does. That refusal is justified by
the pipeline, which renders no video thumbnail; nothing prevents it here, and a
video deserves a caption as much as a photo.

**Consequences.** `MediaItem` gains a field, and therefore so does `MediaDetail`
— the `i` panel inherits it without another word. The limit is 1,000 characters,
between the day note (300, whose section-header height is precalculated without
the DOM — D49) and the album description (2,000, a free paragraph): placed on a
photo, beyond a thousand characters a caption ceases to be a caption.

`SELECT *` becomes `SELECT media.*` in `listItems` and `getDetail`: both tables
have an `album_id` column, and SQLite would accept it without complaint while
leaving the next reader to guess which one they hold.
