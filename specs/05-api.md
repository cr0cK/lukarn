# 05 — API

Everything is mounted under the `/api` prefix (`packages/server/src/app.ts`). Response
shapes are the types from `packages/shared/src/index.ts`.

"Access" column:

- **none** — open route;
- **session** — valid `lukarn_session` cookie, otherwise 401 `unauthorized`;
- **admin** — session **and** `admin: true`, otherwise 401 or 403 `forbidden`.

## The language of a response — `plugins/locale.ts`

Every request carries a language, resolved from `Accept-Language` before
authentication so that a refusal is already written in it. The front end sends
the language chosen in its account menu rather than the browser's own list; a
link opened straight from an inbox — the two unsubscribe pages — carries that
list instead, quality factors and all. Neither a missing nor a malformed header
is an error: `DEFAULT_LOCALE` applies (see [06](./06-configuration-and-deployment.md)).

Two things follow from it. `request.t` translates every message below through
`i18n/messages-en.ts` and `i18n/messages-fr.ts`; and, when the session carries a
commenter identity, the language is **recorded** on it — only when it changes —
so an email composed hours later reaches its recipient in the language they read
(see [03](./03-data-model.md) and D260812d).

**The recording reads only requests the application made itself**, which
`plugins/auth.ts` tells apart by `Sec-Fetch-Dest`: `empty` is a `fetch()` carrying
the language the interface is displaying, and everything else is a subresource the
browser asked for with its own preference. A thumbnail says nothing about what
somebody reads, and a cold grid sends hundreds of them, so without this a language
chosen for a person is overwritten by the first photographs they open
([D260819c](./08-decisions/D260819c-the-language-of-an-invitation-is-chosen-by-whoever.md)).
A browser sending no such header keeps the earlier behaviour.

**An invitation is the one message with nobody to read a language from.** Its
recipient has made no request here, so nothing about them is recorded: whoever
sends it chooses, `POST /api/admin/users` and
`POST /api/admin/users/:username/invite` carry that choice, and
`verification_codes.locale` keeps it so that sending the message again repeats it
(D260819c). `DEFAULT_LOCALE` applies when nobody chose.

Logs are not translated: they are read next to the code, which is in English.

## Error responses

All errors have the `ApiError` shape:
`{ "error": "<code>", "message": "<text in the language of the request>" }`.

**The `error` code is the contract; the message is for the eye.** The front end
displays the message and never branches on it — it is translated, and comparing
translated text is how a refusal silently stops being recognised.

The global handler in `app.ts` returns `internal_error` / "Internal error" for
any status ≥ 500 — the detail stays in the logs — and `request_error` with the
actual message otherwise.

## Health

| Method | Path          | Access | Response               |
| ------ | ------------- | ------ | ---------------------- |
| GET    | `/api/health` | none   | `200 { status: 'ok' }` |

Used by the Dockerfile's `HEALTHCHECK`.

## Version — `routes/version.ts` and `updates.ts`

| Method | Path           | Access    | Response      |
| ------ | -------------- | --------- | ------------- |
| GET    | `/api/version` | signed in | `VersionInfo` |

```ts
{
  version: string;          // '1.2.3', or 'dev' outside a release
  changelogUrl: string;     // every version, including the one being offered
  update: { version: string; url: string } | null;
}
```

**Signed in rather than public.** The version an instance runs is what a scanner
collects, and a visitor at the sign-in screen has no use for it. Everyone who has
signed in sees it, because an AGPL interface naming the software that serves it is
the point of the line (D260815).

**`update` is only ever filled for an administrator**, and only their request can
cause the release feed to be called. An access key cannot move the instance from
one image to another, so announcing a release to it would be an interruption with
no action behind it. It is also `null` when the instance is up to date, when
`UPDATE_CHECK_URL` is empty, when the feed could not be reached, and when
`APP_VERSION` is not three numbers — every local build, which therefore contacts
nobody at all.

`updates.ts` holds the question and its answer: **at most one call every six
hours**, half an hour after a failure, one shared request when two screens ask at
once, and nothing persisted — the cache lives in the process, since a table for
one row would be a migration for it. Five-second timeout, because an administrator
is waiting on the response. A failure is logged and answered as "nothing to
report": not knowing whether an update exists changes nothing about serving
photos.

Nothing here updates anything. See [07](./07-frontend.md) for where the line and
its badge are shown, and [06](./06-configuration-and-deployment.md) for the two
variables.

## Authentication — `routes/auth.ts`

| Method | Path                                 | Access  |
| ------ | ------------------------------------ | ------- |
| POST   | `/api/auth/login`                    | none    |
| POST   | `/api/auth/logout`                   | none    |
| GET    | `/api/auth/me`                       | none\*  |
| GET    | `/api/auth/setup-state`              | none    |
| POST   | `/api/auth/code/request`             | none    |
| POST   | `/api/auth/code/verify`              | none    |
| POST   | `/api/auth/device/start`             | none    |
| POST   | `/api/auth/device/poll`              | none    |
| GET    | `/api/auth/device/:userCode`         | session |
| POST   | `/api/auth/device/:userCode/approve` | session |

**`POST /api/auth/login`** — body `{ username, password }` (1–64 and 1–512
characters). **The username is trimmed** before being looked up — the bounds
apply to the trimmed value, so `"   "` returns `400`. No account can contain a
space (`USERNAME_PATTERN`), and rejecting one that came from a mobile
autocomplete would fail a submission right under the message for a wrong
password. The password is left untouched: it is allowed to contain one.

| Code | Body                                       | When                                                                      |
| ---- | ------------------------------------------ | ------------------------------------------------------------------------- |
| 200  | `SessionUser` = `{ username, admin }`      | Success. Sets the `lukarn_session` cookie.                                |
| 400  | `bad_request`                              | Missing body or out of bounds.                                            |
| 401  | `invalid_credentials`                      | Unknown username **or** wrong password — identical message in both cases. |
| 429  | `too_many_attempts` + `Retry-After` header | Throttle active on one of three axes: IP/username pair, username, IP.     |

**`POST /api/auth/logout`** — destroys the session if the cookie names one,
clears the cookie. Always responds `200 { ok: true }`, even without a session.

**`GET /api/auth/me`** — `200 SessionUser` = `{ username, admin, identity,
identityBound, commentsEnabled }` if signed in, `401 unauthorized` otherwise.
`identityBound` says the identity above comes from the **account** rather than
from this session, which is what an account bound to a person means. The front
end reads it to stop offering to change or forget an identity the server will
refuse to change or forget: on such an account the way out is to sign out. \*Open route in the sense that it does not reject before entering: the
401 is the normal response for a signed-out visitor, and the front end uses it to
decide whether to show the sign-in form.

`identity` is a `CommenterIdentity` = `{ email, displayName, notify, locale }`.
`locale` is the language this person is written to in, `null` while none is
recorded, and their own requests maintain it through `Accept-Language` (D260812d).
An invitation seeds it when the identity has none, which is what lets the interface
open in it: it is read as a session begins, on a bound account alone
(see [07](./07-frontend.md) and D260819c).

**`GET /api/auth/setup-state`** — `200 { needsSetup: boolean }`. Says whether the
database still holds no account, in which case the sign-in screen shows the
command to run (`pnpm create-admin`) instead of rejecting every attempt without
explanation.

Public, and it has to be: it is queried before any sign-in. It discloses
nothing — on an instance with no account there is nothing to protect, and the
response never says **who** exists, only whether anyone does
(`packages/server/test/setup-state.test.ts` verifies this).

### Signing in with a code — `verification-codes.ts`

An account bound to a person holds no password. It is entered with six digits
sent to the address it is bound to, and an invitation is taken up the same way
(D260819b). Both routes are public, since nobody signing in has a session yet,
and both therefore say **one thing only** about the address they are given.

**`POST /api/auth/code/request`** — body `{ email }`. Sends a code, or does not.

| Code | Body                                       | When                                                              |
| ---- | ------------------------------------------ | ----------------------------------------------------------------- |
| 202  | `{ ok: true }`                             | The body parsed. What the route then did is not in the response.  |
| 400  | `bad_request`                              | Missing body, or a value that is not an address.                  |
| 429  | `too_many_attempts` + `Retry-After` header | Throttle on the caller's `ip` axis, checked before anything else. |
| 503  | `mail_not_configured`                      | The instance has no SMTP relay, so no code could go out.          |

The `202` covers four situations: the address opens an account, an invitation to
it is waiting, nothing here knows it, and a code went to it less than a minute
ago. Telling them apart would make two rapid requests a test for "does this
address open an account here", which is the question a public route must not
answer. The `503` is a property of the instance rather than of the address, so it
is allowed to be visible: it says nothing about who has an account, and the
alternative is a `202` followed by somebody waiting for an email that was never
going to be sent.

An expired invitation is not remade. Once the hourly purge has taken the row,
nothing still connects that address to that account, and inviting it again is the
administrator's to do.

**`POST /api/auth/code/verify`** — body `{ email, code, displayName? }`. Spends
the code and opens the session, writing the binding when what was spent was an
invitation.

| Code | Body                                       | When                                                                                  |
| ---- | ------------------------------------------ | ------------------------------------------------------------------------------------- |
| 200  | `SessionUser`                              | Success. Sets the `lukarn_session` cookie.                                            |
| 400  | `bad_request`                              | Missing body, or a code that is not `VERIFICATION_CODE_LENGTH` long.                  |
| 400  | `display_name_required`                    | Valid invitation, for an address this instance cannot name.                           |
| 400  | `invalid_code`                             | Unknown, mismatched, expired or exhausted, with one body for all four.                |
| 409  | `identity_taken`                           | The address was bound to another account between the two requests.                    |
| 429  | `too_many_attempts` + `Retry-After` header | Throttle, on the sign-in flow's three axes, the address standing in for the username. |

Which code is looked for is decided by the address rather than by the caller: an
address that opens an account is a `signin` code, any other is an `invite`.
Purpose is half the primary key of `verification_codes`, so a code minted for one
flow is not found by the other rather than merely refused by it.

**One refusal for four cases.** `invalid_code` answers a code nothing knows, a
wrong one, an expired one and one whose five attempts are spent.
`routes/identity.ts` tells the same four apart and may keep doing so, because
`requireAuth` guards its whole prefix and the caller is already inside the
instance. That argument does not survive on a route anybody can call, which is
why the two flows differ here.

**`display_name_required` consumes nothing.** `commenters.display_name` is
`NOT NULL`, an invitation carries an address and an account, and nothing else
names the person, so accepting one for an address this instance does not know
asks for a name. The screen cannot know in advance whether it will be needed:
somebody typing their own address gets the same `202` whether they are being
invited or signing in again. The answer therefore arrives after a valid
comparison, and the transaction is rolled back — the code is not spent and the
attempt is not counted. Without that, a correct code arriving on the fifth
attempt would answer `display_name_required` and be exhausted by the time the
name came back. The screen asks, and resubmits with `displayName` set.

A row whose `verified_at` is `NULL` counts as unknown here and its owner is asked
for their own name: `CommenterRepo` records a declared name before verification,
so anybody behind a shared key can pre-seed an address with wording of their
choosing. Only an **already verified** identity is adopted as it stands, keeping
the comments it has already signed, and `displayName` is ignored on that path
rather than renaming it (D42).

### Pairing a screen — `pairings.ts`

Four routes for a single exchange: a keyboard-less screen shows a code, a phone
already signed in approves it, the screen picks up the session. The reasoning is
in [D260809c](./08-decisions/D260809c-a-television-does-not-type-a-password-it-displays.md), its access rules in
[04](./04-security-and-access.md).

**`POST /api/auth/device/start`** — no body. Opens a request.

| Code | Body                                       | When                                                                    |
| ---- | ------------------------------------------ | ----------------------------------------------------------------------- |
| 200  | `DevicePairingStart`                       | Success. `{ userCode, deviceCode, expiresAt, intervalMs }`.             |
| 429  | `too_many_pairings` + `Retry-After` header | `MAX_PENDING` pending requests: the table is bounded, not the patience. |

`userCode` is meant to be read on screen — eight characters from an alphabet
without `I`, `O`, `0` or `1`, delivered grouped by four. `deviceCode` is not:
32 bytes rendered **once only**, to the requester, and never displayed.

**`POST /api/auth/device/poll`** — body `{ deviceCode }`. The screen's polling,
every `intervalMs` (2 s).

| Code | Body                                | When                                                                    |
| ---- | ----------------------------------- | ----------------------------------------------------------------------- |
| 200  | `{ status: 'approved', user }`      | Approved. Sets the `lukarn_session` cookie and **deletes the request**. |
| 202  | `{ status: 'pending' }`             | No one has approved yet.                                                |
| 400  | `bad_request`                       | Missing body or out of bounds.                                          |
| 404  | `unknown_code`                      | Unknown, expired, already picked up, or the approving account is gone.  |
| 429  | `too_many_attempts` + `Retry-After` | Throttle, on the sign-in flow's three axes.                             |

A POST rather than a GET: the response sets a cookie, and the `deviceCode` has no
business being in a URL — access logs and history would keep it.

**`GET /api/auth/device/:userCode`** — what the phone shows before approving:
`200 { userCode, expiresAt, approved }`, or `404 unknown_code`. An already
approved code is not an error — it is what lets the page say "This screen has
already been paired" rather than "That code is no longer valid" to whoever
reopens it.

**`POST /api/auth/device/:userCode/approve`** — no body.

| Code | Body             | When                                                                                    |
| ---- | ---------------- | --------------------------------------------------------------------------------------- |
| 200  | `{ ok: true }`   | Approved on behalf of the calling session. Replaying the same approval changes nothing. |
| 401  | `unauthorized`   | No session: the phone signs in first, then comes back.                                  |
| 404  | `unknown_code`   | Unknown or expired.                                                                     |
| 409  | `already_paired` | Some **other** account approved it in the meantime.                                     |

No session is created here: the approval records who approved it, and it is the
polling that creates the session — otherwise a screen switched off in the
meantime would leave behind a year-long session that no one ever opened.

## Albums — `routes/albums.ts`

`requireAuth` as a `preHandler` on the whole prefix.

| Method | Path                                  | Access  | Response      |
| ------ | ------------------------------------- | ------- | ------------- |
| GET    | `/api/albums`                         | session | `Album[]`     |
| GET    | `/api/albums/:albumId`                | session | `Album`       |
| GET    | `/api/albums/:albumId/days`           | session | `AlbumDay[]`  |
| GET    | `/api/albums/:albumId/items`          | session | `ItemsPage`   |
| GET    | `/api/albums/:albumId/items/:mediaId` | session | `MediaDetail` |

**`GET /api/albums`** — only the albums assigned to the user, in their creation
order (`position` column). A bare array, not wrapped.

`Album` carries `groupBy` (`month` \| `day`): the split applied when the album is
opened, which the URL's `?group=` parameter can override. It is a preference of
the album, not a split of the request — the list served is the same either way.

It likewise carries `sortOrder` (`desc` \| `asc`): the reading direction applied
when opened, which `?order=` overrides. Here, though, it is not just a matter of
layout — the direction goes to the server, which sorts and paginates in that
direction. The front end uses it as a **last** resort: the URL takes precedence,
then what the browser remembered for this album (see [07](./07-frontend.md) and
D99).

**`GET /api/albums/:albumId`** — `404 not_found` if the album does not exist
**or** is not assigned (see [04](./04-security-and-access.md)).

**`GET /api/albums/:albumId/days`** — the annotated days of the album. Same
access rule as everything else: `404 not_found` if the album is unknown **or**
not assigned.

```ts
interface AlbumDay {
  day: string; // 'YYYY-MM-DD' UTC, the key of the day-level split
  description: string | null;
  place: string | null; // typed by hand, takes precedence over autoPlaces
  autoPlaces: string[]; // inferred from EXIF, earliest to latest
}
```

Only days **that have something to show** are rendered: a note, a typed place,
or at least one inferred place already geocoded. A day reduced to cells that no
geocoding has yet named has nothing to display, and carrying it would add one
entry per album day. A cell with no label disappears from `autoPlaces` instead
of leaving a gap there.

`autoPlaces` is asynchronous by nature: geocoding runs in the background,
capped at one request per second (see [02](./02-architecture.md) and D48). The
interface must therefore hold up without it, and places light up on their own on
the next pass.

**`GET /api/albums/:albumId/items`** — query parameters:

| Parameter | Type             | Default | Constraint                                                              |
| --------- | ---------------- | ------- | ----------------------------------------------------------------------- |
| `cursor`  | base64url string | —       | ≤ 512 characters. Unreadable ⇒ ignored, the page restarts from the top. |
| `limit`   | integer          | 200     | 1 to 500                                                                |
| `order`   | `desc` \| `asc`  | `asc`   | Any other value ⇒ **400**, no silent fallback.                          |

Response `ItemsPage` = `{ items: MediaItem[], nextCursor: string | null }`.
`nextCursor: null` signals the end of the album. Codes: `400 bad_request` if the
parameters are invalid, `404 not_found` if the album is unknown or forbidden —
access control runs **before** parameter validation.

**A deliberate side effect**: on the **first page** only (`cursor` absent), if
the session carries a verified identity, an `INSERT OR IGNORE` subscribes that
person to the album's new items (see [04](./04-security-and-access.md) and
[D41](./08-decisions/D41-opening-an-album-subscribes-you-to-updates.md)). One
write per album opening, negligible. Neither later pages nor `/items/:mediaId`
do this.

The default is `DEFAULT_SORT_ORDER`, the same constant as the `albums.sort_order`
column: the route does not read the album's preference, it only knows what the
client passes it. It is the front end that resolves the direction — URL, then
browser, then album — and sends the result (see [07](./07-frontend.md)).

`packages/server/test/items-order.test.ts` locks down this route's contract: the
`asc` default (an album reads in the direction it was lived, as long as nothing
asks for another, D99), pagination in the requested direction, `400` on
`zigzag`, `ASC`, `''` or `asc,desc`, and `404` on a forbidden album regardless of
the order.

**`GET /api/albums/:albumId/items/:mediaId`** — `MediaDetail` = `MediaItem` plus
the `exif` block and `commentCount`. `404` if the album is unknown/forbidden,
`404` if the item is not in **this** album.

`commentCount` is composed by the route, not by `MediaRepo`: the media index has
no business knowing about comments, or every media request would become one
more join. It counts **visible** comments, replies included, and travels with
the detail so the viewer can show "3" on its tab without loading a thread most
visitors will never open.

**`MediaItem.hasPreview`** — can the server render an image for this item? True
for every photo, and for a video whose first-second preview Drive has produced
([D92](./08-decisions/D92-a-video-preview-comes-from-drive-not-local-decoding.md)). It is a **question, not a
column**: the front end asks for a thumbnail "when there is one" without
replaying the photo/video rule on its side, and without requesting, on every
grid load, an image doomed to a 415 for a video Drive has no preview for — a
codec it does not read, or a file dropped too recently to have been processed.

**`MediaItem.videoCodec`** — the four-letter code of a video's image-track
codec, as written in the file: `avc1`, `hvc1`, `hev1`. `null` for a photo and for
any video whose header has not been read, an empty string when it has been read
without recognising an image track in it (see the three states of `video_codec`
in [03](./03-data-model.md)).

It travels with the item because **the client chooses its own source**: with the
real codec, `canPlayType` gives a straight answer where `video/mp4` alone
answers `maybe` everywhere and learns nothing (D98). Chrome therefore requests
`/playable`, while Safari and an iPhone keep `/original` at full quality
(D260809b).

**`MediaItem.description`** — the caption typed by hand on this photo, `null` if
no one has written one. It is carried by the **(album, item)** pair: the same
file indexed under two albums carries two of them, just as it carries two
comment threads ([04](./04-security-and-access.md), D12).

It travels with the item, rather than through a batch call like
`AlbumCommentCounts`: the viewer must display it on the photo just reached by
the arrow key, the list is already loaded, and the text is short where a
per-photo count fits in a single integer (D83). On the server side this is a
1-to-1 join on `media_notes`'s primary key, with no effect on pagination.

`MediaDetail` inherits it by extending `MediaItem`: the `i` panel has nothing
further to ask for.

## Search — `routes/search.ts`

`requireAuth` as a `preHandler` on the whole prefix.

| Method | Path          | Access  | Response      |
| ------ | ------------- | ------- | ------------- |
| GET    | `/api/search` | session | `SearchHit[]` |

| Parameter | Type   | Constraint                                                 |
| --------- | ------ | ---------------------------------------------------------- |
| `q`       | string | 2 to 100 characters. Out of bounds ⇒ **400**, no fallback. |

**The scope comes from the server, never from the client.** It is
`context.albumsFor(session)`'s scope: no result can name an unassigned album,
and a session with no album responds `[]` without querying the database. There
is therefore no parameter to narrow the search — narrowing it further would be a
display filter, not a security matter.

**What is rendered is a navigable entity, not a text excerpt.** "Marseille"
should open the day at Marseille, not display the line where the word appears —
that is what distinguishes this route from a `grep`.

```ts
type SearchHitKind = 'album' | 'day' | 'media';

interface SearchHit {
  kind: SearchHitKind;
  albumId: string;
  albumTitle: string;
  label: string; // album title, place, or the start of a note
  context: string | null; // what situates it without repeating the label
  day?: string; // 'YYYY-MM-DD', present for kind: 'day'
  mediaId?: string; // present for kind: 'media'
}
```

Neither the date nor the album name is composed into `context`: they travel
separately (`day`, `albumTitle`) because dates are displayed in UTC through
`format.ts` (see [07](./07-frontend.md)), and composing them here would freeze
them in the server's time zone.

**What is indexed, and what is not:**

| Source                               | Rendered type | Navigates to                          |
| ------------------------------------ | ------------- | ------------------------------------- |
| `albums.title`, `albums.description` | `album`       | `/album/:id`                          |
| `album_days.description`, `.place`   | `day`         | `/album/:id?group=day&day=YYYY-MM-DD` |
| `geo_places.label` (via `.cells`)    | `day`         | same                                  |
| `media_notes.description`            | `media`       | `/album/:id?photo=<mediaId>`          |

`media.name` is excluded: `IMG_1234.jpg` is noise, and indexing it would drown
out real labels. So are `camera_make` and `camera_model` — searching "iPhone"
would return half the library. Comments stay out of scope: searching what
others have written is a different feature, with its own visibility rules
([D96](./08-decisions/D96-the-search-index-is-maintained-by-the-schema-not-the-code.md)).

**Ranking stops within a single type.** Each group is sorted by `bm25()` and
capped at `SEARCH_HITS_PER_KIND` (5); results arrive in the order the groups are
displayed — albums, days, photos. No score is compared across types: a
three-word title's score and a three-line note's do not mean the same thing,
and since the display is grouped, the question does not arise.

Two filters are not decorative: a description whose media item has left the
index (`deleteStale`, D83) renders nothing — a result pointing at a missing
photo would open an empty viewer — and a day that matches **both** through its
note and through its place appears only once.

The index itself is described in [03](./03-data-model.md): four
external-content FTS5 tables maintained by SQL triggers, migration 11.
`packages/server/test/search.test.ts` locks down the isolation, accents,
prefixes, deduplication, and the fact that the index follows writes.

## Commenter identity — `routes/identity.ts`

`requireAuth` on the whole prefix: an identity is declared from a session that
is already open, the access key and the person being two distinct things.

| Method | Path                         | Response      |
| ------ | ---------------------------- | ------------- |
| POST   | `/api/identity/request-code` | `202`         |
| POST   | `/api/identity/verify`       | `SessionUser` |
| POST   | `/api/identity/forget`       | `SessionUser` |

**All three answer `409 identity_bound` on a bound account**, refused by a second
`preHandler` before any handler runs. The identity of such an account is not the
session's to choose: `plugins/auth.ts` reads it from the account, so declaring
another address would attach an identity the account contradicts, and forgetting
one would silently do nothing. Changing the address of a bound account is out of
scope for this release; here the way out is to sign out (D260819).

**`request-code`** — body `IdentityRequest` = `{ email, displayName }`. Sends a
six-digit code and responds `202` **whether the address is already known or
not**: telling the two apart would tell whoever tries it which addresses have
already commented here. The supplied name is not applied straight away if the
identity is already verified — it waits for the code (D42). `429 too_soon` with
`Retry-After` if a code was sent within the last minute — otherwise the form
would fire emails in bursts at an address the requester does not own. `503
mail_not_configured` with no SMTP: no code can go out, so no one can comment.

**`verify`** — body `VerifyIdentityRequest` = `{ email, code }`. Attaches the
identity to the session and returns the updated `SessionUser`. `400` on a wrong,
expired or exhausted code — **the same message in all three cases**, since
detailing which one would mostly help someone trying codes at random. Five
attempts, then a new code must be requested.

Both routes distinguish more than `/api/auth/code/*` does: `request-code` answers
`429 too_soon` inside the minute after a send, and `verify` returns the failure
in its `error` field. What makes that acceptable is `requireAuth` on the prefix,
so the caller already holds an account here. The public sign-in routes carry no
such guarantee and answer uniformly, which is the difference the two sections
describe.

**`forget`** — detaches the identity from this session. Comments already
written stay in place: they belong to the conversation, not to the device.
Re-identifying with the same address finds them again, and the right to delete
them along with it.

The signature shown is **the current one**, not the one at the time of writing:
the thread reads `commenters.display_name` through a join. Renaming yourself
therefore renames your entire history, which is the intended behaviour — the
identity is the address, the name is only its current label. This is also why a
rename waits for code validation (`pending_display_name`, see
[03](./03-data-model.md)): without that, the request alone would have
been enough to rewrite the signature on all of someone else's messages.

## Comments — `routes/comments.ts`

| Method | Path                              | Access   | Response             |
| ------ | --------------------------------- | -------- | -------------------- |
| GET    | `/api/comments/feed`              | session  | `CommentsFeedPage`   |
| GET    | `/api/comments/:albumId`          | session  | `AlbumCommentCounts` |
| GET    | `/api/comments/:albumId/:mediaId` | session  | `CommentsPage`       |
| POST   | `/api/comments/:albumId/:mediaId` | session  | `Comment`            |
| PATCH  | `/api/comments/:commentId`        | session  | `Comment`            |
| DELETE | `/api/comments/:commentId`        | session  | `204`                |
| GET    | `/api/comments/unsubscribe`       | **none** | HTML page            |

Access control is redone in each handler rather than set as a prefix
`preHandler` as for media: here the album does not occupy a fixed URL segment.
It stays identical to the one for albums — **404 and never 403** on an unknown
or unassigned album (see [04](./04-security-and-access.md)).

**`GET /api/comments/feed?album=&cursor=&limit=`** — `CommentsFeedPage` =
`{ comments: FeedComment[], nextCursor }`, from most recent to oldest, across
every album and photo. `FeedComment` is a `Comment` augmented with what
situates it and lets you go back to it: `albumId`, `albumTitle`, `mediaId`,
`mediaName` and `mediaVersion` — the last two `null` if the photo has left the
index, the message remaining readable with no thumbnail or link.

This is the only route that renders, in one response, messages from different
albums. **The scope comes from `albumsFor()`, never from the request**:
`?album=` only narrows it, and an album you cannot see responds 404 as
everywhere else. A session with no album at all renders an empty page.

`limit` ranges from 1 to 100, `COMMENTS_FEED_PAGE_SIZE` (30) by default. The
upper bound is not cosmetic: `better-sqlite3` is synchronous, and composing a
page of a hundred thousand comments would block the event loop for the time it
takes to render it.

The cursor is a comment id, like the one used for moderation. No `total`: this
is not moderation, it is watching what has just arrived, and counting the whole
visible corpus would cost a query for a number no one reads. The order is
descending primary key — SQLite walks the table backwards and stops at
`LIMIT`, with no extra index needed (see [03](./03-data-model.md)).

The literal `feed` segment is protected by the same precedence as
`unsubscribe`, and the reverse holds too: an album whose id was `feed` would
never get its counts. A test verifies this.

**`GET /api/comments/:albumId`** — `AlbumCommentCounts` =
`{ counts: Record<mediaId, number> }`, hidden ones excluded. Photos with no
comment **do not appear in it**: on an album with thousands of views where a
handful carry a conversation, the response fits in a few hundred bytes. A
missing photo therefore counts as zero.

One call for the whole album, not one per photo: the viewer's badge must be
there as soon as a photo is reached, and stepping through an album with the
arrow key would otherwise trigger one request per photo crossed (see
[D54](./08-decisions/D54-comment-counts-are-requested-per-album-not-per-photo.md)).
The `MediaDetail.commentCount` counter stays: it serves the open panel's tab,
for one specific photo.

This parametric route **does not shadow `/api/comments/unsubscribe`**:
Fastify's routing table matches a literal segment before a parameter. This is
verified by a test — the reverse would make the comment-unsubscribe links in
emails already sent respond 401, with no way to recover.

The reverse is also true from this route, and it is worth knowing:
`ALBUM_ID_PATTERN` allows the id `unsubscribe`, creatable from `/admin`. Such an
album would **never** get its counts — `GET /api/comments/unsubscribe` would
render the unsubscribe HTML page, outside any session. This is an accepted
collision: precedence protects the link in emails already sent, which is the
irreparable case, over an album id its creator can rename.

**`GET /api/comments/:albumId/:mediaId`** — `CommentsPage` =
`{ threads: CommentThread[], total: number }`, where `CommentThread` =
`{ root, replies }`. Comments hidden by moderation do not appear in it,
**including for their own author**. A reply whose root has just been hidden
rises to the top of the thread, `parentId` reset to `null`: leaving it attached
to a missing parent would make it disappear without anyone having decided so.

**`POST`** — body `CreateCommentRequest` = `{ body, parentId? }`. `body` is
trimmed of surrounding spaces before validation: 1 to `COMMENT_MAX_LENGTH`
(2000) characters. `201` with the created `Comment`.

- **`403 identity_required`** as long as no verified identity is attached to
  the session. Second accepted exception to "404 and never 403" (see
  [04](./04-security-and-access.md)): the refusal concerns the state of one's own
  account, not someone else's resource.

- `404` if the album is unknown/forbidden, or if the media item is not in this
  album.
- `404` if `parentId` names a comment that does not exist **or lives on another
  media item** — without this second check, a client could graft its reply onto
  a thread it has no right to read by guessing an id.
- Replying to a reply **does not fail**: the message is attached to the
  thread's root (see
  [D35](./08-decisions/D35-replying-to-a-reply-attaches-it-to-the-root-instead-of.md)).

**`PATCH`** — body `UpdateCommentRequest` = `{ body }`, same bounds as `POST`.
**Its author only**, and only within `COMMENT_EDIT_WINDOW_MS` (30 s) after
publication. `parentId` is **ignored**: the schema only keeps `body`, and Zod
silently drops unknown keys — a `PATCH` sending one responds `200` without
having moved the message; it does not respond `400`. Fixing a typo must not
allow moving to another conversation. `created_at` does not move either — the
message stays in its place in a thread others were already reading. See
[D57](./08-decisions/D57-thirty-seconds-to-correct-a-typo-and-nothing-more.md).

- **`409 edit_window_closed`** once the delay has passed. Neither 403 nor 404:
  the refusal concerns the message's **state**, not an access right — its
  author can already see it, there is nothing to hide from them. The 404
  doctrine (D12) therefore does not apply here.
- `404` if the comment does not exist, belongs to someone else, has since been
  hidden, or lives in an album no longer visible. These cases remain
  indistinguishable, as for `DELETE`.
- **The administrator has no privilege here.** They moderate by hiding or
  deleting; rewriting under someone else's name is a power of a different
  nature.

The delay check happens **server-side**, not only in the interface: a rule only
the front end enforces is not a rule.

A `Comment` therefore carries **two rights computed by the server**, and their
asymmetry is D57's decision:

- `canDelete` — one's own comment, or any comment for an administrator. Stable
  as long as the session does not change.
- `canEdit` — one's own comment, and only within the window. No administrator
  privilege. This is a value that **expires on its own**: it states what the
  server would accept at the instant of the response, and the front end must
  cross-check it against `createdAt` through `remainingEditMs`, shared so both
  sides reach the same verdict.

The front end never replays these authorisation rules itself.

**`DELETE`** — the author their own comment, an administrator any comment.
`404` in every refusal case, without distinguishing "does not exist" from
"not yours". A visitor can only delete within an album they can still see,
otherwise a revoked access would leave a write right standing.

**`GET /api/comments/unsubscribe?u=&t=`** — `u` is the **email address**, not an
account id: it is the address that identifies a person. **The only route in
this prefix with no session.** This link is clicked from a mailbox, often on
another device: requiring a sign-in to stop being disturbed would amount to not
answering the request. `t` is an HMAC of the id, with no expiry (see
[04](./04-security-and-access.md)). Renders an HTML page served by the server —
not the front end, which would redirect to the sign-in screen. An invalid token
responds `400`; an account deleted since the email was sent renders the page
saying so.

## Subscriptions — `routes/subscriptions.ts`

| Method | Path                             | Access   | Response  |
| ------ | -------------------------------- | -------- | --------- |
| GET    | `/api/subscriptions/unsubscribe` | **none** | HTML page |

There is no route to subscribe: the subscription is the side effect of opening
an album, described above. This prefix therefore only carries the
unsubscription.

**`GET /api/subscriptions/unsubscribe?u=&a=&t=`** — `u` the email address, `a`
the album id, `t` an HMAC of the **pair**, with no expiry: one album's token is
not valid for another, otherwise a copied link would cut a subscription that
was not the target. No session, like the comment unsubscription — this is
clicked from a mailbox, often on another device.

`400 bad_request` on an incomplete link, an album id outside the pattern, or an
invalid token. Otherwise `200` and an HTML page served by the server: the front
end's version would redirect to the sign-in screen. An album deleted or an
identity erased since the email was sent renders the page saying so, without an
error. Unsubscribing only affects this album — replies to comments keep
arriving; they are cut off from `/api/comments/unsubscribe`.

## Media — `routes/media.ts`

`requireAuth` then `authorize` as a `preHandler` on the whole prefix.
`authorize` responds `404 not_found` as soon as the user has no right to any
album containing this media item.

A local error handler translates storage failures: `503 storage_revoked`
(`StorageRevokedError`) and `503 storage_disconnected`
(`StorageNotConnectedError`), rather than an opaque 500 repeated on every
thumbnail in the grid.

| Method | Path                           | Access           | Response               |
| ------ | ------------------------------ | ---------------- | ---------------------- |
| GET    | `/api/media/:mediaId/thumb?s=` | session + access | `image/webp`           |
| GET    | `/api/media/:mediaId/full`     | session + access | `image/webp`           |
| GET    | `/api/media/:mediaId/hd`       | session + access | `image/webp`           |
| GET    | `/api/media/:mediaId/original` | session + access | original file stream   |
| GET    | `/api/media/:mediaId/playable` | session + access | transcoded `video/mp4` |

**`thumb`** — `s` is 320 (default), 640 or 1280; any other value gives
`400 bad_request`. A non-numeric `s` falls back to 320 rather than failing.

**`full`** — full-screen rendering, long side capped at 2560 px, WebP quality 82.

**`hd`** — zoom rendering, long side capped at 4096 px, quality 88.
`withoutEnlargement` prevents upsampling: a 3000 px photo stays at 3000 px.

All three respond:

| Code | When                                                                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200  | `Content-Type: image/webp`, `Cache-Control: private, max-age=31536000, immutable`, `Vary: Cookie`, `ETag: "<mediaId>-<version>-<320\|640\|1280\|full\|hd>"` |
| 304  | `If-None-Match` matching the ETag                                                                                                                           |
| 404  | Media item absent from the index, or album forbidden                                                                                                        |
| 415  | `unsupported` — two cases, both specific to videos, detailed just below                                                                                     |
| 503  | Storage disconnected or revoked                                                                                                                             |

A video **does** have a thumbnail: the preview Drive produces of its first
second, served like any other WebP derivative and disk-cached the same way
([D92](./08-decisions/D92-a-video-preview-comes-from-drive-not-local-decoding.md)). Nothing is decoded locally.
The two refusals that remain:

| Refusal                            | Why                                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `full` or `hd` on a video          | Drive's preview is a few hundred pixels: enlarging it would only show a blurry image, served `immutable` for a year.                    |
| `thumb` on a video with no preview | `media.has_thumbnail` is 0 — Drive has no image to give. Knowing this avoids a call whose outcome is already known, on every grid load. |

The front end normally never hits this: `MediaItem.hasPreview` tells it in
advance whether there is an image to request.

**`original`** — the file as-is, relayed from Drive without passing through the
disk cache.

- `?download=1` adds `Content-Disposition: attachment; filename*=UTF-8''…`.
- The request's `Range` header is validated (`media/range.ts`) then forwarded
  to Drive; the Drive response's `Content-Length` and `Content-Range` are
  copied through unchanged. An invalid or multi-range `Range` is **ignored**
  and the whole file is served, in line with RFC 9110.
- `206` response if Drive responded 206, otherwise `200`. Always
  `Accept-Ranges: bytes` — without which the browser would refuse video
  seeking.
- **`416`** if Drive responded 416: the received `Content-Range` is copied
  through and the body is empty. An unsatisfiable range — offset past the end,
  common when switching videos while a request is in flight — belongs to the
  normal `Range` protocol; turning it into a server error would give a 500
  where the player expects a code it knows how to interpret.
- `502 bad_gateway` if the storage responds with no body; `404` if the media item
  is not indexed; `503` on a storage disconnected or revoked.
- **`503 storage_unavailable`, with `Retry-After`**, on a **transient** failure:
  download timeout exceeded, or throughput rate-limited by Google beyond the
  retries. Distinguished from a 500, which the browser treats as final: here
  the thumbnail must come back, and it does so on its own (D60). No cache
  header accompanies this response — a failure is never memorised.
- A `401` from Drive is never relayed: the access token is refreshed and the
  request retried once. If Google also refuses the refresh, the connection is
  marked revoked and the response is `503 storage_revoked`.
- Unlike the rendered variants, this route does not filter on `kind`: it serves
  a photo's original just as well as a video's stream.

**`playable`** — the H.264 version the server prepares for videos whose codec
no mainstream browser decodes
([D260809b](./08-decisions/D260809b-video-transcoding-rejected-by-d6-becomes-viable-with.md)). It comes
from the disk store, not from Drive: ranges are therefore resolved here rather
than relayed.

| Code | When                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ |
| 200  | `Content-Type: video/mp4`, `Accept-Ranges: bytes`, `Content-Length`, `Cache-Control: …immutable`, `Vary: Cookie`, ETag         |
| 206  | Valid `Range`: `Content-Range: bytes <start>-<end>/<size>`, bounded to the actual size                                         |
| 304  | `If-None-Match` matching `"<mediaId>-<version>-playable"`                                                                      |
| 404  | `not_ready` — the version is not (yet) prepared; `not_found` if the media item is absent from the index or the album forbidden |
| 416  | Range entirely past the end: `Content-Range: bytes */<size>`, empty body                                                       |

The **404 `not_ready` is the contract with the front end**, not an error:
preparation is anticipated and takes minutes, a video that arrived a quarter of
an hour ago does not have its own yet. The viewer displays it as "being
prepared", with the **Download** button from D79. Nothing triggers an
on-demand transcode — that would mean an HTTP request held open for ten
minutes, and as many concurrent ffmpeg processes as curious visitors.

The type is always `video/mp4`, regardless of the original container: that is
what ffmpeg has just produced. The content served is a derivative, so the ETag
carries the same version as the others — a new version of the Drive file
produces a new store key, hence a new derivative.

## Administration — `routes/admin.ts`

`requireAdmin` as a `preHandler` on the whole `/api/admin` prefix.

| Method | Path                                 | Response                                                                                                                                        |
| ------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/admin/status`                  | `200 AdminStatus`                                                                                                                               |
| GET    | `/api/admin/visits`                  | `200 VisitsOverview` · `400`                                                                                                                    |
| GET    | `/api/admin/users`                   | `200 AdminUser[]`                                                                                                                               |
| POST   | `/api/admin/users`                   | `201 AdminUser` · `400` · `400 unknown_album` · `409 conflict` · `409 identity_taken` · `429 too_soon` · `503 mail_not_configured`              |
| POST   | `/api/admin/users/:username/invite`  | `200 AdminUser` · `400` · `404` · `409 already_bound` · `409 no_invitation` · `409 identity_taken` · `429 too_soon` · `503 mail_not_configured` |
| PATCH  | `/api/admin/users/:username`         | `200 AdminUser` · `400` · `404` · `409 last_admin` · `409 password_on_bound_account`                                                            |
| DELETE | `/api/admin/users/:username`         | `200 { ok: true }` · `404` · `409 last_admin`                                                                                                   |
| GET    | `/api/admin/albums`                  | `200 AdminAlbum[]`                                                                                                                              |
| POST   | `/api/admin/albums`                  | `201 AdminAlbum` · `400` · `409 conflict`                                                                                                       |
| PATCH  | `/api/admin/albums/:id`              | `200 AdminAlbum` · `400` · `404`                                                                                                                |
| DELETE | `/api/admin/albums/:id`              | `200 { ok: true }` · `404`                                                                                                                      |
| PATCH  | `/api/admin/albums/:id/days/:day`    | `200 AlbumDay` · `400` · `404`                                                                                                                  |
| GET    | `/api/admin/settings`                | `200 AppSettings`                                                                                                                               |
| PATCH  | `/api/admin/settings`                | `200 AppSettings` · `400`                                                                                                                       |
| GET    | `/api/admin/storage`                 | `200 StorageConnectionStatus[]`                                                                                                                 |
| POST   | `/api/admin/storage`                 | `201 StorageConnectionStatus` · `400 unsupported_kind` · `409`                                                                                  |
| PATCH  | `/api/admin/storage/:id`             | `200 StorageConnectionStatus` · `400` · `404`                                                                                                   |
| DELETE | `/api/admin/storage/:id`             | `200 { ok: true }` · `404` · `409 storage_in_use`                                                                                               |
| POST   | `/api/admin/storage/:id/test`        | `200 StorageProbeResult` · `404`                                                                                                                |
| GET    | `/api/admin/storage/:id/oauth/start` | `200 { url }` · `400 oauth_not_configured` · `404` · `409`                                                                                      |
| POST   | `/api/admin/storage/:id/disconnect`  | `200 { ok: true }` · `404` · `409 service_account_mode`                                                                                         |
| POST   | `/api/admin/resync`                  | `202 { started: string[] }` · `400` · `404` · `503`                                                                                             |
| POST   | `/api/admin/cache/clear`             | `200 { ok: true }`                                                                                                                              |

**`status`** — `AdminStatus`: `storage` (every connection, see below),
`storageKinds` (the kinds this build can create), `storageLocalRoot` (the
directory a `local` connection may read inside, `null` when `STORAGE_LOCAL_ROOT`
is unset), `oauthConfigured`, `albums` (**all** declared albums, not just the
administrator's), `cache: { entryCount, bytes, maxBytes }`. The front end polls it again every 2 s
while an album is `syncStatus: 'running'`.

The four `drive*` fields of 1.1 are gone: an instance may read several storages,
and an album names which one (D260815g).

**`visits`** — `?days=` (default 30, integer from 1 to 365) bounds the window.
Renders a `VisitsOverview` = `{ days, since, visitors, albums }`, where `since`
is the first day counted (`YYYY-MM-DD` in UTC, the bound being inclusive).

| Field                     | Content                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `visitors[]: VisitorRow`  | Per access key: `admin`, `devices`, `lastAt`, `lastSeenAt`, `days`, `sessions`, `albums`, `visits`, `photos`                       |
| `albums[]: AlbumVisitRow` | Per album: `title` (`null` if deleted since), `visitors` (distinct sessions), `keys` (distinct keys), `visits`, `photos`, `lastAt` |

Three points worth reading:

- **A visitor is a session, not a key.** An access key can be shared (D38); two
  browsers behind the same one do count as two visitors. `keys` is therefore
  always less than or equal to `visitors`.
- **A key that signed in without opening anything still appears**, at zero:
  that is a real response, and hiding it would suggest there was no visitor at
  all. Its row then comes from `sessions.last_seen_at` alone, and `lastAt` is
  `null`.
- **The administrator's own visits are shown, not excluded.** Removing them
  would make the totals lie; the `admin` column is enough to read them for what
  they are (D260809h).

The counters come from `album_visits`, aggregated on write: the route only does
three bounded reads, with no scan (see [03](./03-data-model.md)).

### Storage connections

`StorageConnectionStatus` = `{ id, kind, label, account, connected, revokedAt,
authorization, settings, albumCount, createdAt }`. It never carries a secret,
under any key — the encrypted half is only ever written, never returned.

`settings` **is** returned, so that editing a connection shows what it reads
instead of asking for it again. That is safe by the same reasoning that stores it
in the clear: an endpoint, a bucket, a folder give access to nothing on their own
(D260816i).

`authorization` says which controls this connection has, and is what the front
end branches on instead of the kind:

| Value      | Meaning                                                                               |
| ---------- | ------------------------------------------------------------------------------------- |
| `consent`  | A button starts an OAuth flow and the backend hands back a token — Drive.             |
| `key`      | The environment already holds it: nothing to connect, only an address to share (D46). |
| `settings` | An endpoint and a secret typed into the form itself.                                  |

`POST` body: `CreateStorageRequest` = `{ id?, kind, label, settings?, secret? }`.
A kind outside `AdminStatus.storageKinds` responds `400 unsupported_kind`:
accepting it would create a connection nothing can serve from, discovered only
once an album on it stays empty.

**`id` is optional, and /admin never sends one**
([D260816h](./08-decisions/D260816h-a-storage-identifier-is-derived-from-its-name.md)).
Absent, it is derived from `label` with `slugifyAlbumId` — the same function the
album form previews an album identifier with — and suffixed until it is free:
`Archives` becomes `archives`, then `archives-2`, then `archives-3`. A label that
slugifies to nothing at all, `📷`, falls back to `storage`. Derivation never
answers `409`: nothing in the form could be corrected in reply to one.

Sent explicitly, it follows `ALBUM_ID_PATTERN`, is bounded by
`USERNAME_MAX_LENGTH`, and a taken one answers **`409 conflict`** — the caller
chose the value and is the only one who can choose another.

Either way the identifier is a **slug and never changes afterwards**: every album
that reads this storage names it, and `connection_id = 'archives-minio'` is what a
log line or a database dump has to be read from.

**`settings` and `secret` belong to the kind.** Both are opaque to the route,
which stores whatever it is given: a map of strings in the clear, and one string
encrypted with `TOKEN_KEY`. Only the secret is write-only; `settings` comes back
in `StorageConnectionStatus`. What each kind expects:

| Kind     | `settings`                                              | `secret`                                |
| -------- | ------------------------------------------------------- | --------------------------------------- |
| `drive`  | `scope`, written by the OAuth callback, not by the form | The refresh token, obtained by consent  |
| `local`  | `path`, the folder read under `STORAGE_LOCAL_ROOT`      | None — a folder name is not a secret    |
| `s3`     | `endpoint`, `region`, `bucket`, `prefix`, `pathStyle`   | `{"accessKeyId":…,"secretAccessKey":…}` |
| `webdav` | `url`, the endpoint; `root`, a folder beneath it        | `{"username":…,"password":…}`           |

`local`'s `path` is **relative to `STORAGE_LOCAL_ROOT`**, and empty means the root
itself. An absolute path, or one climbing out with `..`, is refused by the
provider: the route stores what it is given, and the fence belongs to whoever
declared the root (D260816d).

A connection stores exactly **one** encrypted string, so a backend needing two
values puts JSON in it. `pathStyle` is the string `"true"` when the bucket is
addressed as `host/bucket/key` rather than `bucket.host/key` — MinIO, and any
bucket whose name is not a valid domain label. `region` defaults to `us-east-1`
and `prefix` to the whole bucket.

A WebDAV `url` is the DAV endpoint rather than the page files are browsed on —
Nextcloud publishes its own as `/remote.php/dav/files/<username>` — and giving the
wrong one produces a `405` that `storage/:id/test` reports in those words.

An `s3` or `webdav` connection is created **complete**: there is no consent screen
to come back from, so the form sends its settings and its secret with the same
`POST`. One missing an endpoint or a bucket is still created rather than refused —
unlike an unsupported kind, it explains itself immediately, as a row reading "not
connected" whose Test button names what is absent.

`PATCH`: `UpdateStorageRequest` = `{ label?, settings?, secret? }`. Neither the
kind nor the identifier can be changed, and that is the point: an album names this
connection by identifier, and one that changed backend underneath would leave every
media addressed in a language the new one does not speak.

The secret has **three** answers and only two of them are a field: a value replaces
it, **absent** leaves it alone, and `secret: null` forgets it. /admin sends the
second whenever the credential fields were left empty, which is what makes editing
an endpoint possible without retyping a key (D260816i).

`DELETE` responds **`409 storage_in_use`** while an album reads it, naming the
albums to move first — the album would otherwise point at nothing, and every one of
its thumbnails would fail. /admin now names them in the confirmation itself and
refuses to send the request, so the 409 is the boundary rather than the way it is
discovered.

**`storage/:id/test`** — asks the backend itself and relays what it said:
`StorageProbeResult` = `{ ok, account, error }`, **always 200**. A connection that
does not work is the answer to the question, not a failure of the route, and the
`error` is the backend's own words — a wrong key, an unreachable host, a
withdrawn authorisation.

For a bucket the probe is one listing bounded to a single key, the cheapest call
that separates the three failures an administrator confuses: a key pair the
bucket refuses names the S3 `<Code>` it answered with, a host that is not there
names the host, and a bucket that does not exist names the bucket. **A probe
reports, it never revokes** — only an operation wrapped in `guard()` records that
a key pair has stopped being accepted, so testing a connection cannot disable the
one being corrected.

**`storage/:id/oauth/start`** — `400 oauth_not_configured` if `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` are missing, `409 service_account_mode` when the
environment already holds the credentials. Otherwise sets the signed
`lukarn_oauth_state` cookie — carrying `<connectionId>:<state>`, because Google's
callback URL is fixed in its console and cannot name the connection — and returns
the consent URL, which the front end follows as a full-page redirect.

**`storage/:id/disconnect`** — clears the stored secret and **keeps the
connection**: its albums name it by id. The index and cache remain; albums stay
browsable as long as thumbnails are cached.

**`resync`** — optional body `{ albumId }`. Without it, every album.
`503 storage_disconnected` if no storage is connected, `404 not_found` if the
supplied `albumId` does not exist. Responds **202** immediately: the
synchronisation runs as a background task, since it would exceed an HTTP
request's timeout on a large album. Progress is tracked through `status`.

**`cache/clear`** — deletes the cache directory and recreates it. Thumbnails
are regenerated on demand.

### Accounts

`POST` body: `CreateUserRequest`, which takes **exactly one** of a password and
an address. `{ username, password, admin?, albums? }` creates the shared key of
1.2, unchanged in every respect; `{ username, email, locale?, admin?, albums? }`
creates an account with no password and sends it an invitation. Supplying both, or neither,
is a `400`: the union in `packages/shared` says the same thing in the type system,
so a front end making that call fails to compile rather than at runtime. `PATCH`:
`UpdateUserRequest` = `{ password?, admin?, albums?, unbind? }`, an absent field
meaning "unchanged". The response is an `AdminUser` — **never a password hash,
under any key**.

**An address creates an invitation rather than an account somebody can enter**
(D260819). The account exists straight away with its role and its albums, and it
holds the reserved hash meaning "no password" until the recipient enters the code
sent to that address. The binding is written at that moment and never at
creation, because a verified address proves that somebody controls an inbox, not
that they accepted this account. No route under `/api/admin` points
`users.commenter_id` at an identity — unbinding clears it, and nothing else writes
it — which is what stops an administrator aiming an account at anyone who has ever
commented and signing as them. The address notified of new
comments is still the `moderationEmail` setting, and it binds nothing.

- `username`: `USERNAME_PATTERN`, 64 characters at most. `password`:
  `PASSWORD_MIN_LENGTH` (8) at minimum, 512 at most. `email`: a valid address,
  `EMAIL_MAX_LENGTH` at most.
- `locale`: the language the invitation is written in, one of the two the instance
  speaks. Anything else is a `400`, rather than the default quietly applied: this
  is a choice made on a form, and a message going out in a language its sender did
  not pick while the response reports success is worse than a refusal. Omitted,
  `DEFAULT_LOCALE` applies. The union in `packages/shared` puts it on the address
  branch alone, so a front end pairing it with a password fails to compile, and the
  route ignores it there since that branch sends no message (D260819c).
- `albums`: a list of ids, or `['*']` (`ALL_ALBUMS`) as a wildcard. An unknown
  id responds `400 unknown_album`, naming the culprit. A list mixing `'*'` with
  ids counts as a wildcard.
- `409 conflict` if the username is taken, **case included**.
- `409 identity_taken` **naming the account that already holds the address**, so
  the message says where to look. It fires against bound accounts only: one
  invitation exists per address at a time, so a second one replaces the first and
  the account it named loses it, which the account list shows. An invitation
  expiring unclaimed frees its address, the right outcome for a message nobody
  read.
- `503 mail_not_configured` when the instance has no relay. An account created by
  address would otherwise sit in the list with no password and no way to acquire
  one.
- `429 too_soon` with `Retry-After` when a code went to that address within the
  minute, on every purpose. The account is not created either: it lands in the
  same transaction as its invitation, or an address typed one minute too early
  leaves an account nobody invited and nobody can enter.
- `409 last_admin` on deleting the last administrator or removing their role. The
  count is of administrators who **can sign in**, not of rows: an admin account
  whose invitation is still pending has neither password nor binding, and
  counting it would let the only working administrator demote or delete
  themselves. The refusal also guards on the target: removing a pending
  administrator while the working one remains is allowed.
- `409 password_on_bound_account` on setting a password while the account is
  bound, named after the account. `{ unbind: true, password }` is the single
  exception and the only way a bound account is given a password: in one act it
  clears the binding, writes the password and closes the sessions. `unbind`
  without a password is a `400` — it would leave an account with no identity and
  a hash nobody can enter, the administrator included.
- Deleting an account and changing its password close its sessions; changing
  its role or albums does not (see [04](./04-security-and-access.md)). Unbinding
  and consuming an invitation close them too, and delete the account's approved
  pairings with them.

**`POST /api/admin/users/:username/invite`** — body `InviteUserRequest` =
`{ email?, locale? }`. Converts an account that already exists, and sends an invitation
again. With an address it invites that account; without one it mints a fresh code
for the invitation already pending, which is what somebody presses when the first
message went unread. `409 no_invitation` when there is neither: an expired
invitation left no row, so nothing here still knows where it was sent and the
address has to be given again.

**A resend takes its language from the invitation rather than from the request.**
Without a `locale`, the message repeats the one the pending row was minted with, so
a second copy of an unread message never reaches the inbox in another language than
the first. A `locale` in the request overrides it, which is the sender changing
their mind. With neither, `DEFAULT_LOCALE` applies exactly as on the first send.
`POST /api/auth/code/request` follows the same rule when the address it is given has
an invitation waiting: that is the recipient asking for the message again, and the
row already holds the language they were written to in (D260819c).

It answers `409 already_bound` on an account that is already bound. Changing
somebody's address is out of scope for this release, and it is the shape of the
impersonation this design exists to prevent. The other refusals are the ones
above: `404` for an unknown account, `409 identity_taken`, `429 too_soon`,
`503 mail_not_configured`.

The account keeps its password throughout. An invitation to convert that nobody
takes up leaves a working shared key exactly as it was, and the conversion happens
when the code is consumed: the account is bound, its password is replaced by the
reserved hash, its sessions close and its approved pairings go with them.

**`AdminUser`** carries what the account list reads: `identity`
(`{ email, displayName }`, the person a bound account is, `null` otherwise),
`invitation` (`{ email, expiresAt }`, the one still open, `null` when none is),
and `state`, which is one of four.

| `state`      | What the account is                                                                   |
| ------------ | ------------------------------------------------------------------------------------- |
| `shared_key` | A password somebody knows, shareable by a household as before.                        |
| `person`     | Bound to a verified identity: one person, on every device they sign in from.          |
| `invited`    | Created by address, its invitation open until `invitation.expiresAt`.                 |
| `no_way_in`  | Created by address and never taken up: the invitation expired and no password exists. |

`state` says how the account is entered **today**, and `invitation` says what is
in flight on it. The two disagree on purpose for a conversion: an account that
still has its password reads `shared_key` while an invitation waits on it, since
the key still works. An expired invitation is already absent from `invitation`,
which is what turns an account created by address into one with no way in. Such an
account still holds the album grants somebody set on purpose, and nothing that
could exercise them.

The reserved hash never leaves the server. "No way in" is a conclusion the server
draws, and the account list reads a state rather than comparing a hash of its own.

### Albums

`POST`: `CreateAlbumRequest` = `{ id, title, description?, connectionId?,
folderId, recursive?, groupBy?, sortOrder? }` (`recursive` defaults to `true`,
`groupBy` defaults to `month`, `sortOrder` defaults to `asc`, and `connectionId`
to the instance's first connection). `PATCH`: `UpdateAlbumRequest`, where
`description: null` clears the description. `409 conflict` on an id already
taken, `400 unknown_storage` on a `connectionId` naming no connection.

**`folderId` may be empty on every kind addressed by a path** — `local`, `s3`,
`webdav` — where it means the whole of what the connection declares: its bucket,
its folder, its DAV root ([D260816j](./08-decisions/D260816j-an-album-container-is-optional-except-on-drive.md)).
A bucket holding one gallery is the common case, and every one of those backends
already resolved an empty reference to its own root. On **Drive** it is refused
with `400 bad_request`: a Drive reference is an opaque identifier rather than a
path, so there is no empty one, and the nearest equivalent would be the entire
Drive on a read-only scope covering all of it. The check runs where the connection
is resolved, since the schema alone cannot know the kind.

`groupBy` is the split applied when the album is opened, `sortOrder` its
reading direction — two preferences, which `?group=` and `?order=` override.
Changing them does **not** touch the index: unlike `folderId` and `recursive`,
they do not change the Drive scope.

`AdminAlbum` completes the configuration with the actual state: `itemCount`,
`lastSyncAt`, `syncStatus`, `syncError`, `coverId`, and `members` — the accounts
with **explicit** access, wildcard holders not appearing in it.

`UpdateAlbumRequest`'s `coverId` names the cover photo; `null` restores the
automatic choice. The photo must be indexed **in this album** and must not be a
video, otherwise `400 unknown_cover`. A video does have a thumbnail since D92 —
but it belongs to Drive and can be missing on a re-encoded file, and the cover
is the only image whose absence shows from the home page, with no fallback
(D80 only covers a photo that has left the index). Two identically named fields
not to be confused — `AdminAlbum.coverId` is the **choice** (`null` = automatic),
`Album.coverId` the cover **actually served**, which falls back to the most
recent photo when the chosen one has left the index without the choice being
cleared (D80).

Two deliberate side effects:

- **Changing `folderId`, `recursive` or `connectionId` empties the album's
  index** and resets its sync state to `never`; a resynchronisation starts in the
  background if that album's storage is connected. The indexed media items named
  the old scope: leaving them in place would keep them browsable until the next
  sync. `connectionId` belongs in that list for the same reason — the same path
  on another storage is another set of files, and the identifiers of the old one
  address nothing there.
- **Deleting an album removes its media items from the index.** A file present
  in another album keeps its row there (primary key `(album_id, id)`). Cached
  disk derivatives are left alone: they are indexed by file id, so shared
  across albums, and regenerable — `cache/clear` sweeps them all away.

### An album's days

`PATCH /api/admin/albums/:id/days/:day` — body `UpdateAlbumDayRequest` =
`{ description?, place? }`. Absent field = unchanged, `null` **or an empty
string** = cleared (both are folded into the same `NULL`, like
`moderationEmail`, so the front end does not have to translate a cleared
field). Bounds: 300 characters for the description, 120 for the place. `:day`
must be `YYYY-MM-DD`, otherwise `400`. `404` if the album is unknown. The
response is the updated `AlbumDay`.

**The input lives in the album, the mutation stays here.** A day is described
while looking at its photos, so the pencil is in the grid; but the write goes
through `/api/admin`, the only prefix that responds **403**. Everywhere else an
access refusal responds 404, and this route does not move that invariant (D50).

The **cover** follows the same rule, and for the same reason: a photo is chosen
while looking at it, so the action is in the viewer; the write goes through
`PATCH /api/admin/albums/:id`, with the `coverId` field. Reverting to automatic
(`coverId: null`), though, is a button in `/admin`: it is the only place that
knows how to distinguish a chosen cover from a default one.

The **album description** follows exactly the same rule: its pencil lives on
the album page, its write goes through `PATCH /api/admin/albums/:id`, with the
`description` field of `UpdateAlbumRequest`. Its bound is
`ALBUM_DESCRIPTION_MAX_LENGTH` (2000), exported by `@lukarn/shared` rather than
written as a literal in the Zod schema: the front end's character counter now
reads it, and two diverging limits would make an input accepted on screen get
refused by the server.

The row is created if the day did not have one: a day with no photo carrying a
position can still be annotated. A day emptied of both its note **and** its
place disappears from `GET /days` if EXIF gives it none.

### A photo's description

`PATCH /api/admin/albums/:id/items/:mediaId` — body `UpdateMediaRequest` =
`{ description? }`. Absent field = unchanged (the response then returns the
item as-is), `null` **or an empty string** = cleared — the `media_notes` row is
deleted, an empty description saying no more than a missing one. Bound:
`MEDIA_DESCRIPTION_MAX_LENGTH` (1000), exported by `@lukarn/shared` and applied
on both sides, otherwise `400`. The response is the updated `MediaItem`.

Two distinct `404`s, and both are needed: an unknown or deleted album, and a
media item not indexed **in this album**. Without the second, text could be
written that nothing will ever display, against a possibly made-up id.

Same split as the two neighbouring texts: **the input is in the gallery** — a
photo is described while looking at it, with its neighbours around it —, **the
mutation is under `/api/admin`**, the only prefix that responds 403 (D50, D83).
Videos are accepted, unlike for `coverId`: a video deserves a caption, and
nothing in the pipeline opposes it.

### Comment moderation

| Method | Path                                      | Response               |
| ------ | ----------------------------------------- | ---------------------- |
| GET    | `/api/admin/comments`                     | `AdminCommentsPage`    |
| POST   | `/api/admin/comments/:id/hide`            | `{ ok: true }`         |
| POST   | `/api/admin/comments/:id/show`            | `{ ok: true }`         |
| POST   | `/api/admin/commenters/:commenterId/hide` | `BulkModerationResult` |
| POST   | `/api/admin/commenters/:commenterId/show` | `BulkModerationResult` |

`GET` parameters:

| Parameter | Values                                    | Default |
| --------- | ----------------------------------------- | ------- |
| `filter`  | `all`, `visible`, `hidden`                | `all`   |
| `albumId` | an album id                               | all     |
| `q`       | 1 to 200 characters, trimmed at the edges | —       |
| `limit`   | 1 to 200                                  | 50      |
| `cursor`  | positive integer                          | —       |

The cursor is a **plain integer**, the id of the last comment rendered:
`AUTOINCREMENT` guarantees that id order is write order, which avoids the
composite cursor media pagination needs.

`q` is searched in the body, the declared name, **and** the address — this
searches both a word that was reported to us and the person who wrote it.
`LIKE` wildcards are escaped: typing `%` searches for a percent sign, it does
not return the whole corpus. Case is folded only over ASCII, a `LIKE`
limitation in SQLite (D67).

`AdminCommentsPage` = `{ comments, nextCursor, total }`. **`total` ignores the
cursor**: it is the size of the corpus the filter retains, not what remains to
be paged through — otherwise "3 of 6" would become "3 of 4" while turning the
page.

`AdminComment` adds to `Comment` what is needed to know which photo is being
discussed and who is writing — `albumId`, `albumTitle`, `mediaId`, `mediaName`,
`authorEmail`, `commenterId`, `account`, `hiddenAt`, `hiddenBy`. `authorEmail`
and `commenterId` appear **only here**: moderation needs to know who is behind a
declared name, and to be able to target all of their messages; the public
thread has neither to reveal.
`account` is the access key used to write, which says which shared password to
change.
`mediaName` is `null` if the media item has since left the index: the comment
remains moderable, only the link to the photo is no longer rendered.

The queue covers **every album**, including ones this administrator would not
see in the gallery: moderating requires reading everything, and restricting the
queue to the reading scope would leave comments no one could act on.

**`hide` / `show`** — hiding rather than deleting: the decision stays
reversible. Hiding twice is not an error and does not rewrite `hiddenAt`, which
must keep the date of the original decision. Permanent deletion goes through
`DELETE /api/comments/:commentId`, where the administrator has full rights.

**`/commenters/:commenterId/hide|show`** — the same decision, on **all of an
identity's messages at once**, across every album. The move for after an access
key that has circulated too widely: removing fifteen messages one by one is
work no one does. `BulkModerationResult` = `{ affected }`, the number of
messages actually touched — already-hidden ones are not counted, for the same
reason as at the single-comment level. An unknown identity responds **404**,
not `{affected: 0}`, which would be indistinguishable from an identity with no
messages.

`AdminStatus` carries `hiddenComments` (the queue's badge),
`mailConfigured` — with no SMTP, entering an address produces nothing, and the
administration screen must say so rather than let notifications be expected —
and `logoCustom`, which says whether an operator has uploaded a logo. That last
one is reported rather than inferred from the image: the built-in mark and an
upload are served at the same URL, so nothing in the picture says which it is,
and "back to the built-in mark" must only be offered when there is something to
go back from.

### Settings

`AppSettings` = `{ instanceName, primaryColor, syncIntervalMinutes,
syncOnStartup, cacheMaxSizeGB, prewarmCache, transcodeVideos,
videoCacheMaxSizeGB, moderationEmail }`. `PATCH` accepts a subset
(`UpdateSettingsRequest`) and returns the full state. Bounds: `instanceName`
non-empty after trimming and at most `INSTANCE_NAME_MAX_LENGTH` (64) characters,
`primaryColor` matching `#rrggbb`, `syncIntervalMinutes` integer from 0 to 10080,
`cacheMaxSizeGB` > 0,
`prewarmCache` boolean (default `true`, re-read on every photo by the
prewarming — unchecking it stops the current pass, not just the next one),
`transcodeVideos` boolean (default `true`, re-read the same way on every
video), `videoCacheMaxSizeGB` > 0 (default 5).
`moderationEmail` accepts a valid address, `null`, or an empty string — the
latter two meaning "no alert", `ConfigRepo` folding them into the same `NULL`.

`videoCacheMaxSizeGB` is a budget **separate** from `cacheMaxSizeGB`, not a
share of it: the two derivatives do not cost the same to rebuild — a few
seconds for a thumbnail, several minutes of processor time for a video. A
shared LRU would let browsing the grid evict hours of work (D260809b).

**Settings apply without a restart**: the two `MediaCache` limits are adjusted
straight away (with eviction if they are lowered), `main.ts`'s synchronisation
timer is rescheduled, the generated icons are discarded — the mark's dot carries
the primary colour — and the cached shell and manifest are dropped so the next
navigation carries the new name and palette. That was the limit of the earlier
configuration reload, which only re-read these values at startup.

## Branding — `routes/branding.ts`

The instance's logo and the icons derived from it. Everything here is stored by
`BrandingStore` under `DATA_DIR/branding/` and drawn by `branding/mark.ts` when
no upload is in force (D260813b).

| Method | Path                        | Access | Response                                              |
| ------ | --------------------------- | ------ | ----------------------------------------------------- |
| GET    | `/api/branding/logo`        | public | `image/svg+xml` (the mark) or `image/png` (an upload) |
| GET    | `/api/branding/icon-<name>` | public | `image/png`                                           |
| PUT    | `/api/admin/branding/logo`  | admin  | `{ custom: true }`                                    |
| DELETE | `/api/admin/branding/logo`  | admin  | `{ custom: false }`                                   |

**The two `GET` routes are public**, the only routes reading instance state that
are. The sign-in screen carries the mark, the tab icon is requested before any
session exists, and a home screen fetches manifest icons without cookies. Neither
reveals more than the name already printed in the page title.

`<name>` is one of `192.png`, `512.png`, `maskable-512.png` and `apple-180.png`,
declared once in `ICON_VARIANTS` (`packages/shared`) because the server answers
these URLs and `manifest.webmanifest` names three of them. Anything else is a 404. The maskable variant is inset to 62 % on `--color-ink-900`: Android crops a
maskable icon to a circle, and a full-bleed rounded square would lose the dot
that makes the mark recognisable. `apple-180.png` is flattened onto the mark's
own black, because iOS composites a home-screen icon on black and transparent
corners would come out a colour nobody chose.

Both carry an `ETag` and `Cache-Control: public, no-cache` — stable URLs over
changing content, the opposite of a media derivative, which carries a content
fingerprint and is `immutable`. The browser therefore revalidates, and the usual
answer is a 304 with no body.

`PUT` takes the **raw image bytes** as its body, not a multipart envelope: one
field needs no parser. Its `bodyLimit` is 512 KB (`LOGO_MAX_BYTES`) on that route
alone — everywhere else keeps the 64 KB set in `app.ts` — and it is the only
route with a permissive content-type parser, which is why it lives in its own
plugin rather than inside `routes/admin.ts`. **The declared type is not
trusted**: `BrandingStore.replace` decides what the bytes are by decoding them
and re-encoding a PNG (D260813b). An image sharp cannot read is a **400**, not a
500 — the instance is fine, the file is not.

`DELETE` returns to the built-in mark and is idempotent: removing nothing is
still a success.

## OAuth callback — `routes/admin.ts`

| Method | Path                  | Access |
| ------ | --------------------- | ------ |
| GET    | `/api/oauth/callback` | admin  |

Mounted outside the `/admin` prefix because its URL is fixed in the Google
Cloud console, but protected by the same `requireAdmin`. Parameters `code`,
`state`, `error` set by Google.

Never returns JSON: always redirects to `/admin/storage?oauth=<reason>`
— the section carrying the connect button (D66, D260816g).

| `oauth=`         | Cause                                                                    |
| ---------------- | ------------------------------------------------------------------------ |
| `connected`      | Success. The albums **on that connection** synchronise.                  |
| `denied`         | Google returned `error` (consent refused).                               |
| `invalid`        | Missing `code` or `state`, or a cookie naming a connection that is gone. |
| `state_mismatch` | The anti-CSRF cookie does not match.                                     |
| `error`          | The code exchange failed (detail in the logs).                           |

The cookie carries `<connectionId>:<state>`: with several Drive connections, the
returned token would otherwise land on whichever one the server guessed.

## Non-API routes

Served by `registerFrontend` (`app.ts`) when `WEB_DIR/index.html` exists.

| Path                    | Behaviour                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `/`                     | `index.html`, `Cache-Control: no-cache`                                                                            |
| `/manifest.webmanifest` | The manifest, `application/manifest+json`, `Cache-Control: no-cache`                                               |
| `/sw.js`                | Actual file from `public/`. Outside `/assets/`, hence `Cache-Control: no-cache` — intended for the service worker. |
| `/assets/*`             | Actual file, `Cache-Control: public, max-age=31536000, immutable`. Missing ⇒ **404 JSON**, never `index.html`.     |
| `/api/*`                | Unknown ⇒ `404 { error: 'not_found', message: 'Route inconnue' }`                                                  |
| everything else         | `index.html` — routing lives in the front end, a reload on `/album/x` must work                                    |

**`/` and `/manifest.webmanifest` are not served from disk**: both carry the
instance name, and the shell carries its palette as well, substituted by
`shell.ts` (see [07](./07-frontend.md)). Both are **rendered on first request and
cached until settings change**, not once at startup: the name and the colour are
settings now, and a rename must reach the tab without a restart (D260813c). The
cache is dropped by the `SettingsListener` `context.ts` defines. These are exact
routes, so they take precedence over `@fastify/static`'s generic route, which
would otherwise serve the raw files. A manifest missing from the build is only a
warning at startup; present but unreadable, it stops startup.

**There are no icon files under `public/`.** The manifest's `icons` and the
`apple-touch-icon` link point at `/api/branding/icon-*.png`, and the tab icon at
`/api/branding/logo`: one path generates them from whichever logo is in force,
in whichever colour.

**A consequence worth knowing: rebuilding the front end under a running server
is not enough.** It keeps serving the previous `index.html`, which references
bundles the build has just removed — the page loads and stays blank. It must be
restarted. In production this does not apply (an image is built, then run) and
neither does it in development (Vite serves the front end itself); the case
occurs exactly when running a built server while rebuilding alongside it.

With no front-end build, every non-`/api` route responds with a 404 JSON
prompting `pnpm dev` or `pnpm build`. `packages/server/test/static.test.ts`
locks down each of these behaviours.
