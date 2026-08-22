# D260816b — EXIF is read from a 64 KB window, not from the file

**Context.** [D3](./D3-indexing-without-downloading.md) is the property the whole
index rests on: an album of several thousand photographs is indexed without
downloading a byte, because Drive returns dimensions, capture date, camera and
position in `files.list` itself.

No other backend does. A local folder, a bucket and a WebDAV server hand over
files; `StorageEntry.media` is `null` for all three. Without a capture date every
photograph falls back to its modification time, which is the date it was **copied**
— so an album restored from a backup shows a decade of holidays as having all
happened on one afternoon, and the map is empty because nothing carries a
position.

The obvious reading of that is that D3 was a Drive privilege and the other
backends must download. A ten-thousand-photograph library at four megabytes each
is forty gigabytes per full pass.

**Decision.** Read the EXIF block through **one 64 KB ranged window at offset 0**,
per new photograph, and never again while the file is unchanged.

This works because of where EXIF lives rather than because of a trick: a JPEG's
`APP1` segment is the second thing in the file, and a HEIC's `meta` box precedes
its image data. Both are within the first few kilobytes in every file observed.
It is the same shape as the video-header reads D97 already performs, using the
same `readWindow` and the same failure handling.

- `sync/exif.ts` locates the block and is **pure**: the caller supplies the
  window. For a JPEG it walks the marker chain rather than scanning for `Exif`,
  for the reason `mp4.ts` gives about `moov` — a thumbnail embedded inside the
  EXIF block is itself a JPEG with its own markers, and a scan finds those too.
  For a HEIC it follows `meta → iinf → iloc`, because a HEIC stores EXIF as an
  addressed item and nothing but `iinf` maps that address to a type.
- `fromExifBlock` in `sync/metadata.ts` turns the block into the same
  `ProviderMediaMetadata` Drive delivers pre-parsed, so `toUpsert` and everything
  below it never learn which backend a photograph came from.
- **`exif-reader` parses the TIFF IFDs.** Thirty kilobytes, MIT, sharp's own
  companion, and it reads dates through `Date.UTC` — the convention this
  application already stores and displays in. Re-implementing IFD parsing to
  avoid it would be the mistake D5 names.
- `MediaRepo.indexedMedia` is the shortcut. While the version the backend reports
  is unchanged the bytes are unchanged, so rereading them returns exactly what
  the index holds. It returns `rotated: false` with the dimensions already
  exchanged, because the swap was applied on the way in.

**Consequences.**

- **A first sync of a thousand photographs costs 64 MB, a resync costs nothing.**
  Compared with forty gigabytes for the same library downloaded in full, and with
  zero for a Drive, which is untouched: a backend answering in the listing is
  still never asked for bytes.
- **A photograph whose EXIF sits beyond the window keeps its file date.** No
  second window is opened. Doubling the request count for a file shape nobody has
  produced would be paid by every album to rescue none.
- **The hemisphere is read.** EXIF stores degrees, minutes and seconds unsigned,
  and Santiago and Kraków carry nearly the same three numbers; the `S` and `W`
  references are what tell them apart, and dropping them puts half the world in
  the wrong quarter of the map.
- HEIC and RAW still have no preview on these backends — that is
  [D92](./D92-a-video-poster-is-the-storage-s-preview-then-a-still.md)'s
  territory and unrelated to reading their metadata.

**Rejected.** Downloading the file and handing it to sharp, whose `metadata()`
already exposes the EXIF block. It is the shortest code in this file and it costs
the whole library per pass — the one thing D3 exists to prevent.

Also rejected: parsing the IFDs by hand to avoid a dependency. Thirty kilobytes
against the orientation, rational and byte-order cases that a photograph from a
real camera exercises and a hand-written reader gets wrong quietly.
