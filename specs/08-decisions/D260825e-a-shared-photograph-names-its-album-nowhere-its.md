# D260825e — A shared photograph names its album nowhere its recipient can reach

**Confidence.** stated — owner: Alexis Mineaud, /do-spec on Sharing-without-an-account · 2026-08-25

**Not built yet.** Decided 2026-08-25; no code implements this.

**Context.** Sharing one photograph is the case where a link is sent to somebody outside the
household about a picture they are in. What they were given is that picture. An album name is a
sentence somebody wrote about a family occasion, and it says who was there, when, and that there are
more of them — which is the thing that was deliberately not sent.

The application's own structure works against this. Media are keyed `(album_id, id)`, media access
is granted as soon as one containing album is visible, and a comment thread is keyed on the album
and the media together (D34) so that two albums holding the same file keep separate conversations.
The album is therefore present in almost every path that serves this photograph, and the question is
only whether it ever surfaces.

**Decision.** Nothing the recipient of a single photograph can reach names the album it came from.
Not the page, not the address they were sent, not the mail carrying their verification code, and not
anything sent to them afterwards.

The album keeps doing its work underneath: the thread still resolves through `(album_id, media_id)`,
so a comment written through the link lands in the same conversation an account would see, and D34's
isolation is unaffected. What changes is that the identifier never leaves the server on this path.

**Rejected.** _Naming the album quietly, in the address or the page title._ It is the natural result
of reusing the album page with one item, and it is the failure this decision exists to prevent —
nobody would notice it in review, and the recipient would read it before anybody did.

_Serving the photograph through a synthetic album of one._ It keeps every existing path intact by
giving the link something album-shaped to point at. It then needs that album to be invisible in the
album list, absent from administration, excluded from synchronisation and skipped by the notifier,
which is four negative properties to maintain against a table whose whole purpose is to be listed.

_Letting the recipient subscribe to updates._ D41 subscribes a verified visitor to the album they
opened, and there is no album on offer here. A shared photograph subscribes nobody, which is stated
in D41's terms rather than as an exception to it: the visitor did not open an album.

**Consequences.** A share link records what it covers, and one album is not one photograph — the two
kinds are answered by different responses rather than by an album response carrying a single item.

The verification code mail is composed for somebody who has no album, so the sentence naming what
they are commenting on is written for a photograph. Both catalogues carry it.

The activity feed and the album's comment counts are surfaces a link visitor never reaches, for the
same reason the album list is not: what they hold is organised by album.
