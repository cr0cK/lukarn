# D94 — A photo without a position says so instead of letting the row disappear

**Confidence.** observed — lib/exifRows.ts, git ls-files → exit 0 · 2026-08-23

**Context.** The information panel only displays what it has: each row without a
value disappears, avoiding a table of dashes for a screenshot with no EXIF. The
position followed this rule, and it is the only case where it fails. Two very
different causes produce the same empty screen: the photo was never geolocated,
or the application has not processed it yet. The former is permanent; the latter
invites returning later — and nothing distinguished them. Confusion is easier
because the panel shows a "Place" immediately above that **does** depend on
reverse geocoding (D48) and appears after a background pass.

**Choice.** The "Position" row always renders for a photo. With coordinates, it
shows the lat/lng pair and opens OpenStreetMap. Without them, it says "No GPS
data" in `ink-400` — the colour of observations rather than information, already
used by labels. Only one of the two causes remains possible after reading it.

It does not wait for geocoding: coordinates come from the file's EXIF and are
copied during synchronisation, while the place name comes from a network call
capped at one request per second, grouped by day, and sometimes with no usable
result. The rows deliberately say different things — "Position" is what the
photo carries; "Place" is what could be made of it.

**Photos only.** Drive only returns a position in `imageMediaMetadata`;
`videoMediaMetadata` has none, whatever the file. A video would therefore always
show "No GPS data", teaching nothing about the one being viewed and asserting
something false: not that the file is not geolocated, but that it cannot be read.
The row remains absent for video.

**Rejected.** Distinguishing a third situation — coordinates exist but the day
has no name yet — with "Place: name not yet determined". This transient case
occurs after a fresh synchronisation and usually closes in minutes. But nothing
guarantees it will close: geocoding can finish without a usable result, when
`geo_places` stores a row with a null `label` to avoid requesting it again. The
panel would promise a name that never arrives.

**Consequences.** `buildRows` leaves `ExifPanel` for `lib/exifRows.ts`, beside
`caption.ts` and for the same reason: it is the panel's only conditional part,
and outside the component it can be verified without the DOM. Rows carry an
`absent` field currently used only for position — any other absence worth stating
would use it rather than a second hard-coded colour.
