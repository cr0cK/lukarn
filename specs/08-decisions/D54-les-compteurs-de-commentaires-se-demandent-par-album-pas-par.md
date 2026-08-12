# D54 — Comment counts are requested per album, not per photo

**Context.** The viewer must indicate that a photo has a conversation **before**
anything is opened — that is the only point when the information is useful. But
`MediaDetail.commentCount` is only loaded when the panel opens, specifically to
avoid one request per viewed photo.

**Choice.** `GET /api/comments/:albumId` returns
`{ counts: Record<mediaId, number> }` for the entire album, using one
`GROUP BY media_id` query on `idx_comments_thread`. Photos without comments are
omitted: in an album with thousands of views where around ten have a conversation,
the response is a few hundred bytes. `MediaDetail.commentCount` remains for the
open panel tab.

**Rejected.** _Adding `commentCount` to `MediaItem`_, and therefore to every grid
page. `MediaRepo` deliberately ignores the existence of comments — otherwise,
every media request gains another join — and introducing it there would impose
that cost on all calls, including those that do not display a badge. _Loading the
details of every reached photo_: moving through an album with the arrow key would
trigger one request per photo passed, for a number that arrives after the fact.

**Consequences.** The badge may lag behind a conversation opened elsewhere, and
this lag **is not bounded by the 30 s `staleTime`** — this must be stated because
the opposite follows naturally from the setting. `refetchOnWindowFocus` is
globally `false`, `useCommentCounts` sets no `refetchInterval`, and the hook is
only called from the viewer: while it stays open, no request is sent again. The
`staleTime` therefore only affects `refetchOnMount` when the viewer is
**reopened**, which is what actually bounds the lag. Publishing from the panel
immediately invalidates the counts. An album where almost every photo was
commented on would return a response proportional to the number of photos; that
is not the target use case, and if it becomes one, pagination will arise just as
it already does for media.
