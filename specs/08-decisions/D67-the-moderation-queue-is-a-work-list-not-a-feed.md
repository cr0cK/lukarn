# D67 — The moderation queue is a work list, not a feed

**Context.** The queue rendered fifty reverse-chronological rows, a "Load more"
button that stacked them, and two filters — all or hidden. Three defects, all
measurable:

- every hide action invalidated the queue, and TanStack Query reloads **all**
  pages of an infinite query: after four "Load more" actions, one click on
  "Hide" requested two hundred rows again;
- nothing indicated whether the displayed rows were the entire corpus or one
  hundredth of it;
- it was impossible to search, restrict to one album, or only see what remained
  visible.

A moderation queue is not browsed; it is opened with an intention: a message
someone mentioned, what was said yesterday, or everything written by one address.

**Choice.** One page at a time, twenty-five rows, with `‹ Previous` and `Next ›`
— a client-side cursor stack records the path taken, the only way to go backwards
with cursor pagination. The response carries `total`, counted **without the
cursor**: it is the size of the filtered corpus, not of the remainder. Three
partitioning filters (`all`, `visible`, `hidden`), an album filter, and a search
over the body, declared name, and address. The displayed page is grouped by day
and then photo on the client. Finally, an identity-wide bulk action hides all
messages from one address at once.

The grouping day is the **reader's**, not UTC — the repository's third exception
to the rule, for the reason already stated in D31 and `format.ts`: `created_at`
is a real instant, not a device wall-clock time.

**Rejected.** Keeping infinite scrolling and only adding the total: the missing
count was only one of the three defects, and the most visible — the complete
reload after every action would remain. Also rejected: numbered pages using
`OFFSET`; they provide direct access to page 5, but their numbering shifts as
soon as a comment arrives during moderation, and the repository already rejected
`OFFSET` for media (see cursor pagination in
[03](../03-data-model.md)). Finally rejected: an FTS5 table using
`unicode61` for search — a virtual table and synchronisation triggers to maintain
for a corpus of a few thousand rows, while an escaped `LIKE` answers in
microseconds.

**Consequences.** Grouping only applies to the received page: a photo whose
comments cross a page boundary appears on both sides. Doing otherwise would
require a server that paginates whole groups, producing pages of unknown size.
Case folding only covers ASCII — searching for "Éric" does not find "éric", a
limitation of `LIKE` in SQLite and one the FTS table would have fixed. **No index
was added**: a `LIKE '%…%'` search is a scan no index can serve, and the corpus is
bounded by what humans write; revisit beyond ten thousand comments, where the
`COUNT(*)` on every page would have a cost. The bulk action does not ban anyone:
it removes messages, while the identity can still write. Closing the door remains
the access key's job, which the queue displays beside each message.
