# D260816i — A connection is edited, and its settings are read back

**Confidence.** observed — db.ts, git ls-files → exit 0 · 2026-08-23

## Context

`/admin` could add a storage connection and delete one, and nothing in between.
`PATCH /api/admin/storage/:id` had existed since the connections table did, and
`useUpdateStorage` was written beside the other hooks — with no caller. Correcting
a mistyped endpoint therefore meant deleting the connection and adding it again.

Which is refused. A connection an album reads cannot be deleted, so the one repair
available was closed to exactly the connections worth repairing.

## Settings come back; the secret does not

An edit form has to show what a connection reads, or it is a blank form asking for
everything a second time — which is the deletion-and-recreation it replaces, minus
the deletion. So `StorageConnectionStatus` now carries `settings`.

That is safe for the reason `settings` is stored in the clear at all, which
`db.ts` already states: an endpoint, a bucket, a prefix, a folder give access to
nothing on their own. The route is `admin`-only, and a failed **Test** already
prints the resolved path or the host to the same reader.

The **secret** stays write-only, and the credential fields therefore start empty.
Blank means "keep what is stored" — the rule an account's password field has always
followed here. `UpdateStorageRequest` distinguishes three answers where a field can
express two: a value replaces, absent keeps, `null` forgets. The form sends the
first two; forgetting a secret is a deliberate act and does not get to happen
because somebody corrected a bucket name.

**Typing one half of a credential makes the other required.** The pair — an S3 key
and its secret, a WebDAV username and its password — travels as one JSON string
inside the single encrypted column, so replacing it replaces both. A new access key
saved beside an empty secret would leave the connection unable to answer, and the
Test button would be the only thing saying so.

## The kind and the identifier do not change

`updateStorageSchema` accepts neither, and the form shows both as fixed text.
An album names its connection by identifier and reads it through its kind; a
connection that changed backend underneath would leave every indexed media
addressed in a language the new backend does not speak. Renaming is what the label
is for.

## Deletion says which albums, before the refusal

The server refuses `DELETE` while an album reads the connection and names the
albums in the message — that part was right and is unchanged. What was wrong was
when the reader met it: after confirming a deletion, in the banner at the top of
the page, about albums the row had only ever counted.

`ConfirmDialog` gained `confirmDisabled`, and the storage dialog lists the titles
and refuses to send. The 409 remains the boundary — the front end is not
authoritative and a stale list must not be able to delete anything — it simply
stops being the way the condition is discovered.

Titles come from `useAdminAlbums`, **read without being waited on**, the
arrangement the moderation queue's album filter already uses: the list of
connections is what this screen is opened for, and the count in
`StorageConnectionStatus` carries the sentence on its own until the titles arrive.

Beside them is a link to `/admin/albums` rather than a move control here. Moving an
album is what `AlbumForm`'s storage selector already does; a second way to do it
would be a second thing to keep correct.

## Rejected

_A read-only settings display, with no editing_ — it answers "what does this
connection read" and leaves "fix it" where it was, which is the actual complaint.

_Returning the secret masked, so the field shows something_ — a masked value is
still a value the server has to send, and the only honest thing to send is nothing.
An empty field that says what empty means is clearer than eight bullets that mean
"do not touch".

_Allowing the kind to change, purging the index on the way_ — plausible, and it
makes a connection into two different things sharing an identifier. Albums, cached
renders and comment threads all hang off media identifiers derived per backend
(D260816c); the honest version of that operation is a new connection and moving the
albums, which is already possible.
