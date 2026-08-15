# D260815g — The single-row `oauth_token` table becomes a table of connections

**Context.** `oauth_token` carried `CHECK (id = 1)`. One row, one Google account,
one instance — and [01](../01-vision-and-scope.md) listed "multiple Drives" among
the things this project deliberately does not do, naming that constraint as the
reason.

The constraint was the schema stating a scope decision, which is a fine thing for
a schema to do until the decision changes. It changed with 1.2: an instance that
can read a folder, a bucket and a WebDAV server has no reason to be able to read
only one of each, and the interface that made other backends possible
([D260815f](./D260815f-a-storage-interface-and-drive-as-its-first.md)) says
nothing about how many connections there are. The next thing to build after that
interface was where a connection is stored and which one an album reads.

**Decision.** `storage_connections`: one row per backend the instance reads, and
`albums.connection_id` naming the one an album belongs to. `StorageConnectionRepo`
owns the table and its secrets; `StorageRegistry` turns a row into a live
`StorageProvider` and caches one per connection; everything downstream asks it for
a provider by connection id.

Three consequences follow from the album owning the choice rather than the
instance:

- **`getFileMeta` resolves the connection**, by joining `albums`. With several
  storages, a media identifier no longer says who holds the bytes, and the media
  proxy needs to know before it can fetch anything.
- **`MediaRenderer` and `VideoTranscoder` take a provider per call** instead of
  holding one. One renderer serves every album, and albums no longer all read the
  same storage.
- **`syncAll` skips the rest of a connection on a withdrawn authorisation**, where
  it used to stop entirely. A token Google refused says nothing about a bucket.

**The migration copies `ciphertext`; it never re-encrypts it.** Re-encrypting
would mean decrypting with `TOKEN_KEY` inside a migration, and a wrong or missing
key there destroys an authorisation only new Google consent can restore — the one
failure this whole release could cause that nobody could undo. What the encrypted
string contains therefore belongs to the kind: Drive's is the refresh token
itself, exactly as `oauth_token` stored it, and a backend needing several values
puts JSON in it.

The `drive` row is inserted **whether or not a token exists**. Two installations
depend on it: a fresh database, whose `albums.connection_id` defaults to `drive`,
and a service-account installation, which never had an `oauth_token` row at all
because its key lives in the environment. Inserting only where a token existed —
the obvious form of that statement — would have left the second kind of instance
with albums pointing at nothing.

**Rejected.** _A foreign key from `albums.connection_id`_ is what the schema would
normally use to guarantee an album points somewhere. SQLite refuses to add a
column carrying one unless its default is NULL, and a nullable connection is the
state this design exists to prevent. The guarantee moved to the delete route,
which refuses with `409 storage_in_use` and **names the albums** — a message a
foreign-key violation could not have written.

_Deleting the connection on disconnect_, which is what `oauth_token` did, would
take its albums' storage with it for what a person means by "sign this account
out". Disconnecting now clears the secret and keeps the row.

_A `connection_id` column on `media`_ would have made the join unnecessary. It
would also have made every media row carry a fact that belongs to its album, and
moving an album between storages a rewrite of its index rather than a purge.

**Consequences.** `AdminStatus` loses `driveMode`, `driveConnected`,
`driveAccount` and `driveRevokedAt`, and gains `storage: StorageConnectionStatus[]`
plus `storageKinds`. `oauthConfigured` stays: it is an environment fact, true or
false for the whole instance, and repeating it on every row would say the same
thing three times.

A connection reports an `authorization` — `consent`, `key` or `settings` — rather
than its kind, and that is what /admin branches on. The alternative is a component
that knows what a service account is, and then what a bucket is, and then what
WebDAV is.

The OAuth state cookie now carries `<connectionId>:<state>`. Google's callback URL
is fixed in its console and cannot name a connection, so with two Drive
connections the returned token would land on whichever one the server guessed.

Nothing about a **single**-storage instance changed on screen except the section
title: one connection means no selector on the album form, no storage name under
an album row, and the same Connect button in the same place.
