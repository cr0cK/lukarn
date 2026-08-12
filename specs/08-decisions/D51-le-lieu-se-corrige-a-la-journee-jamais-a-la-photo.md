# D51 — The place is corrected per day, never per photo

**Context.** Reverse geocoding is sometimes off: a neighbouring municipality, a
local place name Nominatim does not know, or a photo taken in a car between two
stops. It must be possible to correct it.

**Choice.** The correction is a `place` column on `album_days`, which takes
precedence over inferred labels. There is no per-photo correction.

**Rejected.** _A place per media item._ It could not live in `media`:
`upsertMany` rewrites that table completely on every synchronisation, so a
correction there would be erased on the next pass. It would therefore require an
override table, merged everywhere GPS data is read — media details, day
aggregation, future export — and an interface for selecting a point, meaning a
map picker. This would provide the same benefit as per-day correction in the vast
majority of cases: one corrects "we were in Porto-Vecchio, not Lecci", not the
position of a particular photo.

**Consequences.** A day whose photos span several places is corrected as a whole
or not at all. This is accepted: the field allows any text, so "Bonifacio, then
the Lavezzi" remains possible — simply written by hand rather than
inferred. The correction survives synchronisations and recomputations because it
does not live in `media`.
