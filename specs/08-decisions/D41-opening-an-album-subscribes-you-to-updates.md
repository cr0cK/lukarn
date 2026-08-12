# D41 — Opening an album subscribes you to updates

**Context.** Nobody spontaneously returns to a self-hosted gallery: the comments
delivered with D38 remain empty until someone learns that there is something new.
The difficulty is that **nothing links a person to an album**: access comes from
the access key (`users`), the verified address identity (`commenters`), and the
two never intersect. There is therefore no native way to know whom to write to.

**Choice.** Opening an album subscribes the visitor to its updates, on the first
page of `GET /api/albums/:albumId/items`, for **already verified** identities.
Opening an album is a much better signal of interest than a checkbox, and the
people concerned provided their address knowingly (D39). The subscription is a
**state** (`auto` / `opted_out`), not simply the presence of a row: otherwise,
reopening the album the day after unsubscribing would resubscribe them.

The announcement is connected to the hourly housekeeping in `main.ts`
(`notifier.ts`) and only concerns albums whose last successful synchronisation
has been quiet for an hour. What is new is counted using `media.added_at`, written
on INSERT and never by `upsertMany`'s `ON CONFLICT DO UPDATE`;
`sync_state.notified_at` records what has already been announced.

**Rejected.** Explicit opt-in — a "notify me" checkbox that nobody ticks in a
family gallery visited three times a year. Also rejected: the daily digest, which
breaks the link between "we just got back from holiday" and "there are photos",
whereas the reactive cadence preserves it. Also rejected: announcing at the end
of each synchronisation — with a sync every half hour writing batches of 500,
adding two hundred photos would send around ten emails during the day. Finally
rejected: counting updates using `seen_at`, which is rewritten on _all_ media on
every pass and would therefore count the entire album as new every half hour —
this is the trap in this feature, and a test locks it down.

**Consequences.** Default subscription is acceptable only under two conditions,
both met: it is **announced** where the person provides their address (the
identity form, see [07](../07-frontend.md)), and it can be undone **in one click**,
per album. The link therefore carries a token for the address + album pair;
otherwise, it could be replayed from one album to another.

`commenters.notify` remains the global switch: it disables replies to comments
**and** announcements. The reverse is not true — unsubscribing from a busy album
does not prevent replies to one's own messages, which are more valuable. An album
that nobody has opened still advances its boundary: otherwise, its first
subscriber would receive "3,000 new photos" as their first email for photos that
arrived before they subscribed. Finally, the notifier's first run on an existing
database — or on an instance that has just configured SMTP — **sets the boundary
without sending**: announcing here would announce the gallery's entire history
at once.
