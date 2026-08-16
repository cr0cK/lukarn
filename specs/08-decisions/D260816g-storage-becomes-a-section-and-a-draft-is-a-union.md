# D260816g — Storage becomes a section, and a draft is a union

## Context

Three pull requests made storage a first-class notion in the data: a
`storage_connections` table, `albums.connection_id`, and four kinds an instance
can read. The interface did not follow. Seven hundred lines of connection list,
connection form and per-backend fields sat inside the **Server** section, between
the sync interval and the cache budget, and everything they knew about the four
backends sat in one file.

Two problems, one piece of work.

## Where the screen belongs

**Storage is its own section, at the head of the Library group.** Server is about
the machine — how often it syncs, how much disk the cache may take, which version
is running. Where the photographs come from is not a property of the machine; it
is the upstream half of the library. A reader arriving with "where do my photos
come from?" was landing on a page whose other three blocks answer "how much disk
am I using?".

It sits **above** Albums because it is upstream of them: connect a source, then
draw albums from it. That is also the order somebody installs this application in,
and the order the empty state of Albums now points along.

`/admin` still redirects to `/admin/albums` on a desktop, as D66 left it. First in
the flow is not the same as opened every day: albums are administered weekly, a
connection once.

**The cache does not follow.** It is agnostic to the backend — one budget, one
directory, one purge, for everything the instance serves — and it is a resource
Lukarn manages itself rather than one an administrator connects. Filing it under a
source would suggest there is a cache per source, and the first question after that
would be how to size each one. It stays under Server, beside the sync cadence.

The OAuth callback follows the button: it redirects to `/admin/storage?oauth=…`,
because a consent return is an answer to **Connect**, and an answer that lands on
another screen is not one.

## Why a discriminated union rather than a registry

Each new backend added four things to the same file: a draft type, a payload
builder, a validation map and a fields component. Three backends arrived in three
parallel branches, and merging two of them line by line produced code that did not
compile — the mechanical outcome of four grafts into four shared places.

The obvious repair is a registry keyed by kind:

```ts
const BACKENDS: Record<StorageKind, { empty: unknown; errors: …; payload: … }>;
```

It was rejected. The repository compiles with `noUncheckedIndexedAccess`, under
which `BACKENDS[kind]` is possibly `undefined` and its `empty` is `unknown`: every
field the form reads would need a cast, and a cast is exactly the place where a
bucket's `accessKeyId` can be read off a WebDAV draft without the compiler minding.
A registry buys uniformity and pays for it in type safety, on the one screen that
handles credentials.

So the draft is a **discriminated union** on `kind`. Narrowing on `draft.kind`
hands back exactly the fields that kind has, with no `any` and no cast, and an
unhandled kind is a compile error in three `switch` statements rather than a blank
area under a selector. Adding a backend is now one fields component and one branch
of one line in `emptyDraft`, `draftErrors` and `draftPayload`.

The three functions live in `packages/web/src/lib/storageDraft.ts` rather than in
the form, for the reason `adminForm.ts` exists beside it: what a backend requires
is a rule, and a rule tested through a rendered form is a rule tested through
everything else too.

## Consequences

- Seven sections instead of six, and `ADMIN_TABS` remains the single source.
- `StorageSection` becomes a directory of six files, none of which is long enough
  to hide a fourth backend in.
- `StorageRow` still branches on `authorization` and never on the kind — the one
  property this split had to preserve.
- Albums with no connection declared shows an empty state pointing at
  `/admin/storage`, instead of a form whose last click answers
  `400 unknown_storage`.
