---
code: GAL
status: done
version: v1.0
amended: [v1.1, v1.2, v1.3]
created: 2026-08-02
---

# Lukarn — GAL specification

GAL covers gallery browsing, the justified virtualised photo grid, day notes and inferred
locations, the full-screen lightbox viewer, full-text search, the responsive desktop and phone
shell, and PWA installability and theming. It predates the spec delivery process, so it has no
plans, and describes the application as it stands.

## Album list and grid

- The album list (`/`) shows all albums visible to the signed-in account, each with its title,
  optional description, cover image (explicit admin choice, falling back to the latest indexed
  photo when unset or removed from the index), item count, date bounds, and sync status.
- An album grid (`/album/:albumId`) displays photos and videos in a justified layout grouped into
  consecutive sections (`month` or `day`) without gaps or horizontal slivers.
- Media dimensions stored in the index are corrected for EXIF rotation so every tile reserves its
  exact box before any image loads, preventing layout shift and keeping scrollbar length accurate
  (D17).
- Album grids paginate via opaque keyset cursors (`?cursor=`, default 200 items, max 500) so no
  item duplicates or skips across pages even when sync updates the album (D16).
- Sections can be collapsed and expanded in memory per visit; collapsing hides the section's
  tiles from layout and keyboard selection while keeping its header, item count, place, and note
  visible (D68).
- Capture timestamps (`taken_at`) are stored and formatted in UTC because cameras write local
  shutter clocks without timezone offsets; only the "Today" / "Yesterday" relative day labels
  compare against the browser's local calendar day (D31).

## View controls and URL state

- Each album carries a default `groupBy` (`month` or `day`) and `sortOrder` (`asc` or `desc`),
  configurable by an administrator; opening an album follows URL query parameters first, then
  per-album browser memory for sort order (`lukarn:album-order:<albumId>`), then the album default
  (D18, D99).
- Changing `groupBy` re-segments the already loaded items client-side without re-fetching from the
  API; changing `sortOrder` fetches in the requested direction.
- Up to five independent query parameters carry gallery view state: `?photo=<mediaId>`,
  `?panel=comments|info`, `?order=asc|desc`, `?group=month|day`, and ephemeral `?day=YYYY-MM-DD`
  (scrolls to that day in day grouping, then clears itself via history replace).

## Day notes and places

- In `day` grouping, each day may carry a manually entered note (up to 300 characters, measured
  before layout so long notes never overlap thumbnails) and a location label (up to 120
  characters) (D49, D85).
- Background clustering groups EXIF GPS coordinates per UTC day (~15 km clusters, up to 3 per day)
  and resolves cell centres rounded to 2 decimal places (~1.1 km) via Nominatim/OSM (`GEOCODING_URL`)
  at most once per second and 200 cells per pass, cached in SQLite (`geo_places`).
- Setting `GEOCODING_URL=` (empty) disables all outbound geocoding requests while retaining day
  notes and offline clusters.
- A manual place entered by an administrator overrides inferred `autoPlaces`, and background
  recalculation preserves manual `place` and `description` edits (D48).

## Full-screen viewer

- Opening a tile launches the full-screen lightbox (`?photo=<mediaId>`), keeping a near-black
  surround in both light and dark interface themes (D260815d).
- On touch/coarse pointers, the viewer opens bare (controls hidden until tap); `h` or the toggle
  button shows/hides chrome (D260814b).
- The viewer displays the album title and day/place context, the caption strip (day note and
  per-`(album, media)` photo description up to 1000 characters), EXIF metadata, comment count
  badge, and original-file download (`?download=1`).
- Zoom switches from the `full` variant (up to 2560 px) to the `hd` variant (up to 4096 px on the
  longest edge without upscaling) on click, double-tap, or two-finger pinch, panning smoothly
  without triggering browser page zoom (D19, D20, D260814d).
- Neighbouring photos preload asymmetrically (more ahead in the current reading direction than
  behind), and departed in-flight image fetches are cancelled on unmount so rapid navigation never
  starves grid thumbnails (D21, D87).
- Blurred previews (`full` upscaling from a thumbnail) never appear without a visible loading
  indicator.
- Touch swipe uses a 3-slide horizontal rail that tracks the finger from 10 px of horizontal
  travel; disabled while zoomed and on videos (D260809e).
- Video playback inspects the indexed codec: browsers able to decode the original codec (e.g.
  `avc1`, or Safari for `hvc1`) stream `/original` with HTTP `Range`; browsers that cannot decode
  HEVC request `/playable` (prepared H.264 MP4) and show a "being prepared" notice with a Download
  button while `/playable` returns 404 (D6, D79, D98).

## Keyboard navigation

- Grid navigation supports arrow keys (aligned to actual visual rows), `Home`, `End`, `Enter` to
  open, and `/` to focus search.
- Viewer navigation supports `←`/`→` (prev/next), `Escape` (close panel/menu then viewer), `h`
  (toggle bare mode), `i` (info panel), `c` (comments panel), and `?` (shortcuts help overlay).
- Keyboard shortcuts ignore events while typing in `input`, `textarea`, `select`, or
  `contenteditable`, except `Escape` inside the viewer.

## Search

- `GET /api/search?q=` performs FTS5 full-text search (minimum 2 characters, up to 5 hits per
  category: `album`, `day`, `media`) across album titles and descriptions, day notes and places,
  and photo descriptions (D96).
- Search scope is strictly filtered to albums the signed-in account can access; results navigate
  directly to `/album/:id`, `/album/:id?group=day&day=…`, or `/album/:id?photo=…`.

## Responsive shell, PWA, and diagnostics

- Below `md` (768 px), navigation moves to a 4-tab fixed bottom bar (Albums, Search sheet,
  Activity drawer with unread badge, Account sheet) while the top bar retracts on downward scroll
  and keeps page-level View controls (D260814, D260814d).
- At `md` and above, search, Activity, View icon buttons (with hover tooltips), and the Account
  menu live in the top bar (D90).
- A web app manifest (`/manifest.webmanifest`) and service worker (`sw.js`) make the gallery
  installable; the service worker caches the application shell only and never caches photos or
  API data (D71).
- The interface follows `prefers-color-scheme` (light/dark) until explicitly overridden per browser
  in `/settings` (D260815d).
- `/diagnostic` is an unauthenticated, inline-styled browser capability probe reporting engine
  dimensions and CSS feature support (`@layer`, `@property`, safe-area insets) for diagnosing old
  mobile or TV browsers (D260809f).

## Out of scope

- Writing, modifying, deleting, rotating, or retouching originals on any connected storage.
- Self-registration, public sign-up, or forgotten-password email recovery flows.
- Facial recognition, object tagging, or pixel-level image indexing.
- Query-built or smart albums across folders.
- Per-photo manual GPS coordinate overrides or interactive slippy maps using third-party tiles.
- Multi-tenancy (isolated separate libraries per tenant within one instance).
