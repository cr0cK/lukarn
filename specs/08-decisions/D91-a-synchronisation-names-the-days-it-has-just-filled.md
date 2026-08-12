# D91 — A synchronisation names the days it has just filled

**Context.** [D48](./D48-geocoding-runs-in-the-background-and-its-cache-is-a-one.md)
connected the places pass to startup and hourly housekeeping while explicitly
excluding synchronisation: geocoding is capped at one request per second, and a
sync should not wait for it.

That reasoning concerned blocking, which has since disappeared.
[D58](./D58-prewarming-prepares-thumbnails-and-follows-synchronisation.md) routed every
synchronisation through `AppContext.syncThenPrewarm`, called detached:
`/admin/resync` responds with 202 before anything starts. What remained was no
longer a technical constraint but a gratuitous delay — phone photos from a day
are added to Drive, they carry positions, the instance can name the day, yet the
header remains silent for up to an hour. The case is a device without GPS
supplemented by a phone with it: the sync brings the only data capable of naming
the day, and it triggered nothing.

**Decision.** The places pass gains the same third trigger as prewarming: the end
of every synchronisation in `syncThenPrewarm`, covering periodic sync, `/admin`
sync, and the sync after OAuth returns.

It starts **detached and before prewarming**. Order matters: cluster aggregation
is instantaneous, but subsequent geocoding takes minutes, and `await` on it would
delay thumbnails — what makes the grid fast — by the same amount. Detached, it
costs only the aggregation time.

**Consequences.** Startup and startup sync now exclude each other for places as
they do for prewarming, for the reason D58 already measured: started together,
the startup pass holds the lock while sync fills the index, and the pass meant to
follow is rejected as concurrent — newly arrived photos would wait for exactly
the hourly housekeeping being avoided. `main.ts` therefore moves its call into
the "no sync at startup" branch.

Nothing changes in throughput to Nominatim. The `PlacesPass` lock turns repeated
resynchronisation into one pass, and the per-cell cache means a named place is
never requested again: a sync bringing no new position makes no request.

**Rejected.** _Only triggering aggregation after sync_, leaving geocoding to
hourly housekeeping. This was the split most faithful to D48 and achieved
nothing: a day with computed clusters but no label still displays no place. The
half that needed advancing was precisely the slow one. Splitting `run()` in two
would have produced a visible result an hour later — the problem being fixed.
