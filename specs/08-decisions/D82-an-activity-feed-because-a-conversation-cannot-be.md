# D82 — An activity feed, because a conversation cannot be discovered otherwise

**Confidence.** observed — lib/commentGroups.ts, git ls-files → exit 0 · 2026-08-23

**Context.** Comments were invisible until the photo carrying them was opened.
The viewer badge is only seen once the photo is reached, and in an album with
thousands of views but ten messages, nobody encounters it. A discussion could
therefore begin and end without any intended reader seeing it — a message with no
reader is a lost message, the opposite of what comments beneath family photos are
meant to achieve.

Administration already had its global view, the moderation queue. It was no help
here: it responds with 403 outside `/api/admin`, shows authors' email addresses,
and exists to sort what gets removed — not to read what is written.

**Choice.** A `GET /api/comments/feed` route and a drawer opened from the top bar
on both gallery pages.

**Scope comes from `albumsFor()`, never from the request.** This is the first
route to return messages from different albums in one response: a scope error
does not produce an empty page but a leak, and nothing in the display would reveal
it — a conversation from an unavailable album reads like any other. `?album=`
only narrows; an unseen album responds with 404 as everywhere else (D12). A
session with no album returns an empty page, covered by the first test because a
forgotten `IN ()` could turn this case into the entire corpus.

**No index, no migration.** `ORDER BY c.id DESC` follows primary-key order:
SQLite scans the table backwards and stops at `LIMIT`. An `(album_id, id DESC)`
index would do no better because SQLite cannot merge the order of several slices
of an `IN`. The adverse case is accepted, continuing D67: an account seeing only
one album out of fifty scans comments from the other forty-nine before filling
its page. The corpus remains bounded by what humans write.

**The `?panel=comments` parameter is the useful half of the entry.** The side
panel tab was local `Lightbox` state: a link to `?photo=` opened the image with
messages closed. The drawer would therefore lead to the photo but not the
conversation — nowhere. The tab now lives in the URL, like `photo`, `order`, and
`group`, which also benefits notification emails — a message announced by email
previously led to a silent image.

**The badge counts identifiers, not messages.** The feed read marker,
`lukarn:comments-feed-seen`, is the greatest id seen. The feed is paginated and has
no total: counting what was read would require traversing it completely, whereas
`AUTOINCREMENT` makes the id an exact milestone. The marker remains in the browser
for D55's reason — an access key is shared by an entire household, so a
server-side table would let the first reader clear everyone else's badge.

**Rejected: another email notification.** The instance already sends messages
for replies and album updates (D39, D41). A third reason to write would make the
mailbox pay for what the interface lacked, and would collide with identities not
being linked to albums — there is no known recipient for a message that replies
to nobody.

**Rejected: an `/activity` page.** Another route, and above all leaving the grid
to visit it. The drawer leaves the gallery behind it: close it and the same place
remains.

**Rejected: an icon per day or month in section headers.** Filtering a
`taken_at` range would require joining `media` — messages for disappeared photos
would leave the result — plus another button in a header whose heights are all
declared to the pixel. The "all albums / this album" toggle covers the actual
need: knowing where people are talking.

**Consequences.** One extra request when each gallery page loads, comparable to
the album-count request. Publishing a comment invalidates both feed scopes and
therefore reloads pages already browsed in the drawer — which is almost always
closed while writing.

`lib/moderation.ts` becomes `lib/commentGroups.ts`, and its grouping by day then
photo becomes generic: the moderation queue and drawer ask the same question and
need not answer it twice. The drawer deliberately differs in one respect:
messages in a block read oldest to newest because this is a conversation, not a
work queue.

Finally, an album whose Drive identifier is `feed` would never get its counts,
because Fastify's literal-segment precedence applies here as it does for
`unsubscribe`. Same tradeoff: the general route takes precedence over an
identifier its creator can rename.
