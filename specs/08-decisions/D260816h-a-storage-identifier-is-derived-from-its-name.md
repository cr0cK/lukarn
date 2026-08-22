# D260816h — A storage identifier is derived from its name

**Confidence.** observed — db.ts, git ls-files → exit 0 · 2026-08-23

## Context

The "Add a storage" form asked for two things before anything else: a **Name**,
and an **Identifier** underneath it, prefilled from the name and editable, with
the hint "Written into every album that reads this storage. It cannot change."

It was copied from the album form, where the same pair is right. It is not right
here.

## Nobody outside /admin names a connection

An album identifier is public. It sits in `/album/2026-corse`, it is what somebody
pastes into a message, and choosing it is a decision with consequences a year
later. That is why its field stays exactly where it is.

A connection identifier is addressed by nothing a person types:

- `config/albums.example.yaml` has no `connection:` key, and an album bootstrapped
  from YAML falls back to `DEFAULT_CONNECTION_ID`.
- No environment variable, no command-line script and no line of `deploy/README.md`
  mentions one.
- Every use in the front end is machine-to-machine — a React key, a mutation
  argument, the `value` of a `<select>` option.

So the field asked the administrator to decide something only the machine would
ever read, on the screen where the actual decisions are which backend, which
address and which key. Worse, it asked it **irreversibly**: its own hint said the
value can never change, which is a heavy sentence to put under a field nothing
depends on.

## The identifier stays a slug

What justifies a slug rather than a row number is one thing, and `db.ts` already
says it beside the column: `connection_id = 'archives-minio'` in a log line, in a
`storage_connections` dump or in a `sqlite3` session says what it addresses, and
`4` does not. Whoever reads those is debugging, and a readable identifier is worth
more there than anywhere the form could have shown it.

So the column, the migrations and `DEFAULT_CONNECTION_ID` are untouched. Only the
question moves: the server derives the slug from the label with `slugifyAlbumId`,
the same function the album form previews an album identifier with. Sharing the
function is the point — a slug previewed one way and stored another is a bug that
surfaces once, in production, on an accented name.

`slugifyAlbumId` therefore moved into `@lukarn/shared` beside `ALBUM_ID_PATTERN`,
and `lib/adminForm.ts` re-exports it so the forms keep importing their rules from
one place.

## A collision is suffixed, never refused

Two storages can legitimately be called **Archives**. The route now answers that
with `archives`, `archives-2`, `archives-3`, instead of the `409 conflict` it used
to.

The refusal made sense while the field existed: it named the taken identifier and
the administrator typed another. With the field gone it is a dead end — the form
holds nothing that could be changed in reply, and "already exists" would name a
value the person never chose and cannot see. A suffix is the only answer that
leaves the screen usable.

Two guards come with the derivation, both silent when they are absent:

- A label that slugifies to **nothing** — `📷`, `***` — falls back to `storage`.
  An empty identifier would be stored happily and then refused by every route that
  names a connection, so no album could ever point at it.
- The suffix **eats into** the slug rather than extending past
  `USERNAME_MAX_LENGTH`. `createAlbumSchema` bounds the `connectionId` an album may
  name by the same constant, and a connection one character over it is a
  connection no album can be moved to.

An explicit `id` in the request body is still accepted and still answered with
`409` when taken: the caller chose the value, so the caller is the one who can
choose another. The form no longer takes that path, but a restore or a script has
an identifier to preserve, and losing it would repoint every album it carries.

## Consequences

- `CreateStorageRequest.id` is optional. `POST /api/admin/storage` derives one when
  it is absent.
- The form is a name, a kind and the fields of that kind. `storage.identifier` and
  `storage.identifierHint` left both catalogues.
- `StorageRow` still prints the identifier beside each connection. It is the bridge
  between this screen and a log line, and it is now the only place it is read.
