# D260809h — Telemetry is measured in the database and aggregated on write

**Context.** The running instance said nothing about its use.
`sessions.created_at` was the only existing trace, and it answers only "someone
logged in once" — not "do I have visitors this week?", nor "who opens which
album?", which is the question being asked. Comments were the only available
sign of activity, and they vastly undercount reading: people view an album
without commenting.

**Decision.** Measurement happens **on the server, in the database**, in a table
aggregated on write: one row per (album, key, session, day), carrying counters.

## Why not a third-party tracker

Plausible, Umami, or Matomo would see an **anonymous browser**. Access to this
gallery, however, is authenticated by key: only the instance knows _who_ is
looking, and that is half the question. A tracker would answer "42 visits",
where the administration screen answers "the `mamie` key visited on three days
this week, from a television".

The rest follows: a third-party script would contradict the promise of a gallery
that leaks nothing (see [04](../04-securite-et-acces.md), "What leaves the
instance"), require another domain in the `Content-Security-Policy` header, and
make an instance designed to be self-contained depend on an external service —
the same trade-off as in
[D63](./D63-le-depot-ne-privilegie-aucun-hebergeur-et-ne-cree-pas-de.md).

## Why not an event log

The natural shape would have been one row per request, aggregated on read. It is
rejected on grounds of scale: one album visit is a grid request, two hundred
thumbnails, and a few dozen photo openings. Counting each one would produce
**tens of thousands of rows per day**, which would then need serious indexing,
aggregation, and pruning.

The `INSERT … ON CONFLICT DO UPDATE` on
`(album_id, username, session_id, day)` reduces this to about ten rows per day,
making pruning almost decorative — four hundred days of retention fit in a few
thousand rows. The loss is real and accepted: **the exact time of every
gesture**, and therefore any intraday chart. Nobody has asked what time their
mother looks at the photos.

Two structural consequences follow:

- **The table has no foreign key**, either to `sessions` or to `albums`. Logging
  out destroys the session; it must not erase the history of what was viewed —
  `session_id` is only a bucket for counting distinct visitors here, not a link.
  The same applies to a deleted album: its past traffic remains true, and the
  screen displays its identifier in place of its title.
- **`WITHOUT ROWID`**: the table is fully defined by its composite primary key;
  the implicit secondary index would serve no purpose.

## Why the device class, not the user agent

The complete user agent is a **fingerprint**: browser version, OS version,
device model, and sometimes the network operator's brand. Keeping it would make
it possible to distinguish two people behind a shared access key, which this
telemetry is not intended to do.

It is therefore read **once**, when the session is created, reduced to one of
four values — `mobile`, `tablette`, `ordinateur`, `tv` — and then discarded.
One class out of four cannot re-identify anyone, and answers the only question
that informs a decision: what to optimise. `device.ts` checks for a television
**first**, because webOS announces `Mobile` and `Safari` in its header and would
be classified as a phone by a naive test — precisely the screen that does not
appear in the logs.

The remaining bias is known: a recent iPad identifies itself as "Macintosh" and
is counted as a computer. Correcting this would require probing touch support in
JavaScript — exactly the tracker just rejected.

## Where measurement stops

**Never at the media item.** One row per photo opened would be someone's viewing
history in an application where several people share a key. The counters stop
at "how many photos were opened in this album on that day".

**Never at the IP address.** It would add nothing that the access key does not
already say, and would turn a table of counters into personal data that needs
protection.

## The cost on the request path

Two writes are added, and no reads:

- `last_seen_at` is **one more column in the SELECT** that `SessionStore.get()`
  already performs on every request. Rewriting it is capped at once per hour per
  session, following the reasoning already used for `RENEW_AFTER_MS`: without
  this threshold, every thumbnail in a grid would trigger a SQLite UPDATE.
- Opening an album is counted only on the **first page**, just like the
  subscription in
  [D41](./D41-on-s-abonne-aux-nouveautes-en-ouvrant-l-album.md) — subsequent
  pages are the same gesture. It is unconditional with respect to identity,
  however, whereas subscribing requires a verified commenter: visits are being
  counted, not subscribers.

Both counters are attached to requests the gallery **already** makes: the first
page of the grid and the details of a media item. No reporting route was added —
a visit "ping" would be one more request per photo and an API surface used by
nothing else.

The second point required a frontend correction, found by checking the
measurement in the browser: `useMediaDetail` was enabled only when **the side
panel was opened**. Relying on it would have measured open panels while claiming
to count viewed photos — zero for an ordinary visit. The request now starts as
soon as a photo is displayed, which also means the "Info" panel opens on rows
that are already present rather than on a loading indicator.

## Administrator visits are shown, not excluded

Removing them would make the totals misleading, and nobody would know whether
"40 visits" includes those of the person looking at the screen. An
"administrator" column on the row is enough to read them for what they are.
