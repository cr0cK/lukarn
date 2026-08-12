# D34 — One thread per (album, media) pair, not per media item

**Context.** The same Drive file appears in several albums when their folders
are nested — this is already the reason for the composite primary key
`(album_id, id)` of `media` and for `albumsContaining()`.

**Decision.** `comments` carries `album_id` **and** `media_id`. The same photo
viewed from two albums shows two separate conversations.

**Rejected.** Indexing on `media_id` alone, which would have produced one
conversation per file — more natural at first sight, and fewer rows. But media
access control grants access as soon as **one** album containing the file is
visible: a visitor to the "Holidays" album would then read what those with
access said in "Private". D12's isolation covers the photo's bytes; it would have
said nothing about what people write about it.

**Consequences.** A photo placed in two albums can have two threads without
anyone noticing. That is the price of isolation, and the case is rare: albums
on the same instance overlap little. A reply's `parentId` is checked against the
current media item for the same reason — otherwise, a guessed identifier would
be enough to graft a message onto a thread they cannot read.
