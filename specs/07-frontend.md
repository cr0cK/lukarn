# 07 — Frontend

React 19, Vite 6, Tailwind 4, TanStack Query 5, React Router 7. No home-grown
global state: what comes from the server lives in TanStack Query, what describes
the view lives in the URL, the rest is local `useState`.

## Routing

`App.tsx`, six routes plus a catch-all.

| Path              | Page             | Guard                                 |
| ----------------- | ---------------- | ------------------------------------- |
| `/login`          | `LoginPage`      | none (redirects if already signed in) |
| `/diagnostic`     | `DiagnosticPage` | none                                  |
| `/pair`           | `PairPage`       | `RequireAuth`                         |
| `/`               | `AlbumsPage`     | `RequireAuth`                         |
| `/album/:albumId` | `AlbumPage`      | `RequireAuth`                         |
| `/admin`          | —                | `Navigate to="/admin/albums"`         |
| `/admin/:tab`     | `AdminPage`      | `RequireAuth admin`                   |
| `*`               | —                | `Navigate to="/"`                     |

`RequireAuth` relies on `useMe()`. **This is not a security control**: the
server already refuses every protected route. It avoids showing a blank page
while waiting for the 401, and remembers the destination in
`location.state.from` to return to it after signing in.

The return after signing in carries both `pathname` **and** `search`. This is
essential coming from `/pair?code=…`: the pairing code lives in the search
string, and returning to the path alone would land on a page that no longer
knows what to approve.

The server serves `index.html` for every URL that is neither `/api` nor
`/assets`, so reloading directly on `/album/vacances` works (see
[05](./05-api.md)).

### Browser survey — `pages/DiagnosticPage.tsx`

`/diagnostic` shows what the browser opening it can actually do: engine
version, real viewport, notches, and a yes/no for the fifteen or so CSS
features the stylesheet depends on. It exists because a rendering defect
reported from a television or an old phone does not reproduce at a desk:
without a survey, fixes are guesswork.

Two choices are worth spelling out, because they look like oversights:

- **It does not use a single Tailwind class**, only inline styles. It reports
  on browsers where the stylesheet is precisely what is failing; dressed like
  the rest of the app, it would lie about what it measures, or not render at
  all.
- **It is not guarded**, unlike the sign-in screen. A browser too old to
  render the form is exactly the one whose survey is needed. It exposes only
  the visitor's capabilities, nothing about the instance.

Properties marked "applied (measured)" are not queried through
`CSS.supports` but through the geometry obtained on a probe element: an engine
can recognise a property's syntax without producing any effect from it, and
that gap is exactly what is being looked for. Same reason for `@layer` and
`@property`, which `CSS.supports` cannot query at all — the rule is injected
and the page checks whether it produced anything.

### Five query parameters carry the state of the view

On `/album/:albumId`:

- `?photo=<mediaId>` — the viewer is open on this media item. The Back button
  closes it, and a shared link reopens the same view.
- `?panel=comments` (or `info`) — the open tab of the side panel. This is what
  makes it possible to land on the **conversation** and not just the image:
  both the activity drawer and notification emails point to
  `?photo=…&panel=comments`. Without this parameter, they opened the photo while
  leaving the messages closed, i.e. invisible — an email announcing a message
  led to a silent image. An unknown value means "panel closed" (`isPanelTab`).
  The panel is therefore no longer local state of `Lightbox`, which now receives
  it as a prop.
- `?order=desc` — chronological direction. **The album carries the default**
  (`Album.sortOrder`), not a constant: a trip is told from the first day to the
  last, a library fed continuously is read from the end. The parameter is
  written only when it contradicts that preference — the same rule as
  `?group=`. An unknown value is resolved back to the settled direction
  (`isSortOrder`), so a hand-crafted URL cannot trigger a 400.

  On top of that there is a **per-album memory in the browser**, which the
  grouping does not have: `lukarn:album-order:<albumId>` (see
  `lib/albumOrder.ts`). The priority is **URL > browser > album**. The URL
  first because it is an exact view, shared or received by email, and the
  recipient's local memory has no business contradicting it; the browser next,
  because switching back to the same album's default at every visit is exactly
  what a memory is meant to avoid. Toggling the direction **always** writes to
  the browser, and to the URL only if the new direction contradicts the album.

  As long as none of the three sources has answered — album not yet loaded,
  nothing in memory, no parameter —, `resolveOrder` returns `null` and
  `useAlbumItems` stays **disabled**. Without this guard, discovering an album
  would load two hundred items in a direction rejected on the next response.
  The request stays `pending`, and the grid's `Spinner` covers the wait.

- `?group=day` — how the grid is split into sections. Same default-carried-by-
  the-album rule (`Album.groupBy`), without the per-browser memory: grouping is
  a property of the album, not a reader's habit. An unknown value is resolved
  back to the album's preference (`isGroupBy`). Unlike `order`, this parameter
  **never goes to the server** and does not enter the list's TanStack Query
  key: the query stays the same, only the layout segments it differently, so
  switching reloads no photo.

  **Trap**: `album` and `items` are two separate queries, and both `groupBy`
  and `order` switch to the album's preference once the first one arrives. The
  effect that resets the selection to zero and scrolls back to the top
  therefore waits for `album.isPending` to settle — without this guard, opening
  an album set to "day" would jump the page a second time, after the fact,
  under the cursor of someone who had already started scrolling.

- `?day=YYYY-MM-DD` — **the only ephemeral parameter**, and that is what sets
  it apart from the other four: it does not describe a state of the view but a
  destination. A search result writes it, the page scrolls to the matching
  section, then clears it via `replace`. Kept around, it would pull the page
  back to that day on every layout recalculation, and the Back button would
  replay the jump instead of going back.

  It is honoured only in day grouping — hence the `?group=day` that search
  writes alongside it. In month grouping, section keys look like `2026-07`: the
  day does not exist there, and the effect would paginate the whole album
  looking for a section that will never come.

  As long as the section is not in `grid.layout.sections` and pages remain,
  `fetchNextPage()` — exactly the pattern already in place for `?photo=`. If
  the album runs out without finding it, the parameter is cleared rather than
  left to paginate indefinitely. The effect depends on the section's
  **ordinate**, not the section itself: `grid` is a fresh object on every
  render, and depending on it would replay the effect mid-scroll.

The five are independent: `setParams` always starts from the current
parameters, otherwise opening a photo would clear the sort order and closing it
would restore it on its own. It accepts **several keys at once** for gestures
that touch two: closing the viewer removes the photo _and_ its panel, and two
successive writes would leave an intermediate history entry where one left
without the other. A panel left alone in the URL would also reopen the next
photo on a tab nobody asked for again.

Opening a photo pushes a history entry; navigating from one photo to the next
with the arrows uses `replace`, otherwise browsing through 50 photos would
stack 50 entries and the Back button would no longer return to the grid.
Opening and closing the panel follows the same rule, for the same reason.

`order` and `group` are driven from two toggles in the `TopBar`, declared as
`actions` (see "Top bar" below) and built on the same pattern: **the label
announces the current state** ("By month"), **the action announces what the
click will do** ("Group by day"), and the `aria-label` combines both — the
label disappears under `lg` for lack of room, but the accessible name must stay
complete. Changing either one resets the keyboard selection to `-1` and scrolls
back to the top: reversing the sort renumbers the album, changing the grouping
recomputes every height, and in both cases the retained position would point
somewhere else.

## Sign-in — `pages/LoginPage.tsx`

Two fields, and a second path underneath them: **"Sign in with a phone"**. It
is there for the screen that has no keyboard — a television, where every
character is typed with a remote (D260809c).

**The identifier is trimmed before it is sent**, and the server trims it too
(`05-api.md`): `USERNAME_PATTERN` allows no whitespace, so no account carries
any, and a stray edge space only ever comes from mobile autocomplete or a
paste. Without this trim, the input looks fine on screen and the rejection
arrives with a wrong-password message — the worst possible diagnosis, since it
points at the other field. The password, on the other hand, is sent as typed:
it is allowed to carry whitespace at either end.

### `components/PasswordInput.tsx`

The masked field and its **eye**, which reveals its characters. A typo made
blind is indistinguishable from a forgotten password: without this button, the
only recourse is to clear and start over, on the mobile keyboard where the typo
is precisely most likely. The component is also used by the `TextField` in
`components/admin/ui.tsx` whenever its `type` is `password` — a single gesture
for signing in and for creating an account.

The state starts out **masked on every mount**: a secret is never left in the
clear on a screen someone is leaving behind.

The pairing panel lives in `components/DeviceLogin.tsx`, and it requests
nothing until it is opened: a pairing request triggered merely by showing the
sign-in page would fill the table for nothing. Once opened, it shows the QR
code, the plain-text code underneath it, and polls the server every two
seconds until the session arrives.

**The request is born from the click, in `LoginPage`, not from a mount effect
of the panel.** This is not a matter of style preference: under `StrictMode`,
the simulated unmount detaches the observer of the in-flight mutation — TanStack
Query's `MutationObserver` does not reattach on remount —, so the request
completes without its result reaching anyone and the screen spins forever. The
panel therefore receives the request as a prop, along with a way to reopen it.
This is also the general rule: a mutation belongs to a gesture, never to a
mount.

- **The QR code contains only the URL** `<origin>/pair?code=…`, never a secret:
  it is displayed in a living room. It is the `deviceCode`, held by the sole
  browser that made the request, that raises the session.
- **The origin comes from `window.location`**, not `PUBLIC_URL`: the address to
  open on the phone is the one this particular screen is reachable at.
- **The code is displayed in full** below the QR code, grouped by four. It
  serves two purposes: entering the pairing without a camera, and above all
  **verifying** on the phone that the screen being approved is indeed the one
  being looked at.
- **An expired request says so and can be relaunched** with a button, rather
  than leaving a dead QR code on screen.
- Polling stops as soon as the page loses its panel or the session arrives. The
  component is mounted on a screen that stays on for hours: a loop that
  survived its closing would have no reason to stop.

### `lib/qr.ts`

Encodes the URL as a QR code and renders a single SVG `path` — one rectangle
per module, concatenated into a single drawing command. An inline `<svg>`
rather than a `data:` image: the CSP only allows `data:` for images inlined by
Vite (see [04](./04-security-and-access.md)), and a path scales without jagged
edges on a two-metre screen.

The encoding itself comes from `qrcode-generator`, a dependency with no
dependencies of its own: Reed-Solomon and masking are not worth writing by hand
to save ten kilobytes. The correction level is `M`, and the type is chosen
automatically by the library based on the length of the URL.

### Approval — `pages/PairPage.tsx`

The page the phone opens. `RequireAuth` guards it: without a session, it
redirects to `/login` and comes back once signed in, code included.

It shows the code **exactly as the screen shows it**, and asks for explicit
confirmation. That is the only possible check against a QR code that is not the
one being looked at — everything else is up to whoever approves it (D260809c).
Three states follow: approved ("the screen is about to open"), expired, or
already claimed by another account.

## Top bar — `components/TopBar.tsx`

A single row, at every width, and **65 px reserved** rather than derived from
the content (`min-h-16` on the row, plus the hairline). A page with no
subtitle — the album list — otherwise gave a 57 px bar where an album page
makes 65: everything centred vertically in it jumped by 8 px between one page
and the next, and the account badge, alone at its end, was what showed it
best.

Two families follow one another and never mix: **what this page does** — back,
title and its subtitle, activity, view controls — then, all the way to the
right, **who is looking at it**: a badge carrying the account's initial, which
opens Admin, Sign out and Install.

| Width        | What is visible                                           |
| ------------ | --------------------------------------------------------- |
| `< sm` (640) | Back, title, **Activity**, a **View** menu, the badge     |
| `≥ sm`       | Same, view controls unfolded in the bar as **icons only** |

**`Activity` stays inline at every width**, and never enters a menu. Its icon
carries the unread badge, the only sign that a conversation has moved
somewhere; tucked into the menu, it would no longer signal anything. Exactly
the rule for the viewer's "Comments" button, for the same reason. The button is
declared through the `feed` prop and not in the `actions` array, which is
precisely what falls back into the menu.

The thresholds come from measurements, not an aesthetic choice. At 393 px,
five aligned controls pushed the view toggles onto **a second row of their
own** — a 101 px header, the album title shrunk to `D.` and the subtitle to
`120 items · Febr…`. And at 768 px, showing all five labels shrank the title
from 456 to 144 px by truncating the subtitle.

**The label never comes back at any width**
([D90](./08-decisions/D90-view-controls-identify-themselves-on-hover-at-every-width.md)).
It used to reappear beyond `lg`, where room is not actually short: "Newest
first" on its own sat wider than the album subtitle, for a setting touched
once per visit. Both controls name themselves on hover — tooltip and
accessible name carry both the state **and** the effect of the click, "Newest
first — Show oldest first" —, and their state reads from the artwork: the
direction of the arrow, one or two lines in the calendar. Under `sm` it is the
menu that names them in full, where room is exactly what is least scarce.

The buttons in the row are **36 px squares**, all of them. Without a label, two
28 px targets sat next to the activity button, alone at its size, and the
irregularity stood out on an otherwise aligned row.

The **View** menu only renders if the page declares controls; without this
guard, `/` and `/admin` would offer a target under `sm` that opens nothing.

**The bar is a surface, not a portion of a page**: translucent `ink-800` over a
body in `ink-900`, hairline in `ink-700`. It used to be `ink-900/85`, exactly
the body's colour — the band then existed only through a one-pixel hairline,
and on a wide screen the badge, alone at its end, looked like it was floating
over nothing. The hairline steps up by the same amount, otherwise it would
dissolve into the background it delimits. This is the same reasoning already
applied to the viewer's panel, one step above its own.

**Page controls are described, not rendered.** `TopBar` no longer takes
`children` but an array of `actions`:

```ts
interface TopBarAction {
  label: string; // the current state, in the tooltip: "By month"
  action: string; // what the click will do, in the menu: "Group by day"
  icon: ReactNode; // the content of an <svg viewBox="0 0 24 24">, not the tag itself
  onSelect: () => void;
}
```

This is the only shape that lets the **same** control render as an icon in the
bar and as a labelled line in the menu. With `children`, the page supplied JSX
the bar knew nothing about: the label could only be hidden, and the icons ended
up anonymous.

`icon` carries the **artwork** and not the tag — `path`, `rect` elements —, like
the viewer's actions. The bar wraps it, and only the bar knows at which size:
20 px inline, matched to the row's other icons, 16 px in the menu, matched to
every menu entry in the application. A page that shipped the finished `<svg>`
would impose the same size on both — which used to be the case, and the
four-pixel gap with the activity button was visible as soon as the label
stopped hiding it.

**The account fits in a badge**, at every width. Admin, Sign out and Install
used to be three buttons aligned in the bar, and the signed-in identifier lived
in the album list's subtitle — on the left, under "Albums", far from the
buttons it relates to, and in the spot an album page gives to the item count
and the period. Three actions none of which are used daily thus occupied the
room the title needed: folding them behind a single target gives it back, and
finally groups the identity with what can be done with it.

What the menu shows at the top: the **identifier**, then the **address** of the
commenter identity if the session carries one. Both, because they say
different things — the identifier opens albums and can be shared by an entire
household, the address says who is signing (see
[04 — Identities](./04-security-and-access.md#commenter-identity)). The badge
abbreviates the **first line**: an initial taken from elsewhere would read as a
defect the moment the menu opens.

No photo, no remote avatar service: a single letter, rendered locally.
Fetching an image from a third party based on the address would hand it over
on every page load, for a purely decorative gain on an application that is
self-hosted precisely to avoid that (D86).

**Install comes last, after Sign out.** The prompt appears and disappears
depending on the browser and on whether the app is already installed; placing
it elsewhere would shift the position of the permanent controls from one visit
to the next.

The menu itself lives in `components/ActionMenu.tsx`, shared with the viewer.
It closes on an outside click, on `Escape` — returning focus to its button —
and **before** running the chosen action, since that action may navigate or
open a panel. Its `Escape` listener runs in the **capture** phase and stops
propagation: in the viewer, the same key also closes the photo, and a single
press must not do both.

A shared component rather than a menu per call site: these are the three
closing rules that would get rewritten slightly wrong the second time around.

### Search — `components/SearchBox.tsx` and `lib/useDebounced.ts`

**On the home page only.** Search covers the entire library, and it is past
about twenty albums that "where are the photos from Marseille" stops having an
answer: inside an album already open, the question no longer arises.

It arrives through a `search?: ReactNode` prop on `TopBar`, rendered between
the title and the activity button. A `ReactNode` and not a `TopBarAction`-style
descriptor: the field has only **one** rendering — it does not fold into a menu
entry, nobody searches inside a menu — and its state belongs to the page that
mounts it.

**The field is centred in the bar**, and that is what fixes its width: from
`sm` on it stops stretching, it holds at 20 rem, and the title on the left as
well as the account controls on the right share the rest equally — hence the
symmetric `flex-1` on both sides. Stretched all the way to the controls, it
used to sit flush against them and the bar looked like it leaned to that side.

**The single row is preserved at every width.** Under `sm`, the "Albums" title
disappears (`hidden sm:block`) and the field takes over the whole line: a fixed
20 rem would leave a blank in the middle of a 393 px screen. On the root page,
the title says nothing the URL does not already say, whereas a second row
would cost 40 px of header on an application where what needs to stand out is
the photos.

**Suggestions are navigable, not textual.** Three groups — Albums, Days and
places, Photos —, five entries each at most, and each entry leads somewhere:
`/album/:id`, `/album/:id?group=day&day=…`, `/album/:id?photo=…`. An empty
group disappears along with its title.

**A combobox in the ARIA sense**: `role="combobox"` on the field,
`aria-expanded`, `aria-activedescendant`, list as `role="listbox"` and groups
as `role="group"`. Focus never leaves the field — moving it onto the options
would interrupt typing, which is the whole point of a suggestion. The list is
made of `div` elements carrying the roles, not `ul`/`li`: a `listbox` may only
contain `option` and `group`, and the implicit `list` role of a nested `ul`
would get in between.

| Key      | Effect                                                  |
| -------- | ------------------------------------------------------- |
| `/`      | Focuses the field (`useShortcut`, ignored while typing) |
| `↑` `↓`  | Cycles through suggestions, wrapping around             |
| `Enter`  | Opens the highlighted suggestion                        |
| `Escape` | Closes the list; a second press clears the field        |

The first result is highlighted from the start: typing then pressing `Enter`
is the most frequent gesture, and requiring an arrow key first would turn a
shortcut into a manoeuvre. `Escape` in two steps because closing and clearing
in one go loses a search that was only meant to be hidden while looking at the
page.

A click on an option is caught on `pointerdown` with `preventDefault`, not on
`click`: the pointer leaving the field makes it lose focus, and the "click
outside" listener would close the list before the click reached the option.
The list is positioned `absolute` rather than `fixed`, for the same reason as
`ActionMenu`: the bar carries a `backdrop-blur`, which makes it the containing
block for a fixed-position element.

**`lib/useDebounced.ts`** delays input by 150 ms before it reaches `useSearch`.
Without it, every character fires a request: "Marseille" would launch nine,
eight of them stale before arriving. Beyond 150 ms the list starts to feel like
it is lagging behind the fingers.

`useSearch` carries `placeholderData: keepPreviousData`: the previous list
stays on screen while the next request is in flight. Without it, every
keystroke would empty it and then refill it — this is the only place in the
application where a response arrives at keyboard cadence, and a list that
flickers under the finger is unreadable.

## State management — `api/hooks.ts`

`QueryClient` default settings (`main.tsx`): `refetchOnWindowFocus: false` —
albums only change at the pace of syncs —, a `staleTime` of 60 s, `retry: 1`.

| Hook              | Key                                   | Particularity                                                                                                                                                                                                                                                            |
| ----------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useMe`           | `['me']`                              | `staleTime` 5 min. Does **not retry** on 401: that is the normal response for a visitor who is not signed in, not an incident.                                                                                                                                           |
| `useLogin`        | —                                     | Writes `me` into the cache and invalidates `albums`.                                                                                                                                                                                                                     |
| `useLogout`       | —                                     | `queryClient.clear()`: the cache holds the previous session's albums and media.                                                                                                                                                                                          |
| `useAlbums`       | `['albums']`                          |                                                                                                                                                                                                                                                                          |
| `useAlbum`        | `['album', id]`                       |                                                                                                                                                                                                                                                                          |
| `useAlbumItems`   | `['items', id, order]`                | `useInfiniteQuery`, server-side cursor. **`order` is part of the key**: without it, TanStack would resurface pages loaded in the other direction and keep paginating backwards. A third `enabled` argument keeps it stopped until the direction is resolved.             |
| `useAlbumDays`    | `['days', id]`                        | Enabled **only in day grouping**: by month, notes are hidden and the request would serve no purpose. No `order` in the key — days are the same in both directions. Also returns a `Map` memoised by day key, on which layout memoisation depends.                        |
| `useMediaDetail`  | `['detail', albumId, id]`             | `staleTime: Infinity`, enabled **as soon as a photo is displayed**: the "Info" panel then opens on rows already in place, and this is the request that counts the photo as opened (D260809h). One per photo actually displayed — D21's preloading applies to the images. |
| `useCommentsFeed` | `['comments', albumId ?? '', 'feed']` | `useInfiniteQuery`, server-side cursor, `staleTime` 30 s. The literal is **last**, as with `commentCounts`: placed first, it would collide with the thread of an album called "feed". Mounted as soon as a gallery page displays — it carries the badge.                 |
| `useAdminStatus`  | `['admin','status']`                  | `refetchInterval` of 2 s while an album is `running`, no polling otherwise.                                                                                                                                                                                              |
| `useAdminUsers`   | `['admin','users']`                   | Administration list of accounts.                                                                                                                                                                                                                                         |
| `useAdminAlbums`  | `['admin','albums']`                  | Same conditional polling as `useAdminStatus`: the admin page reads albums here, not from the status.                                                                                                                                                                     |
| `useSettings`     | `['admin','settings']`                |                                                                                                                                                                                                                                                                          |

One mutation per admin operation — `useCreateUser`, `useUpdateUser`,
`useDeleteUser`, `useCreateAlbum`, `useUpdateAlbum`, `useDeleteAlbum`,
`useResync`, `useUpdateSettings` — each invalidating whatever it makes stale.
`useUpdateAlbumDay` is the exception: it **writes the response into the
cache** instead of invalidating. Header height depends on the note, so
invalidating would make the grid jump a second time, for one more network
round trip. It also replays the server's rule in passing — a day emptied of
its note and place only stays in the list if the EXIF gives it a place. Two
invalidation rules are worth noting: **writing an account also invalidates the
album list**, because `AdminAlbum.members` describes the same assignment seen
from the other side; and **writing an album invalidates `['albums']`**, the
list the current session reads. Deleting an album additionally removes its
media from the client cache (`['album', id]`, `['items', id]`), which have
just disappeared from the index.

`api/client.ts` is the only network layer: `credentials: 'same-origin'`, and an
`ApiError` class that carries the HTTP status to distinguish a 401 from an
actual failure. `mediaUrl` builds the URLs for thumbnails, full-screen
rendering, originals, and downloads.

## Justified layout — `lib/justify.ts`

`computeLayout(items, options)` produces rows of variable height whose images
keep their aspect ratio and fill the width exactly — the Google Photos layout.

Principle: media arrive sorted, they are split into consecutive sections
(`sectionKeyOf`, see below), then filled row by row. A row closes as soon as
the height needed to fill it drops below `targetRowHeight`. The exact height is
`(width − gaps) / sum of ratios`.

Details that have a reason:

- **A section's last row is not justified.** Stretching it would give
  oversized thumbnails for two photos; it stays at `targetRowHeight`.
- **The last item in a justified row absorbs the accumulated rounding**
  (`containerWidth - x`), so the row ends exactly at the right edge without a
  one-pixel sliver.
- **Ratios are clamped** between 0.4 and 3.5. A 20:1 panorama would crush its
  whole row. A media item with no dimensions falls back to 4/3.
- **`targetRowHeightFor(width)`** scales from 110 px under 480 px wide to
  225 px beyond 1920: on mobile, tall rows would give one photo per row.

`packages/web/test/justify.test.ts` locks in: each media item placed once and
only once, justified rows finishing exactly at the edge, the last row not
stretched, sections stacking without overlap — by month as well as by day.

### One header height per section

`LayoutOptions.headerHeightFor?: (key) => number` gives a section the header
height it needs; omitted, or returning zero, `headerHeight` applies instead.
Each `LayoutSection` carries its own, so the component can size its box from
it.

**Height is an input to the calculation, never a measurement**, and that is
the one delicate point in the whole feature. The entire grid is positioned
before a single DOM node exists — that is what makes virtualisation and the
absence of layout shift possible. A header that decided its own size once
mounted would land under its own photos, and there would be nothing to catch
it.

`useGridLayout(items, groupBy, days)` builds the function, whose calculation is
isolated in `sectionHeaderHeight` — pure, exported, and verified on its own:
`GRID_HEADER_HEIGHT + (place ? 1 : 0) + note lines`, each line worth
`GRID_HEADER_LINE_HEIGHT` (20 px). It returns `undefined` in month grouping —
a note belongs to a day, and there would be no header to attach it to among the
thirty. The layout stays pure and testable without a DOM, which is the
invariant `justify.test.ts` locks in.

This constant is a **contract with `SectionHeader`**, which must fit inside
it: hence the explicitly fixed line height (`leading-5`). It is the
**line height** that holds the contract, never the font size: bumping the
place and note from 13 to 14 px does not touch it as long as `leading-5`
stays.

**The number of lines in the note is measured, not estimated** —
`lib/measureLines.ts` renders the text in an off-screen probe carrying the
same classes (`GRID_HEADER_NOTE_CLASS`) and the same width, then divides the
resulting height by the line height. The result serves **both** to reserve
the height and to bound the rendered box (`descriptionLines`, carried by
`GridLayout`), so the two cannot diverge. This is what lets a long note
display in full without falling back to a free height: an estimate based on
text length, by contrast, gets it wrong (D85, D93).

### Collapsed sections

`LayoutOptions.isCollapsed?: (key) => boolean` collapses a section: it keeps
its header, places no rows, and its height is exactly `headerHeight` — the
subtraction of the last `gap`, which only makes sense after a row, is skipped.
Following sections move up by the same amount.

Collapsing goes through the calculation and not a `display: none` at render
time, for the same reason as header heights: `totalHeight` governs the
scrollbar and virtualisation. Hiding thumbnails after the fact would leave the
page as tall as everything it no longer shows (D68).

`LayoutSection` therefore carries two more fields:

- **`count`**, the number of media items in the section. It cannot be inferred
  from `rows` — collapsed, the section has none left, and that is exactly when
  its header must announce what it is hiding.
- **`collapsed`**, so the header can orient its chevron.

Cells of a collapsed section **appear nowhere**, neither in its `rows` nor in
`layout.rows`. This is the invariant everything that walks the grid depends
on: virtualisation has nothing to mount, and `moveSelection` nothing to
target. `justify.test.ts` locks it in, along with the following sections
moving up and `count` being preserved.

Collapsing applies to both groupings, month included: restricting it to day
would have required one more condition for nothing, and the keys never clash
(`2026-07` versus `2026-07-14`). `useGridLayout(items, groupBy, days,
collapsedKeys)` receives it as a set of keys, held in memory by `AlbumPage` —
neither URL nor `localStorage` (D68).

**A collapsed section also changes its base height**
(`GRID_COLLAPSED_HEADER_HEIGHT`, 44 px against 56). Header height breaks down
into three constants, and only the last one drops when collapsed:

| Constant                   | Value | Role                                                       |
| -------------------------- | ----- | ---------------------------------------------------------- |
| `GRID_HEADER_PAD_TOP`      | 20    | Space above the title. **Invariant.**                      |
| `GRID_HEADER_TITLE_HEIGHT` | 24    | The title line (`leading-6`, `h-6`).                       |
| `GRID_HEADER_PAD_BOTTOM`   | 12    | Breathing room before the thumbnails. Zero when collapsed. |

**Header content is aligned to the top of its box, never the bottom**, and
that is what makes collapsing usable: the title sits at
`section.y + GRID_HEADER_PAD_TOP` regardless of state, and the height change
is absorbed at the bottom, where nothing else is left. Aligned to the bottom —
as it used to be — shortening the box pushed the title up by the same amount,
and the label jumped 20 px under the cursor on every click. A collapse button
that moves its own label is unusable.

The place and the note keep their cost, since they stay displayed: that is the
whole point of a collapsed day.

### By month or by day — `GroupBy`

`LayoutOptions.groupBy` chooses the grouping; omitted, it is
`DEFAULT_GROUP_BY`, so month. The type comes from `@lukarn/shared` even though
no route carries it: it is an interface value, not a payload, and duplicating
it on the front end for the sole reason that it never crosses the network
would give the same vocabulary two sources.

| `groupBy` | Key (`sectionKeyOf`)    | Header (`sectionLabelOf`)            |
| --------- | ----------------------- | ------------------------------------ |
| `month`   | `monthKey` → `2026-07`  | `monthLabel` → "July 2026"           |
| `day`     | `dayKey` → `2026-07-14` | `dayLabel` → "14 July 2026", "Today" |

No grouping by year: on a holiday album it would produce only one section,
that is, no landmark at all.

What has a reason:

- **Both keys are slices of the ISO string**, never a `getMonth()` or a
  `getDate()`: those read the browser's time zone and would flip a 23:30 photo
  into the wrong section (see "Dates: all in UTC"). This is also what makes
  `dayKey` insensitive to sort direction.
- **The split stays a linear pass**, with no sort and no hash table: the
  received sequence is already ordered, and grouping by key would reorder it
  — an ascending sort would display headers backwards.
- **A day key carries the month**, so 30 March and 30 April can never land in
  the same section.
- **`dayLabel` names the two most recent days** "Today" and "Yesterday".
  Twenty headers that differ only by the day number force reading each digit;
  beyond yesterday, a relative marker ("5 days ago") would demand one more
  mental calculation than the date itself. The full date goes through
  `formatDate` (`lib/format.ts`), hence in UTC.
- **The comparison against "today" is the only local-time date in the entire
  front end** — see
  [D31](./08-decisions/D31-grid-grouping-lives-in-the-url-but-today-is-read-from-the.md).
- **By day, the grid is much taller**: each section costs a header (56 px), a
  margin (28 px), and an unjustified last row. On a pathological album of
  3,000 photos all from different days, 94,000 px by month becomes
  837,000 px by day. This is the accepted consequence of the split, not a
  calculation defect.

### The rule that explains everything else

**Dimensions come from the index, so layout is computed before any image
loads.** The grid knows the position and size of every thumbnail before a
single image byte arrives. Consequences:

- no layout shift while loading — each `<img>` already has its box reserved
  and simply fills it (`object-cover`);
- the scrollbar has the right length from the very first render;
- virtualisation is possible, since what falls inside the viewport is known
  without measuring anything.

This is also why `drive/sync.ts` corrects dimensions for EXIF rotation before
writing them: a portrait photo stored as landscape would give a
badly-proportioned box the image would never fill.

## Virtualisation — `lib/useGridLayout.ts` and `components/JustifiedGrid.tsx`

`useGridLayout(items, groupBy, days)` measures the container (`ResizeObserver`

- `resize`), tracks scrolling (passive `scroll`), and memoises `computeLayout`
  on `[items, width, groupBy, headerHeightFor]` — the last dependency being
  derived from `days`. This is not a detail: it is what makes the layout
  recompute when a day's note changes height, the very invariant
  `useUpdateAlbumDay` protects by writing into the cache rather than
  invalidating. It exposes a window `[visibleFrom, visibleTo]` widened by
  `OVERSCAN_PX = 900` on each side, so a fast scroll stays filled.

The `ref` is a **callback ref** and not a `useRef`: the container only mounts
once the media have loaded, so an effect with empty dependencies would run
while `ref.current` still holds `null` and would never observe anything.

`JustifiedGrid` renders a container with height `layout.totalHeight`, then
absolutely positions **only** the sections and rows that intersect the
window. A 10,000-photo album thus fits in a few dozen DOM nodes. Loading the
next page triggers once `visibleTo + 1500 px` exceeds the total height.

**Unmounting a thumbnail does not cancel its request** — and this is the trap
that has cost the most here. Removing an `<img>` from the DOM lets the browser
carry its download through to completion: a thumbnail nobody is looking at
anymore still occupies one of the **six** connections HTTP/1.1 grants per
origin. A cold grid queues up several dozen of them, and everything sent
afterwards lands behind them — including the `GET /items` the display depends
on. The clearest case is reversing the sort order, which relaunches `/items`
behind the previous order's thumbnails, now useless but still in flight: the
album stays on "Loading photos" until they drain. This is what made a first
cold open look like it had frozen.

**A failed thumbnail retries twice** before settling on the muted tile. The
server distinguishes the transient case — Drive timeout, rate limiting — with
a **503**, with no cache header, so nothing is memoised and the next request
genuinely goes out again (D60). An `<img>` does not retry on its own: without
this mechanism, a passing saturation would leave an empty tile until the next
page reload. The delay doubles and **a random component spreads it out** —
thirty thumbnails failing together on a cold grid, and synchronous retries
would go straight back to saturating the same six connections. The retry
remounts the `<img>` via its `key`: the URL does not change, it is the remount
that relaunches the request.

`Thumb` therefore clears its `src` on unmount (`releaseIfDetached`, in
`lib/imageRelease.ts`), the only gesture that genuinely cuts the request. The
check on `isConnected` is not a stylistic precaution: `StrictMode` replays
mount and unmount **without touching the DOM**, and without it the first
screen's thumbnails lost their `src` the instant they displayed — React does
not rewrite it, since its view of the DOM believes it unchanged.

**The viewer owes the same gesture, for much heavier payloads**
([D87](./08-decisions/D87-a-departed-image-must-be-abandoned-or-it-blocks-the-queue.md)).
`ZoomableImage` is remounted on every photo (`key={item.id}`), and its
outgoing `<img>` carries away a roughly one-megabyte `full` that nobody is
waiting for anymore. Measured by browsing twenty-five photos with the arrow
keys then closing the viewer: **89 requests in flight**, twenty-four of them
orphaned `full` renders, with the grid's sixty thumbnails queued behind them —
black for a minute, which reads as thumbnails that will never load. The same
`releaseIfDetached` on unmount, plus abandoning the `hd` render if one was in
flight, brings the measurement down to **ten requests in flight and zero
orphaned `full`**, and the grid fills in five seconds. The helper therefore
lives in `lib/` rather than in `Thumb`: two callers, one reason.

Filtering sections is a linear scan of `layout.sections`, redone on every
scroll event. Day grouping multiplies this array, which raises the question:
measured on the worst case imaginable — 3,000 photos all from different days,
so 3,000 sections —, this scan costs **0.02 ms** per scroll event, against
0.004 ms for the 99 sections of the same album by month. A frame's budget
absorbs fifty of those. A binary search on `y` would bring nothing measurable
and would saddle the component with a sort invariant it does not have today.
`computeLayout` itself takes 17 ms on this worst case, but it is memoised: it
only replays on a change of width, list, or grouping, never on scroll.

### Section headers — `components/SectionHeader.tsx`

Each section renders a `SectionHeader`: the date, the item count, the place if
the photos carry one, the note if someone wrote one, and the edit pencil for an
administrator in day grouping.

- **The title is a collapse button**, `aria-expanded` and all, preceded by a
  chevron that rotates. The `button` is **inside** the `h2` and not the other
  way around: an `h2` is flow content, which a `button` is not allowed to
  contain, and this is the accordion pattern screen readers expect.
- **The count displays in both states.** It is what makes the grouping
  readable when expanded, and what says what a collapsed section contains.
  The unit ("items") drops under `sm` for lack of room; the number stays, and
  the button's accessible name carries the whole thing.

- **Three alignment details, each fixing a measured defect.** The title
  (16 px) and the count (12 px) are aligned on their **baseline**: centred by
  their boxes, their letters did not land at the same level. The count takes
  `leading-none`, because a line height equal to the title's gives it a box
  tall enough that the alignment drops by two pixels — it hung below a
  collapsed section, whose box is exactly `PAD_TOP + TITLE_HEIGHT`. Finally
  the place and the note take `pl-[22px]`, the width of the chevron and its
  gutter, so they start from the same x-coordinate as the title's **text**;
  without it the header's three lines aligned on two different edges. The
  chevron stays alone in its gutter, like the arrow of a tree view.
- **The displayed place** is `place ?? autoPlaces.join(' · ')` — manual entry
  wins over the deduction. The calculation lives in `placeLabelOf`, shared
  with the height calculation **and with the viewer**: a place counted on one
  side and not displayed on the other would leave a gap, the reverse would
  make the header overflow onto the photos.
- **The place fits on one truncated line** — it is short by nature, and its
  full text remains in `title`, in the `i` panel, and in the viewer's strip.
  **The note displays in full**, over as many `GRID_HEADER_LINE_HEIGHT`
  (20 px) lines as it needs: the count comes from the measurement described
  above, never from a free height the layout could not anticipate (D49, D85,
  D93). The `line-clamp` set on the paragraph reuses that same number: it
  truncates nothing as long as the measurement lands right, and it is the
  only fallback available on the day it does not. `whitespace-pre-line`
  additionally preserves entered line breaks, as `MediaCaption` and
  `AlbumDescription` already do for the same note — since the probe carries
  the same class, those line breaks enter the reserved height on their own.
- **The editor opens as an absolute overlay**, never by pushing the flow:
  growing the header on open would shift the rest of the album under the
  cursor. The "place" field takes `autoPlaces` as its `placeholder` — exactly
  what is being replaced stays visible.
- **The pencil only fades under a fine pointer** (`pointer-fine:opacity-0`).
  One pencil per day, all visible at once, would turn the grid into a form —
  but in Tailwind v4 `hover:` is already scoped to `@media (hover: hover)`, so
  a plain `opacity-0` made it **permanently** unreachable by touch: an
  administrator on a phone could not annotate a single day. Hiding is
  therefore reserved for the one place where hover can reveal it, and the
  pencil stays visible on touch.

  The native `pointer-fine:` variant rather than an arbitrary
  `[@media(hover:hover)]:`, which **was not generated**: Tailwind never
  extracted the candidate, the rule existed nowhere in the sheet, and the
  fix was not one — it looked right in the source and changed nothing on
  screen.

### Album description — `components/AlbumDescription.tsx`

It displays at the top of `<main>`, **across the grid's full width**, and
**edits in place** for an administrator. It used to be enterable only from
`/admin`, while a day's note is written with one click right below it in the
grid: two neighbouring texts, two gestures. The component removes that
asymmetry; `/admin` remains the only place to change the title, the Drive
folder, or the grouping.

- **The pencil is always visible**, unlike `SectionHeader`'s. The rule that
  hides that one there is about count — one pencil per day, all displayed,
  would turn the grid into a form. Here there is only one for the whole
  album: hiding it would gain nothing and would only make it hard to find.
  With no description, "+ Describe this album" takes its place, for lack of
  text to hover.
- **The editor opens as an overlay**, like a day's, and for one more reason
  here: pushing it into the flow would shift the whole grid downward, and
  `useGridLayout` only remeasures `offsetTop` on resize — a plain vertical
  shift would slip past it.
- **The text has no width bound, the editor keeps one.** The description caps
  the grid and takes its width: bounded to the usual typographic measure, it
  left two-thirds of the line empty on a large screen above a grid that
  itself runs edge to edge. The editor is a form, not text meant to be read: a
  two-thousand-pixel-wide input field is not proofread comfortably, so it
  stays at `max-w-prose`.
- **Length is bounded by `ALBUM_DESCRIPTION_MAX_LENGTH`**, exported by
  `@lukarn/shared` and applied on both sides. The server already bounded it,
  but with a literal the front end would have redeclared on its own.

On `AlbumsPage`, the description is clamped to two lines under the title: the
card cannot change height depending on the album without punching a hole in
the grid.

`Thumb` picks the variant via `pickThumbSize(displayWidth)`: the smallest of
the 320/640/1280 sizes that covers the display width multiplied by the DPR
(capped at 2). Always requesting 1280 would saturate bandwidth on a 200-
thumbnail grid. First-screen thumbnails use `loading="eager"`, the rest
`lazy`.

The `<img>` displays as soon as `item.hasPreview`, videos included: their
preview comes from Drive
([D92](./08-decisions/D92-a-video-preview-comes-from-drive-not-local-decoding.md)).
The playback badge then sits **on top of** the image — a `bg-black/45` disc,
white triangle, centred — because it is what distinguishes a video from a
photo at a glance and it must stay legible over a light preview. With no
preview, or after retries, the muted tile stays. Duration is shown in both
cases.

## Keyboard navigation

Two separate handlers, never active together: the grid's turns off when the
viewer or the help overlay is open.

| Context  | Key            | Effect                                                                  |
| -------- | -------------- | ----------------------------------------------------------------------- |
| Albums   | `/`            | Focuses the top bar's search field                                      |
| Search   | `↑ ↓` `Enter`  | Cycles suggestions · opens the highlighted one                          |
| Search   | `Escape`       | Closes the list, then clears the field                                  |
| Grid     | `← ↑ ↓ →`      | `moveSelection` over the actual layout                                  |
| Grid     | `Home` / `End` | First / last media item                                                 |
| Grid     | `Enter`        | Open the viewer                                                         |
| Grid     | `Escape`       | Return to the album list                                                |
| Viewer   | `← →`          | Previous / next media item                                              |
| Viewer   | `Home` / `End` | First / last                                                            |
| Viewer   | `Escape`       | Undoes one layer at a time: editor, zoom, panel, then closing           |
| Viewer   | `I` `C`        | Opens the panel on the Info · Comments tab (closes it if already there) |
| Viewer   | `F` `D`        | Full screen · download the original                                     |
| Viewer   | `Z`            | Zoom to 100% (one pixel of the available render = one screen pixel)     |
| Viewer   | `L`            | Hides or recalls the caption strip (preference remembered)              |
| Viewer   | `H`            | Hides all chrome: nothing but the photo                                 |
| Viewer   | `Space`        | Play / pause video (otherwise the page would scroll)                    |
| Anywhere | `?`            | Shortcuts cheat sheet                                                   |

With a mouse in the viewer: the wheel gives a progressive zoom centred on the
cursor, a **short click** switches to the native level at the targeted spot —
and switches back —, dragging pans inside the enlarged image. "Short" means
less than `TAP_SLOP_PX` (5 px) of movement between press and release: beyond
that, it is a drag, and it toggles nothing. See the Zoom section.

**By touch** (`lib/useSwipe.ts` and `lib/swipeTrack.ts`): the photo column is a
**rail** of three media items — previous, current, next — that the finger
moves pixel by pixel, snapping back into place on release.

Swiping existed before the rail, but **nothing showed it**: the screen stayed
still for the whole gesture and the photo changed all at once, once the finger
lifted. A gesture that cannot be seen cannot be discovered, and cannot be
repeated either. It is the rail's motion, and only that, which teaches the
gesture
([D260809e](./08-decisions/D260809e-the-photo-follows-the-finger-the-movement-teaches.md)).

- **Touch and stylus only.** With a mouse, the click already zooms; adding a
  photo change to it would make the click unpredictable depending on whether
  it moved three pixels or not.
- **Direction is decided once**, at the tenth pixel travelled and using the
  same 1.5 ratio as before: without it, a slightly diagonal vertical scroll —
  the most common gesture on a phone — would jump to another photo. Under
  those ten pixels, nothing moves. Beyond them, the gesture no longer changes
  nature, even if it curves.
- **Two ways to commit**, because there are two gestures: crossing 22% of the
  width (`COMMIT_FRACTION`), or flicking the rail past 0.35 px/ms
  (`FLICK_VELOCITY`) without looking. Keeping only one would make the other
  inoperative.
- **The snap-back takes as long as the gesture calls for** — 160 to 320 ms
  depending on the distance left to cover and finger speed. A fixed duration
  drags after a sharp flick and jumps abruptly after a slow, nearly-completed
  drag.
- **The edge is felt**: on the first and last media item, the rail only
  yields 35% of the gesture instead of ignoring it.
- **Disabled during zoom and on videos**, where the finger is used
  respectively to pan inside the image and to reach the native playback
  controls.

Two implementation points, both obvious once looked at backwards:

- **The photo only changes once the rail has arrived.** Requesting it earlier
  would remount `ZoomableImage` mid-animation, on a photo that is not yet the
  one the screen shows.
- **The rail only resets on an index change**, inside a `useLayoutEffect`. The
  viewer does not decide its own index, it requests one and gets it back via
  the URL: between the two, the rail stays wherever the animation left it —
  on the neighbour, already on screen.

Neighbours are mounted when the swipe is recognised and unmounted with it, and
add **no request at all**: the preloading described below has already put
their `full` render in the browser cache. They are `aria-hidden` and have no
handler — the real photo replaces them instantly, with its zoom and its panel.
The rail is the only thing that moves: arrows, header, and caption strip stay
still, otherwise the whole viewer would look like it was being dragged.

The ←/→ keys and the on-screen arrows do not use it, though: a keyboard-driven
viewer is browsed fast, and 250 ms of animation per photo would put a barrier
between two key presses.

#### No touch gesture works without `touch-action`

The viewer's photo column carries `touch-pinch-zoom`, and that is what makes
its two gestures possible: swiping from one photo to another, and panning
inside an enlarged photo. With the default value `auto`, the browser keeps the
right to interpret a one-finger drag as scrolling; it settles on that after
one or two `pointermove` events, emits `pointercancel`, and the handlers
abandon the gesture. Swiping then never reached its `pointerup`, and the
enlarged photo stopped after twenty-odd pixels — which feels like sluggishness,
not an interruption. `setPointerCapture` does not protect against this: it
guarantees receiving the rest of the events, it does not stop the browser from
cancelling the gesture.

`pinch-zoom` rather than `none`: it removes only one-finger scrolling and
leaves two-finger pinching, which the viewer needs (see the Zoom section). The
declaration lives on the column, not on `ZoomableImage`'s container: the rule
is the same for everything inside it, and a descendant inherits it through
intersection — the position marker therefore has nothing to declare. A video
is excluded from it, its native playback controls having their own touch
handling (D77).

`moveSelection` (`useGridLayout.ts`) is the delicate part: vertical moves
follow the layout's **actual rows**, whose thumbnail count varies, and target
the photo whose horizontal centre is closest. A fixed index offset would drift
the cursor to the left on every row.

It works **entirely in the space of placed cells**, never in that of the
original list's indices — including `left`, `right`, `Home` and `End`, which
used to be a plain `± 1`. The two spaces coincided as long as the grid showed
everything; a collapsed section separates them, and a `currentIndex + 1` would
send the selection onto a thumbnail absent from the layout: nothing left to
highlight, and `scrollSelectionIntoView` with no target (D68). A selection
that cannot be found — the day just collapsed under the cursor — starts over
from the first thumbnail still visible.

`scrollSelectionIntoView` only scrolls if the cell falls outside the viewport,
with a 24 px margin, and respects `prefers-reduced-motion`.

Thumbnails are `tabIndex={-1}`: navigation happens via the arrow keys,
including them in the tab order would double the keyboard path.

**None of these keys fire during text input**, nor while a modifier key is
held. The check lives in `lib/typing.ts` — `input`, `textarea`, `select`,
`contenteditable` — and all three handlers call it: the grid, the viewer, and
`useShortcut` for the `?`. It lives there because each used to carry its own
copy, and a single one was enough to diverge: the grid's only recognised
`input`, so the arrow keys, `Home` and `End` moved the selection instead of the
cursor whenever editing an album's description or a day's note — two texts
entered in a `textarea`, hence uneditable from the keyboard. The viewer keeps
one exception, and only one: `Escape` reaches it even from the comment field,
as the emergency exit.

## Viewer — `components/Lightbox.tsx`

- **The header locates, the bottom strip narrates.** At the top: the album
  and the day on one line, the place on the next — what situates the image.
  At the bottom, in `MediaCaption`: the hand-written texts. The exact
  timestamp stays in the `i` panel, where it already lived.

  **The filename has left this spot**
  ([D88](./08-decisions/D88-the-open-photo-says-where-it-comes-from-and-clears-the.md)).
  It used to occupy the top, in bold, even though `IMG_0004.jpg` says neither
  where, nor when, nor what — and it hid the album, the one piece of
  information genuinely missing when arriving via a shared link. It is not
  lost: `SidePanel` carries it at the top of the `i` panel, next to the
  technical data it belongs with. It is the **album title** that truncates
  when the line is too short, never the date: it is short and bounded, and
  that is exactly what an "Allemagne – Forêt Noire · Toda…" would sacrifice.

  Day labels come from `dayKey`, `dayLabel` and `placeLabelOf`, **the same
  functions as the grid**. A viewer computing its own date on the side would
  eventually announce something different from the header it was just opened
  from. `AlbumPage` therefore enables `useAlbumDays` as soon as a photo is
  open, no longer only in day grouping; since the `queryKey` is the same, an
  album already grouped by day triggers no extra request.

  Everything lines up on the **first line**: the text block's top inset
  (6 px under `sm`, 8 px beyond) is what brings its line to the centre of the
  icon buttons, 32 then 36 px tall.

  **The day's note has left this header**, where it used to live under
  `hidden md:block`. D70 had reserved it there for wide screens, and the
  trade-off held up: two more lines **stacked above the image**, on a phone
  where the photo is already cramped. That is no longer the question being
  asked — a caption below the photo does not crop the framing the same way,
  and it can be hidden with one gesture. The note therefore moves down into
  the strip, at every width, with the other texts (D84). The header keeps
  only what situates the image.

  **`h` hides all chrome** — header, arrows, and strip — leaving only the
  photo
  ([D88](./08-decisions/D88-the-open-photo-says-where-it-comes-from-and-clears-the.md)).
  The shortcut does not duplicate the caption's `L`: `L` puts away the bottom
  text and leaves the button that recalls it, `h` leaves nothing. The ←/→
  keys and swiping keep working: what is hidden is what can be seen, not
  what can be controlled. A single button remains in the top-right corner,
  the only way out for someone touching the screen. The state is not
  remembered across visits, unlike caption hiding — reopening the viewer with
  not a single landmark would leave someone who forgot the shortcut staring
  at a silent screen.

- **Progress is a bar stuck to the top edge**, full width and 2 px thick — a
  loading bar, not a layout element. Lower down, it used to cross the photo as
  a coloured line.

  **The numeric ratio sits right below it, centred, at 11 px**, no longer at
  the other end of the title row. Two ways of saying the same thing used to
  sit at opposite ends of the screen: the line gave the position without
  saying how much, the number counts it without saying where. Brought
  together, each reads the other, and the row gives back to the title the
  width a "900 / 900" used to permanently take from it — on a 393 px screen,
  that is what makes "Allemagne – Forêt Noire · 4 August 2026" fit in full.

  It is **out of the flow** (`absolute`, `top-1`), and that is what makes
  moving it free: in the flow, its fifteen pixels used to lengthen by the same
  amount a header already sitting on the photo — exactly what it had just been
  made to do. It fits in the band the gradient already occupied without
  putting anything there, between the line and the title's first row: header
  at 102 px on desktop and 92 px on mobile, the same as before.
  `pointer-events-none`, otherwise it would catch a click meant for the title
  it covers.

  It carries `aria-hidden`: the bar already declares `aria-valuenow` and
  `aria-valuemax`, and a screen reader would announce the same thing twice,
  two words apart.

  It is counted against `album.itemCount` and not the paginated list, which
  grows while browsing (D69).

- Freezes `document.body.style.overflow` on open, otherwise the wheel would
  scroll the grid underneath the image.
- Takes focus on open and **returns it to the previous element** on close.
- Videos: `<video controls autoPlay playsInline>`, native seeking via
  `Range`, and a `poster` set to the 1280 thumbnail when `item.hasPreview` —
  the grid's own, already in the disk cache and often in the browser cache
  too: the black rectangle of the wait disappears with no extra request
  (D92). The wait carries **no** indicator of its own: the `poster` occupies
  it, and the native controls already carry their own — stacking a second one
  on top made two spinners turn, one over the other
  ([D98](./08-decisions/D98-decoding-that-fails-without-an-error-and-one-spinner-too.md)).
  Failure, on the other hand, replaces the tag with a message and a download
  button: the file remains readable elsewhere even when this browser cannot
  decode its codec
  ([D79](./08-decisions/D79-an-unplayable-video-says-so-and-can-be-downloaded-instead.md)).
  It is detected two ways — `error`, and a `videoWidth` of zero on
  `loadeddata` or `playing`, the only trace of a half-successful decode
  (D98). Photos: `ZoomableImage`, remounted on every photo
  (`key={item.id}`) to reset zoom and framing without manually zeroing them
  out.
- **The video source is chosen by the client** — `lib/videoSource.ts`, a pure
  function tested alongside `preview.ts`, and for the same reason: a
  one-line rule whose error does not show. `chooseVideoSource` queries
  `canPlayType` on the **actual codec** of the video track, `video/mp4;
codecs="hvc1"`, rather than the bare type, to which everyone answers `maybe`
  (D98). Empty response: the tag points to `/playable`, the H.264 version the
  server has prepared (D260809b). Otherwise — including when the codec is
  unknown — it keeps `/original`, at full quality: that is what makes Safari
  and an iPhone, which decode HEVC, never see the transcoding. D98's detection
  remains the safety net behind this choice, for the browser that claims to
  read a format without managing to.
- **The failure message gains a sentence when the codec is known to be
  unreadable here**: a readable version is being prepared, and it will start
  playing there without asking for anything. Without it, a 404 on
  `/playable` would give D79's message — "the file remains downloadable" —
  to someone who, ten minutes later, could simply have watched it.
- **And the viewer watches for it.** As long as the wait lasts, it re-requests
  the first byte of `/playable` every twenty seconds (`Range: bytes=0-0`); on
  the first served response, `failed` flips back to false, the tag is
  remounted and its `autoPlay` takes over. Without this watch, the message
  would stay until the photo is reopened — that is, forever from the point of
  view of whoever stayed on the page, and that is precisely the person who
  wanted to watch this video.

  up in the console either way, the browser logging every rejected request:
  that is the only noise the watch makes. Twenty seconds because a transcode
  takes minutes and the queue serves one video at a time — polling more often
  would not make it arrive sooner. A failed poll changes nothing on screen:
  nothing is broken, the video simply is not ready yet.

  The watch only applies to this case: a **served** response is `immutable`,
  so a browser that has already obtained the version never asks for anything
  again.

- Downloading goes through a synthetic anchor rather than `window.open`: no
  popup blocking, and the browser manages its own download bar.
- `SidePanel` only mounts on open, and the EXIF position links to
  OpenStreetMap.
- **The viewer's key handler listens on the window, and the comments panel
  contains a text field.** Without a guard, typing "info" would scroll
  through photos and open the panel under someone's fingers: keys coming from
  an `input`, a `textarea`, or an editable element are therefore ignored —
  **except `Escape`**, which must remain the emergency exit even from the
  field. The guard lives in the viewer, the one place that listens, rather
  than as scattered `stopPropagation` calls across forms.
- Navigation arrows are hidden during zoom: dragging is then used to pan
  inside the image, and they would fall under the cursor.
- **Navigation arrows are children of the column, not of the media area.**
  Their `top-1/2` is therefore computed against the full screen height, the
  one dimension that does not move from one media item to the next. As
  children of the media area, they used to follow its height, which varies:
  the caption strip enters the flow on a video (`overlay={false}`) and takes
  up room accordingly, grows further when it carries a description or a
  day's note, and shrinks when `l` folds it away. The arrows used to move up
  by a few dozen pixels — measured: 428 px on a photo, 388 px on a
  captioned video, 404 px with the caption folded, on an 856 px screen — so
  the mouse had to be repointed from one media item to the next. The point
  to remember: **anything that must stay under the cursor from one media item
  to the next is positioned on the column**, whose height is the screen's;
  the media area itself is a `flex-1` that its flow neighbours let breathe.
- **The viewer is a row, not a column.** The photo occupies a
  `flex-1 min-w-0` column, the side panel the next one from `md` on.
  `min-w-0` is not decorative: without it, the image imposes its width and it
  is the panel that overflows the screen. The header lives **inside** the
  photo column, otherwise it would slide under the panel.
- **Both header lines truncate, and the rank comes before the date.** The
  date line, the only one without `truncate`, used to wrap onto three lines
  and the header grew to 92 px — it covered the top of the very photo it
  announces. `1 / 120` precedes the date because that is the useful landmark
  when browsing an album, so the date is the one that must be trimmed first.
- **Set as cover** only appears for an administrator, and never on a video:
  its preview belongs to Drive (D92) and can be missing, and the cover is the
  one image whose absence shows from the home page, with no fallback. It is
  the only action with no keyboard shortcut — it is done once per album, and
  the `?` cheat sheet addresses everyone. It lights up when the open photo is
  already the cover; reselecting it is not a wasted click: it may have been
  the cover by default, and this pins it down. Reverting to automatic is a
  button on `/admin`, the only place that distinguishes the two cases (D80).
  A rejection — expired session, role revoked in the meantime — displays at
  the bottom of the photo: without this message, nothing would distinguish a
  failure from no click at all. It clears on the next photo change.
- **Under `sm`, actions move into an `ActionMenu`** — Info, Zoom, Download,
  Full screen, and the cover option for an administrator — with their labels
  spelled out and no reminder of the keyboard shortcut, which means nothing
  on touch. From `sm` on they all align in the bar. As with `TopBar`, they
  are **described once** (label, shortcut, icon, active state) and rendered
  both ways: duplicated, an icon or a state would eventually drift out of
  sync between the bar and the menu.
- **`Comments` stays inline at every width.** Its icon carries the unread
  badge, the only sign that a photo has been commented on; tucked into the
  menu, it would no longer signal anything. Accepted consequence: on a large
  screen, it sits **before** `Info` instead of following it — the one action
  at a fixed position is the one that must stay recognisable.
- Measured afterwards: header at 60 px instead of 92, title block at 235 px
  instead of 73, and `1 / 120 · 7 August 2026 at 17:21` displayed **in
  full** on a 393 px screen.
- **The Info panel opens on the day**, before the EXIF: "Place" then "That
  day". `place` wins over `autoPlaces`, as everywhere else
  ([D51](./08-decisions/D51-the-place-is-corrected-per-day-never-per-photo.md)).

  These two lines are now a **repeat** of the strip, and they stay: they are
  the only ones to render the text **in full** without expanding, and
  removing them would lose access to the note from a panel already open.
  What changed is their status — they were D70's fallback under `md`, they
  are now a convenience.

  `useAlbumDays` is called as soon as the grid is by day **or** the viewer is
  open (`groupBy === 'day' || isOpen`): the note must be there no matter how
  the photo was reached, without paying for the request on a month-grouped
  grid that is merely being scrolled through.

- **`goTo` ignores an index already displayed.** `Home` on the first media
  item, `End` on the last, an arrow at one end: the target is the current
  index, no item is remounted, so no playback event fires. Resetting `failed`
  to `false` in that case would clear the message for an unreadable video
  with nothing to replace it.
- **A click in the photo area closes the open panel**, like any drawer. The
  handler is set in **capture** phase, not bubble: zoom is decided on pointer
  release inside `ZoomableImage`, further down the tree, and in bubble phase
  both gestures would fire together — the panel would close _and_ the photo
  would zoom. Intercepting on the way down leaves the first click to closing,
  the next one zooms normally.

  `button` elements in this area are **excluded**: acting on the media —
  downloading an unreadable video, bringing back the hidden chrome — is not
  an "outside", and the panel would close under a click that was never aimed
  at it. The navigation arrows, for their part, no longer depend on this
  exclusion since they left the media area for the column: the handler no
  longer sees them at all. The zoom's position marker (`role="img"`) is
  excluded the same way: since a capture handler runs before its target, its
  `stopPropagation` cannot protect it.

  **Touch swiping is swallowed the same way**, and this is a consequence
  worth knowing: `useSwipe` sets its `onPointerDown` in the bubble phase on
  this same node, and a `stopPropagation()` fired in capture interrupts the
  entire dispatch queue, including bubble handlers on the same element. On a
  tablet beyond `md`, panel open, the first swipe therefore closes the panel
  without changing photo; the next one navigates. This is consistent with
  "the first gesture closes, the next one acts", but it is not free.

  Under `md` the question does not arise — the panel takes over the whole
  screen, there is no "outside".

### Caption strip — `components/MediaCaption.tsx` and `lib/caption.ts`

The hand-written texts, gathered at the bottom of the photo column, at
**every** width. What explains an image used to be read elsewhere than the
image itself — the day's note in its section header, and nothing at all on
the photo — opening an image lost most of what explains it (D84).

| Line  | Prefix     | Style                 | Visible lines |
| ----- | ---------- | --------------------- | ------------- |
| Photo | —          | `text-sm` · `ink-100` | 3             |
| Day   | "That day" | `text-xs` · `ink-300` | 2             |

The hierarchy is carried by colour and clamping, with no title at all: the
wider the scope, the more the line fades. The photo's line is the only one
with no prefix — the one below talks about something other than the image
being looked at, and without that word "Bonifacio, the beach" would read as
its caption.

**The album description is not a third line**
([D89](./08-decisions/D89-the-album-description-leaves-the-caption-it-was-read-on.md)).
It used to be, and it cost one strip line on each of an album's nine hundred
photos for a text read once, on opening the grid — identical from one photo
to the next, hence invisible from being there so much. What the viewer owes
the album is to say **which one**, not to narrate it: its title is in the
header (D88), and the description stays where it is read, at the top of the
grid.

`captionEntries` (`lib/caption.ts`) decides which lines exist: pure logic,
hence testable without a DOM, and it is the only part with actual cases —
missing text, blank text, everything empty, order of the scopes
(`packages/web/test/caption.test.ts`).

What is worth knowing about the component:

- **The gradient is the header's, flipped**
  (`from-black/85 via-black/55 to-transparent`), and the side margins account
  for `env(safe-area-inset-*)`: in landscape, the notch bites into that edge
  too. They sit on the content and not the wrapper, so the gradient reaches
  the edge of the screen.
- **A click on the text expands it** (`line-clamp-none`, `max-h-[50vh]` and
  clean scrolling), with `aria-expanded`. Expansion **is not** persisted: it
  responds to a specific text, not the next one — the viewer remounts the
  component on every photo (`key`), which resets it flat.
- **The chevron hides the whole strip**, and that preference **is**
  remembered (`localStorage`, `useCaptionHidden`): it is a choice about how
  to look at one's photos, one that should not be made again on every open.
  Hidden, a ghost "Show caption (l)" button stays at the bottom right — a
  hidden state with no way out is a trap. The `L` key does the same thing
  from the keyboard.
- **The pencil and "+ Describe this photo" are reserved for the
  administrator**, with the same affordances as `AlbumDescription`: overlay
  editor, `z-20`, character counter, Cancel / Save. Two ways of editing text
  in the same application would stand out immediately.
- **The strip is hidden during zoom**, like the navigation arrows: the finger
  is used there to pan inside the image.
- **On a video, it pushes instead of overlaying** (`overlay={false}`, so
  inside the flow). This is the only place it does this: native playback
  controls live at the bottom of the tag, and on a portrait video filling the
  screen, a strip laid over it would make play/pause and the progress bar
  untouchable.
- **Opening the editor is driven by `Lightbox`**, not by the component: it is
  the viewer that listens for `Escape`, and that key must close the field
  **before** zoom, the panel, and closing the viewer itself. Without this
  layer, `Escape` from the input would close the viewer over an unsaved text.
- The cover-failure alert has moved from `bottom-6` to `bottom-28`: placed
  lower, it used to sit under the strip it is meant to interrupt.

`useUpdateMedia` (`api/hooks.ts`) **patches the cache instead of invalidating
it**: `setQueriesData` on the `['items', albumId]` prefix replaces the item
in the pages of **both** sort directions, and `setQueryData` updates the
detail. Invalidating would relaunch every accumulated page of the infinite
query — after five pages of scrolling, writing a caption would re-request a
thousand rows (the lesson of D67).

### Comment badge — `lib/seenComments.ts`

The header's "Comments" button carries two distinct visual states, because
they answer two different questions: a **plain dot** says a conversation
exists here, a **coloured number** says it has moved since the last visit.
Conflating them would amount to demanding attention for a photo whose every
message has already been read. The number caps at "9+": beyond that it would
overflow the icon, and knowing whether there are twelve or seventeen changes
no gesture.

The badge is `aria-hidden`; what it says is carried by the button's
`aria-label`, otherwise a screen reader would announce a bare number.

**The total comes from the server, the read marker from the browser.** The
first is `GET /api/comments/:albumId`, loaded once per album. The second is a
count of comments seen per photo, in `localStorage` under
`lukarn:comments-seen:<albumId>` — a count, not a date: comparing two integers
is enough to answer "is there anything new?", where a date would force the
server to carry the timestamp of every thread. The choice of the browser over
the database is explained in
[D55](./08-decisions/D55-the-read-marker-lives-in-the-browser-not-the-database.md).

Three edge cases the calculation must handle:

- `unreadCount` has a **floor of zero**. A deletion or a hide drops the total
  below the marker, and a "-2" would display as-is.
- The marker **moves back down** when the total drops below it, otherwise the
  next message would stay invisible until it closed the gap.
- Nothing is marked as read until the counts have loaded: marking at that
  moment would clear the marker only to rebuild it wrong once the real
  totals arrive.

**The activity feed has its own marker**, `lukarn:comments-feed-seen`, and it
is a comment **identifier**, not a count. The feed is paginated and has no
total: counting what has been read would require walking through the whole
thing, whereas `AUTOINCREMENT` makes the id an exact milestone — anything past
it arrived since, regardless of messages deleted in the meantime. The three
edge cases above apply identically: `unreadFeedCount` only counts what is past
the marker, the marker moves back down if the head of the feed drops below
it, and nothing is marked before the first page arrives.

A single marker for every scope, the global one: opening the drawer filtered
to "Holidays" must not turn off a badge that was also announcing messages on
"Corsica". An open drawer counts as read, like an open photo panel.

### Asymmetric preloading

`PRELOAD_AHEAD = 4`, `PRELOAD_BEHIND = 1`, oriented by the direction of the
last move: someone moving forward almost always keeps moving forward, so for
an equal number of requests, pushing further ahead makes browsing noticeably
smoother. Requests go out **from nearest to farthest**, so the immediately
next photo is not queued behind useless neighbours. The effect's cleanup sets
`image.src = ''`: a fast navigation abandons downloads that have become
useless and frees up connections.

The total stays modest because every render missing from the server cache
costs a download of the original from Drive.

### Zoom — `components/ZoomableImage.tsx`

Zoom is meant to **examine** a photo, not to enlarge what is already
displayed: a `scale()` on the `full` render (2560 px) would only stretch
pixels already rasterised. On the first zoom-in, the component loads the
`hd` variant (4096 px) off-screen and switches only once the image is
ready — then keeps it, because switching back to `full` when returning to the
frame would make the image flicker on every round trip.

**The page's native pinch also counts as a zoom-in.** On a phone, nobody uses
the application's own zoom: people pinch the screen with two fingers, and
that is the right gesture — intercepting it with a homemade handler would
conflict with navigation swiping, to redo worse what the system already does.
But the browser then re-rasterises from the `full` render (2560 px), which
turns soft beyond roughly 2×. An effect therefore watches
`window.visualViewport` and triggers loading of `hd` as soon as
`viewport.scale > 1`: the scale is read once on open (the page may already be
pinched), then on `resize` **and** `scroll`, since engines do not signal a
pinch the same way. Nothing downloads until a pinch happens — `hd` is heavy,
and on mobile data the cost is real.

**Click and drag are told apart on release**, in the container's
`onPointerUp`, not via an `onClick` on the image. The reason is mechanical:
as soon as the image is enlarged, the container captures the pointer to track
the movement, and the browser then addresses the `click` to the capturing
element and not the image — the handler was never reached, so `Escape` was
needed to return to the fit-to-frame view. `isTap` (`lib/zoom.ts`) decides
based on **distance** travelled, `TAP_SLOP_PX = 5`: zero would not work, a
fine pointer always moves a pixel or two. Duration plays no part — a slow,
short drag is still a drag, a finger held still for a long time is still a
tap.

By touch, this distinction requires the gesture to reach its `pointerup`:
that is guaranteed by the photo column's `touch-action`, described above
alongside swiping. Without it, panning inside an enlarged photo dies midway.

Two scales not to be confused: **scale 1** is the image fitted to the frame;
**100% scale** (`pixelScale`) is the one where one pixel **of the available
render** occupies one screen pixel. That is the target of `Z` and of a click,
the first useful notch and often the only one wanted. Capped at
`MAX_SCALE = 8`: beyond that, only sensor grain is being observed.

#### "100%" is the served resolution, not the file's

The server caps the `hd` render's longest side at 4096 px (`HD_MAX_EDGE`,
`media/renderer.ts`). A 6000 px photo is therefore never served at 6000 px,
and setting 100% against the index dimensions — what `nativeScale` used to
do — claimed native pixels while actually interpolating one in three.
**100% now means "one pixel of the render per screen pixel"**, that is, the
limit beyond which the browser starts inventing detail.

The calculation lives in `lib/zoom.ts` (`computeZoomScale`, `zoomPercent`),
as pure functions tested by `test/zoom.test.ts`: a scale off by 40% looks
like a slightly soft image, not a bug, and is not visible to the eye.

- **Measurement is authoritative**: the `<img>`'s `naturalWidth` gives the
  width of the render actually loaded, read at the `onLoad` of the visible
  render and of the off-screen `hd` preload.
- Before that load, `hd` resolution is **anticipated** through an
  `HD_MAX_EDGE` constant mirroring the server, applied to the longest side (a
  4000 × 6000 portrait gives 2731 px wide, not 4000). Without this
  anticipation, `Z` could only target the resolution of the already-loaded
  `full` render. A divergence from the server self-corrects as soon as `hd`
  is measured.
- The **percentage is computed from `availableWidth`**, not from
  `pixelScale`, which is capped by `MAX_SCALE`: on a photo that would require
  more than that cap, basing it on `pixelScale` would show 100% where the
  maximum zoom still only shows part of the pixels.
- When the available render is smaller than the file, the indicator says so
  (`100% · 4096 px render out of 6000 px`): that is the information the old
  display used to hide.
- If the index does not know the dimensions, they are taken from the render
  received at its `onLoad`: zoom starts from the measured resolution, more
  limited but present, and rises once `hd` has loaded.

Three details that have a reason:

- **`clampOffset`** bounds the pan so the frame never overflows the image.
- **The zoom is centred on the targeted point** (wheel or click): the pixel
  under the cursor must not drift away during the zoom-in.
- **`scaleRef`** lets the effect that listens for `zoomed` read the current
  scale without depending on it — otherwise every wheel notch would relaunch
  the effect, which would immediately snap the image back to its native
  level.

Two visual markers: a **waiting preview** (the 320 thumbnail, already in the
browser cache since it was just displayed in the grid) blurred to the exact
size of the final render, while it is on its way; and a **position marker**
during zoom, with the frame of the visible area — without it, all sense of
orientation is lost while panning inside an enlarged image. The indicator
additionally shows "loading HD…" while the `hd` variant is not ready: the
percentage then rests on the anticipated resolution, not on a measurement.

### A blurred preview never appears without an indicator

`lib/preview.ts` decides, as one, what displays during the wait: preview,
activity indicator, failure message. The combination is isolated into a pure
function because an error there is silent — it breaks nothing, it produces a
misleading screen that no typing and no integration test flags.

This has already happened: the blurred preview was introduced while the
indicator remained conditioned on videos only. Opening a photo then gave a
fully blurred image, with nothing saying a render was in progress — and the
defect disappeared as soon as the render was cached, which made it look
random. On 9 MB files, the wait lasts several seconds: the time for the
server to download the original from Drive and re-encode it.

The invariants are checked across every combination
(`packages/web/test/preview.test.ts`): a preview is never shown without an
indicator, a failure excludes both, and the indicator appears even with no
preview to show — unknown dimensions, a silent black screen would be worse.

**Video does not go through it.** It only has two states — playing, or
unreadable — and its wait belongs to the browser: the `poster` occupies it,
the native controls announce it. It went through `previewOverlay` with
`measured: false` for a while, which laid a second spinner over the
controls' own
([D98](./08-decisions/D98-decoding-that-fails-without-an-error-and-one-spinner-too.md)).
What it keeps from that is the very invariant: a wait must end on an image or
on a message
([D79](./08-decisions/D79-an-unplayable-video-says-so-and-can-be-downloaded-instead.md)).

The marker is **actionable**: clicking or dragging on it brings the targeted
point to the centre of the window. It used to show where one stood without
allowing any action on it, which invites the gesture then refuses it. The
conversions live in `lib/zoom.ts` — `viewCenter` to display it,
`offsetForCenter` to drive it — and their reciprocity is tested: what the
marker shows and what it commands must designate the same thing, or the
frame would jump under the cursor. The `pointerdown` stops its propagation,
otherwise the container would additionally start its own pan and the image
would move in the direction of the drag while the marker pulls it elsewhere.

## Administration — `pages/AdminPage.tsx` and `components/admin/`

Accounts, albums and settings are administered from `/admin`:
`config/albums.yaml` now only serves to bootstrap a fresh installation. The
"Reload albums.yaml" button has therefore disappeared along with the
`POST /api/admin/reload` route.

Administration is navigated by **sections, one per URL** (D66):

| Section  | URL               | Content                                                 |
| -------- | ----------------- | ------------------------------------------------------- |
| Albums   | `/admin/albums`   | `AlbumsSection`                                         |
| Accounts | `/admin/accounts` | `UsersSection`                                          |
| Comments | `/admin/comments` | `CommentsSection`                                       |
| Server   | `/admin/server`   | `DriveSection`, `SettingsSection`, `MaintenanceSection` |
| Visits   | `/admin/visits`   | `VisitsSection`                                         |

`ADMIN_TABS`, in `AdminNav`, is the single source: navigation renders it, and
`AdminPage` validates the `:tab` parameter against it. An unknown section
redirects to Albums rather than showing a blank page, and `/admin` with no
section remains a valid link — which is still what the top bar points to.

**The section lives in the URL, not in local state.** A link to the
moderation queue can be shared, the browser's back button returns to the
previous section, a reload does not go back to the first one, and Google's
consent return flow needs a destination to name: the server redirects to
`/admin/server`, the section that carries the connect button (see
[05](./05-api.md)).

`AdminPage` mounts the requested section **and only the loading/error states
that concern it**: the moderation queue shows neither the albums loading nor
an error on the server state, which would change nothing about what it
displays. Its album selector does read the same list, but does not wait on
it — it fills in once the list arrives. The requests themselves stay launched
at the top of the component — the rules of hooks do not allow conditioning
them, and TanStack Query shares them across sections anyway.

The message banner stays in the content column, stuck under the top bar: the
comments section always scrolls, and a message shown at the very top would go
unnoticed from the bottom of the queue.

| Component                     | Role                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `AdminNav`                    | Navigation between the five sections, as `NavLink`                                      |
| `DriveSection`                | OAuth connection status, consent, disconnect                                            |
| `UsersSection` / `UserForm`   | Account list, creation, editing, confirmed deletion                                     |
| `AlbumsSection` / `AlbumForm` | Album list, sync status, default grouping, revert to automatic cover, creation, editing |
| `SettingsSection`             | Sync interval, sync on startup, cache                                                   |
| `MaintenanceSection`          | Cache usage and purge                                                                   |
| `VisitsSection`               | Who came, and which albums were opened, over 7, 30, or 90 days                          |
| `AlbumAccessPicker`           | Assigning albums to an account (see below)                                              |
| `ConfirmDialog`               | Named confirmation, replacing `window.confirm`                                          |
| `ui.tsx`                      | Shared primitives: button, field, checkbox, section box, row geometry                   |

Each section carries its own mutations, and `ui.tsx` exists so forms do not
reinvent either the classes or the `label` / `aria-describedby` link.

### A row stacks rather than truncating what names it

The page is bounded to **`max-w-[90rem]`**, not the original 64 rem: that
left 760 px of content on a 1495 px screen, the rest taken up by the
navigation column and two empty margins each a third of the window wide.

Every administration row — album, account, Drive status, cache usage,
comment to moderate — is made of the same two blocks: what describes, and
what acts. `ROW_CLASS` and `ROW_ACTIONS_CLASS` (`ui.tsx`) hold their single
geometry: **stacked under `xl`, in a row beyond it**
([D95](./08-decisions/D95-administration-stacks-instead-of-truncating-what-names-it.md)).
Side by side, only the descriptive block can shrink — the buttons carry
`whitespace-nowrap` — and it used to collapse to two characters followed by
an ellipsis.

The threshold is `xl` and not `sm` because room runs short well beyond phone
size: `AdminNav` takes its 12 rem column from `md` on, which makes the
768–1280 px band the one where a row of four buttons crops the title the
most. Vertical alignment, for its part, stays with each call site — a list
row centres its two blocks, a multi-line comment keeps its button at the top
— because two competing alignment classes on the same chain would be settled
by the order of the stylesheet rather than that of the code.

Two corollaries, in the moderation queue: the album selector carries
`min-w-0` (a `select` otherwise claims the width of its longest option, and
it overflowed its section's frame), and the search field carries `basis-64`
to drop to its own line when room runs short instead of shrinking to the
thirty pixels `flex-1` used to leave it.

**An album row's "Automatic cover" button is its own indicator**: it only
appears once a photo has been chosen. The metadata line above it could have
said so, but it carries `truncate` and a row of five buttons shrinks it to a
few characters as soon as the window narrows — an indicator that cannot be
seen is not one. The `title` lifts the ambiguity of the label, which
describes the targeted state, not the current one.

`AdminNav` has **two regimes depending on width**, like `SidePanel`: from
`md` on, a sticky 12 rem column that stays in view while scrolling through
the moderation queue; below that, a row that scrolls horizontally,
overflowing the page's margins — the same 12 rem taken from a phone screen
would leave nothing for the content. The active state comes from the router:
`NavLink` sets `aria-current="page"` and passes `isActive` to its class,
rather than comparing paths by hand.

**Day notes are not administered here.** They are entered in the album,
next to the photos they describe — the only place where what to write is
known (D50). `AlbumForm` only carries the grouping preference, as a
checkbox: `GroupBy` only has two values and the absence of grouping by year
is a documented choice, a selector would only add one more component.

### Album assignment is a choice between two regimes

`AlbumAccessPicker` offers two exclusive options: **all albums** — the
`ALL_ALBUMS` wildcard, which will follow albums created later — or **a
selection** of identifiers. Checking all twelve existing albums is never a
way of expressing "all albums", and the difference only shows on the
thirteenth: that is why the wildcard is not rendered as a "check all" box,
and why a selection that becomes exhaustive shows a warning. The explicit
selection is remembered across a round trip to the wildcard, otherwise going
back would force rechecking everything. A deleted album that survives in an
account's list stays displayed, otherwise it would be impossible to remove
it.

`formatAlbumAccess` (`lib/adminForm.ts`) summarises the assignment in the
account list by naming the wildcard as such, never by enumerating the albums
it covers today.

### What the form corrects before calling the server

`lib/adminForm.ts` contains only pure functions, tested in
`test/admin-form.test.ts` — the test suite runs without a DOM. They do not
replace server-side validation, which remains sole judge; they avoid a round
trip to say what is wrong, by applying the same shared constants
(`USERNAME_PATTERN`, `ALBUM_ID_PATTERN`, `PASSWORD_MIN_LENGTH`,
`USERNAME_MAX_LENGTH`).

- **`extractFolderId`** accepts a Drive folder's full URL, a share link, an
  old `open?id=` link, or the bare identifier. The value is normalised as it
  leaves the field, so what stays displayed is exactly what will be sent. A
  readable path ("My Drive/Photos") is rejected: Drive only exposes the
  opaque identifier, and the server would respond with a far less helpful
  error.
- **`slugifyAlbumId`** suggests an identifier from the title as long as the
  field has not been touched — this identifier ends up in the album's URL.
- Editing forms send **only the changed fields**: a missing field leaves the
  value in place, so resending the whole form would overwrite a change made
  elsewhere in the meantime. An empty password means "do not change".

### Deletions

`ConfirmDialog` replaces `window.confirm`: the text names the object
concerned and describes the consequence, including what is **not**
touched — deleting an album removes its media from the index but deletes
nothing in Google Drive. The dangerous button does not take focus on open, a
reflex `Enter` press would be enough to delete; it is the panel that
receives it, and focus returns to the triggering element on close.

Two safeguards prevent locking oneself out: an account cannot delete itself,
and cannot remove its own administrator role. The server remains free to
reject them too — these rules only exist here to avoid offering a gesture
that backfires on the user.

### Visits — `components/admin/VisitsSection.tsx`

Two tables, and nothing else: "Who" lists the access keys seen over the
period, "Which albums" what was opened. A 7 / 30 / 90-day selector
(`VISIT_WINDOWS`) carries the window, which enters the query key — going
back to "7 days" after "90" redisplays its page with no network call, and
`placeholderData` keeps the table in place while loading, otherwise the
section would collapse under the cursor.

Rows reuse `UsersSection`'s geometry — `ROW_CLASS`, stacked under `xl` —
because the section is consulted from a phone, and a row of six numbers
would truncate the identifier it describes there.

Two badges sit next to the key: "administrator", and the device class seen
on its open sessions. `tv` displays as "television" — the stored value is
the technical word, the displayed one is the one people actually use.

**Dates are in UTC**, via `formatDateTime`, whereas a comment's are local.
The reason is that counters are bucketed by UTC day: showing local time next
to a UTC-day count would give two scales in the same table, and a visit at
00:30 on 1 August would read on 31 July's row. The relative form
(`formatRelative`) is what displays, the exact date stays on hover.

### Side panel — `components/SidePanel.tsx`

A single `aside` on the right, two tabs: "Info" (`ExifPanel`) and "Comments"
(`CommentsPanel`). Two separate panels would have fought over the same spot,
each with its own header and close button, and switching between them would
have shifted the image twice. `ExifPanel` therefore only renders its rows;
the frame belongs to `SidePanel`.

State is a `PanelTab | null` — `null` meaning "closed". `i` and `c` open the
matching tab and close it if already displayed.

**The header carries the filename**, the only place it displays: it applies
to both tabs, and repeating it in `ExifPanel`'s rows would make it a
duplicate two centimetres from itself. The close button cancels, within the
flow (`-my-1 -mr-1`), the padding that enlarges its click target, without
removing it from the target: the cross then lands back on the filename's line
and on the content column's right margin. Otherwise it sat 4 px lower and
4 px further right than everything else — a misalignment that is hard to
name just by looking.

**The panel is `ink-850`, one step above the background.** The viewer is
`ink-950`; at `ink-900`, the open panel could not be told apart from it —
only its border gave it away, and it became unclear where one stood. Three
consequences follow inside it, without which the change would have erased
part of it: `ExifPanel` and `CommentsPanel` separators move to `ink-800`, now
**lighter** than their background; and `CommentsPanel`'s and `IdentityForm`'s
input fields move to `ink-900`, darker than the panel, to keep reading as
recesses. A field the exact colour of its panel is no longer a field.

**Two position regimes depending on width.** From `md` on, the panel is a
flow element (`md:relative md:w-80 lg:w-96 md:shrink-0`): the photo area
shrinks accordingly, and that is what allows leaving it open from one photo
to the next. As an overlay, it used to cover the "Next" arrow, forcing it
open and closed constantly. Below `md` it goes back to overlay — 320 px
taken from a phone screen would leave nothing to see — and regains its
`backdrop-blur`, useless once it is opaque.

Zoom has nothing to know about this shrinking: `ZoomableImage` measures its
container via `ResizeObserver`, so the fit scale and the framing bounds
recompute on their own. This is what made it possible to fix the overlap
without touching the zoom calculation.

The badge's counter comes from `MediaDetail.commentCount`, already loaded
with the detail: showing "3" even before opening the tab is what makes
someone want to read it, and the thread itself is only requested on open —
most photos are looked at without their comments being read.

### Info — `components/ExifPanel.tsx` and `lib/exifRows.ts`

A list of label/value pairs, ordered from most human to most technical:
"Place" and "That day", then the date, dimensions, size, duration, the
device and shooting settings, finally position. A row with no value does not
exist — a panel full of dashes on a screenshot with no EXIF would teach
nothing.

**Except position, whose absence is stated**: "No GPS data", in `ink-400`
like everything that states a fact rather than informs. It is the only row
that, when not seeing it, raises the question of whether the photo has
nothing to give or the application has not finished its work
([D94](./08-decisions/D94-a-photo-without-a-position-says-so-instead-of-letting-the.md)).
It comes from the photo's EXIF and owes nothing to reverse geocoding: it
displays whether "Place" has a name or not, and links to OpenStreetMap.
Reserved for photos — Drive only returns a position in
`imageMediaMetadata`, never for a video, so the row would read "none" on
every single file there.

The choice of rows lives in `lib/exifRows.ts` and not in the component, like
`captionEntries`: it is the only part of the panel with actual cases —
present, absent, absent and stated — and it is verified without a DOM
(`test/exif-rows.test.ts`).

### Comments — `components/CommentsPanel.tsx`

Deliberately sparse in features: one thread, one reply per thread, deleting
one's own messages, and correcting a typo within thirty seconds. No
**free-form** editing, no reactions, no mentions — that is what separates a
conversation under a photo from a forum.

- **Identity is declared at the moment of writing**, at the bottom of the
  panel (`IdentityForm`) — not at sign-in. This is the only moment where
  providing an address has a visible meaning for the person being asked. With
  no identity, a "Identify yourself to comment" button replaces the field;
  with no SMTP server, a sentence explains comments are unavailable rather
  than opening a form that would fail at the last step.
- **The form's text lists every use of the address**, including automatic
  subscription to updates on opened albums (D41). This is the only place
  where someone decides to give it: a default subscription is defensible in a
  private circle provided it is announced there, not discovered on receiving
  the first email. Any change to what the application does with the address
  therefore ripples through **this paragraph**, or it becomes a commitment
  that is not honoured.
- **No "Reply" button without a verified identity**: the server would refuse,
  and offering the gesture would lead straight to an error message.
- **The thread-opening form is anchored at the bottom**, outside the
  scrolling area. On a heavily commented photo, the whole conversation would
  otherwise have to be scrolled through to find where to write.
- **Enter posts, Shift+Enter breaks the line.** Messaging-app convention; a
  photo comment almost always fits in one sentence, and requiring a button
  click every time wears thin.
- **No "Reply" button under a reply.** The server would attach the message
  to the thread's root (D35): offering a gesture whose result is not what is
  shown would be misleading.
- **Posting invalidates the thread _and_ the media detail.** The latter
  carries the tab's counter, which would otherwise lag by one until the photo
  is reopened.
- The body renders as `whitespace-pre-wrap`: entered line breaks are
  preserved, and React escapes the text — no HTML is ever interpreted.
- **Posting also invalidates the album's counters**
  (`queryKeys.commentCounts`), which carry the viewer's badge. Without this,
  it would announce the previous state on the photo currently on screen. A
  **correction**, by contrast, only invalidates the thread: it changes
  neither the message count nor what remains to be read.

#### Correcting within thirty seconds

A "Edit (N s)" button under one's own messages, for the duration of
`COMMENT_EDIT_WINDOW_MS`. The countdown is displayed: a button that vanishes
without warning reads as a bug, whereas here vanishing is the rule. It costs
one render per second, on one comment at a time.

`Comment.canEdit` is not enough to decide on its own — it is a value that
**expires on its own**, and a thread left open would still carry it as `true`
an hour later. `useEditWindow` therefore cross-checks it against `createdAt`
via `remainingEditMs`, the same function the server uses to refuse: two
separate calculations would eventually drift apart by a second, and that is
exactly the gap where someone clicks a button that answers no.

Two behavioural choices that are not obvious:

- The correction field is prefilled with the **entered text**, not the
  rendered text: correcting a message must not replace ":)" with the emoji
  in what is stored.
- The form **stays open** if the window closes while typing. The server is
  the one that decides and its refusal is displayed; force-closing it would
  make the text being typed disappear without warning.

#### Emoji — `lib/emoji.ts`

Two paths, one storage. On mobile, people type real emoji characters on the
system keyboard: they pass through the API and SQLite untouched, there is
nothing to do for them. On a physical keyboard, people write ":)" — that is
the shortcut `emojify` translates, with the palette picker filling in the
rest.

**Translation happens at display time, never at write time.** The stored
body remains exactly what was entered: a substitution made at `POST` time
would be irreversible, and the list of shortcuts could never evolve without
rewriting comments already published. The output is plain text, never a
tag — React's escaping remains the sole safeguard, instead of a second one
that would need checking.

A shortcut is only recognised when **isolated**: preceded by the start of
the text or a blank, followed by the end or a character that is neither a
letter nor a digit. Both boundaries are essential, for different reasons —
without the left one, `https://example.com` would become
`https😕/example.com`, without the right one ":pizza" would become "😛izza".
The left boundary is a capturing group and not a `lookbehind`: Safari only
implemented that in 16.4.

The palette has thirty-two entries and **no search**: it is not a
replacement keyboard but a shortcut for what gets written under a family
photo. An exhaustive palette would require an index, hence a dependency, for
a panel where a single sentence is typed. Restoring the cursor after
insertion is deferred by one frame (`requestAnimationFrame`): React rewrites
the `textarea`'s value on the next render, which would otherwise put the
cursor back at the end of the text.

The button sits **to the left of "Post"**, and the form carries no caption:
under a photo, room is claimed by the conversation. What was left to say —
that ":)" becomes an emoji — fits in the tooltip of the button that mentions
it, now the only place the substitution is learned. The palette opens
upward and **anchored to the right**: the form sits at the bottom of the
panel, and 16 rem aligned to the left would overflow it.

### Activity feed — `components/CommentsFeed.tsx`

**A conversation is not discovered by chance.** A photo's badge assumes the
right one has already been opened, and on an album with thousands of views
where ten carry a message, nobody stumbles onto them. A message written with
no reader is a lost message: the drawer is the only place from which it can
be seen that it was written (D86).

A **drawer**, not a page: the grid stays behind, closing it leaves things
right where they were. Full width under `sm`, a 384 px column beyond it —
384 px taken from a 393 px screen would leave nothing of the gallery
visible, and the drawer would then amount to a page.

`useActivityFeed()` is what both gallery pages wire onto their top bar: the
badge and the opening. It mounts the **global**-scope request, even from
within an album — the badge answers "is there anything new anywhere", and
restricting it to the open album would turn it off on a page change with
nothing having been read. The drawer therefore also opens at the global
scope: opening on a narrower list than what the badge announces would send
people looking for absent messages. Inside an album, an "All albums /
`<title>`" toggle narrows it afterwards, and the album reminder then
disappears from each block — it would repeat what the toggle already shows.

Ordering is the same as moderation's, `lib/commentGroups.ts`, with one
exception: **messages within a block read oldest to newest**, while the list
of blocks stays reverse-chronological. Here a conversation is being read, and
the answer above the question reads backwards. A block's place within its
day, however, is always decided by its most recent message.

Each block links to `/album/:id?photo=<mediaId>&panel=comments` — the photo
**and** the conversation. A 56 px thumbnail opens the block: it is what makes
the thread recognisable, well before the filename. A photo removed from the
index no longer has one and the block stops being clickable, the link
leading to a viewer that would close right away. The body is clamped to
three lines: the drawer is an overview of what was said, the full
conversation opens under the photo, with the means to reply there.

A **button** "Older messages" rather than infinite scroll: this is for
seeing what just arrived, not for scrolling back through an archive, and a
scroll observer would load pages under a thumb that is merely browsing.

### Moderation — `components/admin/CommentsSection.tsx` and `lib/commentGroups.ts`

**A work list, not a feed** (D67). Arriving here comes with an intent — a
flagged message, a day, an address —, and the queue answers those three
entry points: a filter bar (`All` / `Visible` / `Hidden` tabs, album
selector, search field) and page-by-page pagination.

The bar sits in the section's body and not in its header's `action`: three
tabs, a selector, and a text field do not fit next to a title. The album
selector is a plain `<select>` — the only one in the application, extracting
a primitive for a single use would be speculative. The queue does not wait
for it: it displays while the album list loads. Search is debounced by
300 ms, otherwise every keystroke would go to the server.

**One page at a time**, 25 rows, not an accumulation: every hide
invalidates the queue, and an infinite query would then reload every page
already loaded. A stack of cursors holds the path taken — the only way to go
back with cursor-based pagination — and empties as soon as a filter changes.
`keepPreviousData` keeps the displayed page in place while the next one
loads, otherwise the section would collapse under the cursor on every click.
The footer announces `x–y of total`, where `total` comes from the server.

`lib/commentGroups.ts` orders the page **by day, then by photo**. Two
repetitions disappear: the date, useless on every row when twenty messages
follow one another on the same day, and the photo/album pair, rewritten
identically under every message of the same thread. The day is the reader's
and **not UTC**, unlike the grid — the reason is further below, in the
"Dates" section. Ordering only applies to the received page: a photo whose
comments straddle a page boundary appears on both sides.

`groupByDayAndPhoto` is **generic** over the album/photo context: the
moderation queue and the activity drawer ask the same question — what was
written, and where — and do not answer it twice. What distinguishes
`AdminComment` from `FeedComment` — the author's address, the hidden state —
plays no part in the ordering, which only reads the album, the photo, and
the date.

Each block links to the commented photo (`/album/:id?photo=<mediaId>`):
moderating without seeing the image that prompted the message amounts to
judging a remark out of context. A media item gone from the index leaves the
comment moderable, with no link.

The author's address carries the **grouped action**: clicking it offers to
hide all their messages at once, behind a `ConfirmDialog` that states what
is at stake — every album, not just the displayed page.

## Dates: all in UTC

`lib/format.ts` builds every one of its `Intl.DateTimeFormat` instances with
`timeZone: 'UTC'`, and `monthLabel` does the same.

The reason: `taken_at` is the time the device displayed at the moment of
capture, read from an EXIF field with no time zone and interpreted as UTC by
`parseExifTime`. Redisplaying that value in the browser's time zone would
shift the photo — a photo taken at 2pm would display as 4pm for a browser in
Europe/Paris, and month or day grouping would flip for shots taken at the
end of a month or late in the evening. **Every newly displayed date must go
through `lib/format.ts`.**

**Three exceptions**, and all of them concern real instants, not device
clock times.

- The "today" that `dayLabel` compares a day key against is taken from the
  browser's **local** calendar. See
  [D31](./08-decisions/D31-grid-grouping-lives-in-the-url-but-today-is-read-from-the.md)
  — this is not a value coming from the server, it is the wall clock of
  whoever is looking, the same one as the device that timestamped the photo.
- `formatLocalDateTime` renders a **comment**'s date in the reader's time
  zone. The file's reasoning applies to `taken_at`, a wall-clock time with no
  time zone that a conversion would make wrong; `created_at` is the
  opposite — a real instant, the moment someone pressed "Post". Displaying it
  in UTC would show 19:14 to someone who just wrote at 21:14 from Paris.
  Threads display `formatRelative` ("5 min ago") and keep the full date in a
  tooltip.
- **Moderation queue days** are computed on the local calendar, via
  `localDayKey` (`lib/justify.ts`), for the same reason as above: these are
  `created_at` values. Grouping in UTC would file a message written at 00:30
  in Paris under the previous day.

## Dark theme — `styles.css`

Tailwind 4 with no configuration file: tokens are declared in an `@theme`
block and become utilities (`--color-ink-850` → `bg-ink-850`).

The `ink-950 → ink-100` scale is neutral, slightly cool, and **deliberately
low-contrast between background levels**: what needs to stand out is the
photos, not the chrome. Only two accents, `--color-accent` and
`--color-accent-dim`.

There is **no** light theme and no toggle: `index.html` hardcodes
`class="dark"` and `<meta name="color-scheme" content="dark">`. Adding a
light theme means doubling the `ink-*` scale, not flipping a variable.

The rest of `styles.css`: full height on `html/body/#root`, discreet
scrollbars, a `:focus-visible` focus ring only (the app is driven by arrow
keys, the active target must stay identifiable), and two animations —
`fade-in` for decoded thumbnails, `lightbox-enter` — both neutralised under
`prefers-reduced-motion: reduce`.

**`scrollbar-gutter: stable` on `html`**, and this is a fix, not a flourish:
the viewer freezes `document.body.style.overflow` on open, so the scrollbar
disappears and the entire layout shifts by its width — header included — on
every photo opened, then reverts on close. The same shift happens between a
page that scrolls and one that does not. Reserving the gutter fixes the
usable width once and for all.

The price is a 10 px empty band — the width set by the
`::-webkit-scrollbar` rule — where the system draws its own scrollbars as an
overlay and took nothing. This is the accepted trade-off: a shift on every
photo opened is noticeable, a constant ten pixels is not.

**`cursor: pointer` is restored at the base level on clickable elements.**
Tailwind 4 removed the rule its v3 used to set on `button`, to align with the
browser default. Here the result was that, on hover, nothing announced an
element was clickable anymore — this interface is made of borderless buttons
sitting on photos, where the cursor was the only clue. The rule lives in
`@layer base` rather than as a class on every button, which would get
forgotten on the first new component; disabled elements are excluded from
it, their cursor needing to say nothing will happen.

## Build

`vite.config.ts`: sourcemaps enabled, and a separate `vendor` chunk
(`react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`) that
rarely changes and stays in the browser cache across deployments.

In development, Vite serves the front end on `:5173` and proxies `/api` to
`:8080` **without** `changeOrigin`: session cookies and the OAuth callback
stay on a single origin.

`packages/web/public/` is copied as-is to the root of `dist/`: the manifest,
the icons, and the service worker arrive there without going through Rollup,
hence **with no hash in their name** — this is essential, a service worker
URL that changes on every build would never be recognised as the same one.
The `Dockerfile` copies `packages/web/dist` in full, it needs to know
nothing about any of this.

### The stylesheet is downgraded on output — `tools/legacy-css.ts`

The target is **Chromium 79**, taken from a television's browser, while
Tailwind v4 only claims Chromium 111 and above. A Vite plugin therefore
reworks the produced CSS right before it is written, in four passes:
Lightning CSS targeted at Chromium 79 — which converts `oklch()` to
`rgb()` —, doubling logical shorthands (`padding-inline`, `inset-inline`,
`margin-block`…) with their physical equivalents, a composed `transform` in
place of the `translate`, `rotate`, and `scale` properties, and **unfolding
cascade layers**.

Without it, `px-*` and `py-*` set **no** padding at all on these engines,
`inset-x-*` anchors nothing, and `-translate-y-1/2` recentres nothing. The
logical shorthand stays placed **last**: an engine that knows it applies it,
and writing direction continues to be respected. The transforms, on the
other hand, are **replaced** rather than doubled — a modern engine would
apply both and move the element twice. The JS target drops to `chrome79`
for the same reason, otherwise `?.` and `??` leave a blank page rather than
a badly laid-out one.

**Unfolding the layers decides everything else**: 91% of the produced
sheet lives inside an `@layer`, an at-rule that does not exist before
Chromium 99 and that a conformant engine discards **along with its block**.
A second television, despite being newer than the first, does exactly that
and therefore displayed no styling at all — with nothing else at fault.
Unfolding changes nothing for a modern engine, since Tailwind declares its
layers in the order it emits them
([D260809i](./08-decisions/D260809i-cascade-layers-are-flattened-at-build-time.md)).
The source itself keeps writing its `@layer` rules: only the output is
unfolded.

The plugin checks its own work and fails the build if an `oklch()`, a
shorthand with no fallback, or an unfolded layer remains. It **only runs at
build time**: under `pnpm dev`, an old browser still sees the
non-downgraded sheet. The full reasoning, `color-mix()` included, is in
[D260809f](./08-decisions/D260809f-the-style-sheet-is-lowered-at-build-time-not-written.md).

## Installable application

The viewer can be added to the home screen and opens with no address bar.
The point is not technical: a family member remembers an icon, not a URL,
and the session already lasts a year (`SESSION_TTL_MS`), so opening the
application never asks for anything again. Three pieces suffice — a
manifest, icons, a service worker.

### The manifest — `public/manifest.webmanifest`

`display: standalone`, `start_url` and `scope` set to `/`. `background_color`
and `theme_color` are `#0b0b0d`, that is, `--color-ink-900`: the splash
screen extends the application's background instead of flashing white before
it. These values are **taken** from `styles.css`, not chosen separately; a
test compares them.

`index.html` additionally declares what iOS does not read from the
manifest: `apple-touch-icon`, `apple-mobile-web-app-title`, and
`apple-mobile-web-app-status-bar-style: black`. **`black`, not
`black-translucent`** — the latter lets content pass under the status bar,
and the viewer's header, positioned `absolute` at the very top, would end up
there.

### The instance name — `APP_NAME` and `shell.ts`

The static file carries `Photos`, and the server substitutes `APP_NAME`
into it on startup. Two files, four locations:

| File                   | Location                     | What it names                         |
| ---------------------- | ---------------------------- | ------------------------------------- |
| `index.html`           | `<title>`                    | The browser tab                       |
| `index.html`           | `apple-mobile-web-app-title` | The iOS home-screen icon              |
| `index.html`           | `application-name`           | What the front end reads back (below) |
| `manifest.webmanifest` | `name`, `short_name`         | The Android home-screen icon          |

An environment variable rather than a build constant: **a single image
serves every installation**, and nobody rebuilds a container just to name
their gallery differently. A restart is enough, as with the rest of `.env`.
The full reasoning is in
[D72](./08-decisions/D72-the-instance-name-lives-in-env-and-the-server-puts-it-in.md).

The manifest is only overridden on its two name fields: icons, colours, and
`display` stay declared in the single file that lists them, otherwise they
would drift apart the first time a size is added. A manifest **absent**
from the built front end merely logs a warning on startup — the application
stays usable, it simply stops being installable, the same trade-off as for a
missing front end. A manifest **present but unreadable** halts startup: it
is a file from the repository, and if it fails to parse the build is broken.

`shell.ts` carries the substitution, and `test/shell.test.ts` runs it
against the **real** `index.html`. This is the invariant that matters:
adding an attribute to the `<title>` tag or swapping `name` and `content` in
a `<meta>` breaks nothing visible — the server starts, the page displays, it
simply carries the wrong name.

### `lib/appName.ts`

The front end reads the name from the DOM's `application-name` tag, not
from an API response. It is there from the very first byte of JavaScript,
whereas a network call would show an empty title while waiting for the
response — and this is the only way to have it available on the sign-in
screen, which displays precisely when no authenticated route responds.

### The icons — `public/icons/`

`icon.svg` is the source, and also serves as the favicon (there was none
before). Six tiles of unequal widths across two rows, in `--color-accent`
and `--color-accent-dim` on an `--color-ink-900` background: **it is the
justified grid the application actually renders on screen**, not a generic
image pictogram — the first attempt, a thin-lined frame, vanished at the
size an icon is actually looked at.

Two flat fills rather than opacities, because an opacity composites with
whatever is behind it and Android places the maskable variant on its own
background. Gutters at 16 units out of 512, i.e. 1.75 px on a 56 px
launcher icon: below that they close up and the six tiles become a smudge.

The PNGs are derived once and for all, with `sharp` — already a server
dependency:

```bash
cd packages/web/public/icons && pnpm --filter @lukarn/server exec node -e "
const sharp = require('sharp'); const s = () => sharp('icon.svg', { density: 384 });
Promise.all([
  s().resize(192).png().toFile('icon-192.png'),
  s().resize(512).png().toFile('icon-512.png'),
  s().resize(512).flatten({ background: '#0b0b0d' }).png().toFile('icon-maskable-512.png'),
  s().resize(180).flatten({ background: '#0b0b0d' }).png().toFile('apple-touch-icon.png'),
]);"
```

Two details carry everything else. The `flatten` fills the transparent
corners with the dark background: that is what distinguishes the
**maskable** variant, which Android crops into the system's shape and must
therefore overflow, from the `any` variant, which it displays as-is with its
rounded corners. And the mosaic occupies 59% of the canvas in width, 50% in
height, which keeps it within the safe zone — the circle covering 80% of the
side — whatever mask gets applied.

No permanent script: the recipe fits in the block above, and one more
script would be one more module to document for four files that will not
change.

### The service worker — `public/sw.js`

Three rules, in this order:

| Request                         | Strategy                                                     |
| ------------------------------- | ------------------------------------------------------------ |
| `/api/…`, non-GET, other origin | **Ignored** — passes through to the network, no interception |
| Navigation (`request.mode`)     | Network first, falls back to the cached shell                |
| `/assets/…`                     | Cache first — hashed names, hence immutable                  |

**It only caches the shell** — the HTML, the JS, the CSS. Never a photo,
never an API response. The reason why is in
[D71](./08-decisions/D71-the-service-worker-caches-the-shell-never-the-photos.md):
on a shared phone, a photo cached by the application would survive an
account switch, and the private HTTP cache set by the server already keeps
them fast without that risk.

`install` caches `/` immediately, without waiting for a navigation to hit
it: otherwise the first offline open, right after being added to the home
screen, would find nothing.

`activate` refetches `/`, reads the `/assets/…` it references, replaces the
cached shell, and deletes bundles absent from the new one. Without this
purge, the cache would grow by one build on every deployment, indefinitely —
the names carry a hash, nothing ever overwrites anything. Everything is
wrapped in a `try`: offline, it simply skips the purge.

**No `skipWaiting()`.** An open tab keeps running on the bundles it already
loaded; the new version takes over on the next launch.

### `lib/registerServiceWorker.ts`

Registers `/sw.js` on `load`, and **only if `import.meta.env.PROD`**: in
development, a service worker holding onto the shell would serve stale
files on every reload, and it would have to be unregistered by hand to
understand why a change is not taking effect. Registration failure is
swallowed — the application works without it.

Called from `main.tsx`.

### `lib/useInstallPrompt.ts` and `components/InstallInstructions.tsx`

The install prompt appears **in two places depending on width** — a button
in the bar, a line in the menu. Its state therefore lives in a hook, not in
a component: duplicated between the two renders, it would eventually drift
apart (the button would disappear after `appinstalled`, the menu line would
not).

- **Android, Chrome**: `beforeinstallprompt` is captured with
  `preventDefault()` — otherwise the browser shows its own banner and the
  event can never be replayed — then `installer()` calls `prompt()`.
- **iOS**: no API, `manual` is true, and the `TopBar` opens
  `InstallInstructions` — a three-step walkthrough, modelled on
  `ShortcutsOverlay` so as not to invent a second overlay style. This is
  necessary because the path (Share → Add to Home Screen) cannot be guessed.
- **Elsewhere**: `available` is false and nothing displays — an inert
  invitation is worth less than no button at all. Likewise as soon as the
  application runs in `display-mode: standalone`, as soon as
  `navigator.standalone` says so, or once `appinstalled` is received.

**`InstallInstructions` renders into `document.body`, via `createPortal`.**
The `TopBar`'s header carries a `backdrop-blur`, and a filter makes the
element the containing block for its positioned descendants: the overlay's
`inset-0` used to be relative to the bar, and the dialog ended up centred
there then clipped at the top. `ShortcutsOverlay` does not have this
problem — it is mounted from a page, not from the bar. The menu, for its
part, **benefits** from this same mechanism: being `absolute`, it naturally
anchors under its button.

### Safe areas

Only two places, where standalone mode genuinely breaks something.
Elsewhere, the application does not touch the edges.

- `CommentsPanel` — the form anchored at the bottom would slide under the
  iPhone's home bar: `pb-[calc(1rem_+_env(safe-area-inset-bottom))]`.
- `Lightbox` — in landscape, the notch covers the Close button exactly:
  `env(safe-area-inset-left/right)` on the header's margins. The gradient,
  for its part, already reaches the edge.

`index.html` already carries `viewport-fit=cover`, without which `env()`
would be zero.
