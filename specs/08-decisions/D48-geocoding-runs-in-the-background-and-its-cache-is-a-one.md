# D48 — Geocoding runs in the background, and its cache is a one-kilometre cell

**Context.** Photos carry their position in their EXIF data, which is already
indexed (`media.lat/lng`). Nobody could see it: a dated grid says neither what
was done nor where. Turning a coordinate pair into "Bonifacio, Corse" requires
a third-party service.

**Choice.** Nominatim/OSM, called by a **background pass** connected to hourly
housekeeping and startup, with a cache per **cell** of `lat,lng` rounded to two
decimal places (~1.1 km).

The pass is split into two halves with different properties, and that is where
the decision lies. **Aggregating** positions into clusters is deterministic,
instantaneous, and offline; **geocoding** is slow, capped by the usage policy at
one request per second, and fallible. Combining them — writing a frozen label to
`album_days` — would force a choice between never recomputing days and calling
Nominatim again on every pass. Kept separate (`album_days.cells` on one side,
`geo_places` on the other), recomputation is free and labels appear on their own
when they arrive.

A one-kilometre cell is the granularity below which two photos carry the same
place name anyway. A per-photo cache would make a thousand calls for one day; a
per-day cache would reuse nothing from one stay to another. It is shared across
albums: two stays in the same place count as one call.

**Rejected.** _Geocoding during the request_: `better-sqlite3` is synchronous
and a grid requests dozens of days; at one request per second, the page would wait
a minute. _Google Geocoding_: another key and another bill, where nothing else in
this application requires either — this is precisely what the service account
and Nominatim avoid. _Retrying a place with no result indefinitely_: hence the
distinction between "completed with no result" (a row written with `label = NULL`,
never requested again) and "network failure" (no row, retried on the next pass).

**Consequences.** `GEOCODING_URL` can be left empty: days keep their clusters,
without labels. The first pass over a large library takes several hours — 200
calls per hourly pass — so the interface must work without `autoPlaces`, which it
does: a missing place leaves no gap; it is simply not displayed. The `User-Agent`
is derived from `PUBLIC_URL`, as required by the public instance.
