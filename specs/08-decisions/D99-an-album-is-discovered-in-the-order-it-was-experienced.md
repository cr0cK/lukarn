# D99 — An album is discovered in the order it was experienced

**Context.** Reading order was a global constant — `desc`, newest first — and
lived **only** in the URL. Two separate defects, the first already solved for
grouping (`albums.group_by`, migration 7):

- opening a trip showed its last day before its first, the return before departure;
- a changed direction was lost on leaving the page. The same action had to be
  repeated on every visit to the same album.

These are different problems requiring different answers. The first belongs to
the album: "Corse, July 2026" is told from first day to last, while "The
children" is read from the latest photos. The second belongs to the reader:
whatever the album setting, someone preferring the other order should only say
so once.

**Choice.** A default **per album**, in the database and configurable in /admin
(`albums.sort_order`, migration 12, default `asc`), and memory **per album in the
browser** (`lukarn:album-order:<albumId>`). Priority: **URL > browser > album**:

- URL first because it is an exact view — shared or received by email — and the
  recipient's habit must not contradict it;
- browser next because that is where one person's preference lives. The access
  key is unsuitable: an entire household shares it (D38), and one person's order
  would be imposed on others — the same reasoning as comment read markers (D55);
- album last, as the starting point for someone who has never opened it.

Toggling order **always** writes to the browser and only writes the URL when the
order contradicts the album — the existing rule for `?group=`, which restores
the album's original address when returning to its preference.

The update email points to `?order=desc`: the message announces what just
arrived, so its link must lead there. The parameter only applies to that visit
and does not overwrite browser memory.

**Rejected.** _Subscription as a criterion_ — "subscribed ⇒ newest first" seemed
to distinguish an album being discovered from one being followed. It does not:
subscription is automatic on first opening (D41), so it is true in both cases.
The actual discriminating signal is "this browser has opened this album", meaning
local memory itself.

_The global constant alone_, changed from `desc` to `asc`: this would fix discovery
of a trip while breaking a current album fed over time, and leave the second
defect untouched — restating the preference on every visit.

_`localStorage` taking priority over the URL_: a shared link would stop opening
the sender's view, and an announcement link using `desc` would have no effect for
someone who had already read the album forwards.

_Making `order` optional in the API_ to avoid the cascade: the route would have
to read album preference, hence config, for a sort it already performs. The
frontend resolves order because it knows all three sources; the route only knows
what it receives.

**Consequences.** Existing albums **change direction** on upgrade: the migration
sets all to `asc`. This is accepted — nobody chose `desc`; it was the only
possible value. The owner toggles albums individually in /admin, and each visitor
does so for themselves in the grid.

A shared link without `?order=` may read backwards for its recipient if their
browser remembers the opposite order for that album. This is the price of memory;
sharing the exact view requires toggling direction before copying the address,
which the button already does.

Finally, the grid **waits** until order is known before loading the first page:
without this guard, discovering an album would load two hundred items in one
direction and discard them when the next response arrived.
