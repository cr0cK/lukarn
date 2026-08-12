# D96 — The search index is maintained by the schema, not the code

**Context.** Beyond around twenty albums, the home page cannot answer "where are
the Marseille photos?". Yet the information already exists in the database:
albums have titles and descriptions, days have notes and places — entered or
geocoded by the `places` pass (D48) — and photos have descriptions since D83.
Nothing makes it searchable; albums must be opened one by one.

The cost of search here is not the query. A few thousand rows scan in under a
millisecond, and `LIKE '%…%'` would suffice for a long time. The cost is **keeping
the index current**. These texts are written from six places:
`ConfigRepo.saveAlbum`, `AlbumDayRepo.upsertNote`, `AlbumDayRepo.replaceCells`,
`Geocoder`, `MediaRepo.setDescription`, and cascading album deletion. Code-driven
reindexing would require remembering every one — today and in every future write
path. A stale index is invisible: nothing breaks; it merely returns fewer
results, and the absence is only noticed when searching for exactly what is
missing.

**Choice.** Four FTS5 tables **with external content** (`content='<table>'`,
`content_rowid='rowid'`), maintained by **SQL triggers** — three per table, the
documented FTS5 form. Consistency becomes a schema property, not a calling
discipline: every write path updates the index, including paths not yet written
and those outside the code — an `ON DELETE` cascade or a correction in `sqlite3`.

External content avoids duplicating text: the FTS table only stores the index and
joins its source by `rowid`. The tokenizer is `unicode61 remove_diacritics 2` —
"ete" finds "été" and "nim" finds "Nîmes", without a manually maintained
normalised column and therefore without another place to forget.

Verified on `better-sqlite3@12.11.1` (SQLite 3.53.2) before committing:
`AFTER DELETE` triggers do fire on cascading deletions, and FTS5 `integrity-check`
remains green afterwards. Those two points are exactly what would make the
decision false if they did not hold.

**What is not indexed, and why.** `media.name`: `IMG_1234.jpg` is noise, and
indexing it would drown real labels beneath names nobody chose. `camera_make` and
`camera_model`: searching "iPhone" would return half the library, meaning
nothing. **Comments**: searching what others wrote is another feature —
moderation hides messages, a thread belongs to the (album, media) pair, and
search would need to replay those rules rather than borrow them.

**What is returned is a navigable entity, not an excerpt.** "Marseille" opens
the day in Marseille; it does not show the line containing the word. This choice
determines the whole display: three short groups — Albums, Days and places,
Photos — with five entries each and no score compared across types. The `bm25` of
a three-word title and that of a three-line note are not comparable; grouped
display removes the question and needs no normalisation.

**Rejected.** A denormalised `search_text` column per table, filled by code:
exactly the discipline being avoided. An external engine (SQLite remains the
instance's only state, D9). And `LIKE '%…%'`: it ignores accents, cannot search
by word prefix, and scans — it would work until it stopped, with no clear point
when.

**Consequences.** Migration 11, not replayable like all others. It ends with one
`rebuild` per table; without it, an existing instance would remain silent about
everything already present because triggers would only index later writes —
never, for an untouched album. `SearchRepo` (`search.ts`) also filters two
non-decorative cases: a description whose media left the index (D83) returns
nothing, otherwise the result opens an empty viewer; and a day matching both its
note and place appears only once.
