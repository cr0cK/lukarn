# D55 — The read marker lives in the browser, not the database

**Context.** Displaying "3 new comments" requires knowing where the reader had
reached. A server-side table would be the instinctive answer.

**Choice.** `localStorage`, under `lukarn:comments-seen:<albumId>`, storing a
**number of comments seen** per photo. The total comes from the server, and the
difference is calculated for display (`unreadCount`).

Two reasons, in this order. First, an access key is not a person (D38): indexing
a read marker by account would mean that within a household, the first person to
open a photo would clear the badge for everyone else — the exact opposite of what
the feature promises. The browser does correspond to one person. Second, an
integer is enough where a date would require the server to carry every thread's
timestamp so it could be compared.

**Rejected.** _A `comment_reads(account, album_id, media_id, seen_at)` table_: a
migration, a write whenever a panel opens, a join in the counts, and the partition
failure above. _A marker per commenter identity_ instead of per account: it would
have the right granularity, but most readers have never verified an address — the
badge would only work for those who write.

**Consequences.** Changing device, clearing the browser, or private browsing
starts from zero: one's own comments appear unread **once**, never the reverse.
This is the acceptable direction of error — the badge may be noisy, but it must
not be silent. Storage is bounded by the number of commented photos in the album,
not the number viewed, and a photo whose comment count falls back to zero leaves
the table.
