# 04 — Security and access

## Three distinct things, not to be confused

|                  | What it is                               | What it grants                           |
| ---------------- | ---------------------------------------- | ---------------------------------------- |
| **Google OAuth** | The owner's consent                      | Server-side read access to _their_ Drive |
| **`users`**      | An **access key**, possibly shared       | The assigned albums                      |
| **`commenters`** | A **person**, address verified by a code | The right to sign a comment              |

The distinction between the last two is recent and structural: credentials entrusted to an entire
household do not identify who is writing. See D38.

Since 1.3 the last two may be **joined on one account**: `users.commenter_id` names the person an
access key is, or is `NULL` and that key stays what it has always been. There is one axis rather
than two kinds of instance (D260819), so nothing below has to ask which kind of account it is
looking at.

## The two authentication methods, not to be confused

This is the project's most costly source of confusion. These are two unrelated mechanisms that do
not share storage, lifespan, or user base.

The server accesses Drive through one of **two** mutually exclusive paths: when
`GOOGLE_SERVICE_ACCOUNT_FILE` is set, it uses the service account; otherwise it uses OAuth. The
table below describes OAuth, which remains the default; the service account has its own section
below.

|                    | Google OAuth                                | Username/password                   |
| ------------------ | ------------------------------------------- | ----------------------------------- |
| Who                | The Drive owner, one person                 | Every visitor                       |
| When               | Once, during installation                   | For each session (one year)         |
| What it grants     | Drive read access **for the server**        | The albums assigned to this account |
| Where it is stored | `storage_connections.ciphertext`, encrypted | `users` table, argon2id hash        |
| Who initiates it   | `/admin` → "Connect Google Drive"           | The `/login` form                   |

A visitor never sees Google, needs no Google account, and never receives a `googleapis.com` URL.
Every token the application holds is the owner's, and all content is served through them.

## Passwords

Hashed with **argon2id** using the default `argon2.hash()` parameters. The password arrives in plain
text on `POST`/`PATCH /api/admin/users` and is hashed only on the server; **no API response ever
contains a hash** (`packages/server/test/admin-config.test.ts` verifies this for both creation and
listing). Minimum length: `PASSWORD_MIN_LENGTH` (8), shared with the frontend.

Two other paths produce a hash: `pnpm create-admin` for the very first administrator of a fresh
installation, and `pnpm hash-password` for a bootstrap `config/albums.yaml`—`config.ts` rejects any
value there that does not start with `$argon2`, preventing a password accidentally left in plain
text.

`routes/auth.ts` **always** compares a hash, even when the username is unknown: in that case it
checks a constant `DUMMY_HASH`. Without this precaution, a nonexistent login would respond in a
fraction of the time taken by a wrong password, allowing accounts to be enumerated by timing them.

User lookup is **case-insensitive** (`ConfigRepo.user`), as is uniqueness—this is the role of the
primary key's `COLLATE NOCASE` (see [03](./03-data-model.md)). Creating "ALEXIS" when
"alexis" exists returns **409**, never a silent overwrite.

## An account bound to a person

`users.commenter_id` holds the identity an account **is**. A bound account is one person: every
device that signs in with it signs comments with that name, and there is nothing left to declare on
arrival (D260819).

- **The identity comes from the account, and is reread on every request.** `plugins/auth.ts` reads
  `users.commenter_id` when it is set and `sessions.commenter_id` otherwise, so an address deleted
  elsewhere stops signing without waiting for another sign-in — the session lasts a year. The two
  columns answer different questions: the session's is what this device declared, the account's is
  who this account is.
- **A binding is always a verified one.** The column is written when a code is consumed, and by
  nothing else. No route under `/api/admin` points it at an identity, because an administrator able
  to do so could aim their own account at anyone who has ever commented and sign as them. Unbinding
  clears the column, and nothing else writes it. The rule that an unverified identity is attached to no session therefore holds here
  without a check of its own.
- **`SessionUser.identityBound` says which of the two the identity came from.** The front end needs
  it in order to stop offering to change or forget an identity the server will refuse to change or
  forget.

**Two credentials, one per kind of account.** An unbound account is entered with its password,
exactly as before. A bound account holds no password and is entered with six digits sent to the
address it is bound to (D260819b).

| The account is | Entered with                         | Recovered by                                                                                     |
| -------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Unbound        | Its password, argon2id               | `pnpm reset-password`, or /admin                                                                 |
| Bound          | A code sent to its address, `signin` | Unbinding it, which requires a password. `pnpm reset-password` performs that unbind and says so. |

"No password" is **one reserved argon2 hash**, `NO_PASSWORD_HASH` in `crypto.ts`. `password_hash`
is `NOT NULL` and stays that way, and a nullable column would mean rebuilding `users` to express
with a null what a constant expresses without touching the schema. `/auth/login` compares it like
any other hash, without branching, so an account with no password is not the one that answers
faster. It is a constant rather than random bytes thrown away because two rules have to recognise
it: the last-admin count, which excludes an account holding this hash with no binding so that the
only working administrator cannot demote or delete themselves, and the account list, which shows an
account with no way in. It is generated from CSPRNG bytes whose preimage was destroyed, since a
sentinel that is `argon2("NO_PASSWORD")` would be a password opening every account holding it, and
`config.ts` refuses this exact value from a bootstrap `config/albums.yaml`.

**A password cannot be set on a bound account.** The refusal lives at the `ConfigRepo` boundary
rather than on the route, because `pnpm reset-password` writes through the repository without
passing any route, and guarding the route alone would leave a shell command that quietly recreates
the impersonation. The single exception is `{ unbind: true, password }`, which in one transaction
clears the binding, writes the password and closes the sessions: the administrator taking the
account back and handing it over as the shared key it has become. Without the rule an administrator
sets a password on a bound account, signs in, and the session signs as that person; without the
exception, unbinding leaves an account nobody can enter, the administrator included.

**What a conversion closes.** Consuming an invitation on an account that had a password closes that
account's sessions and deletes its approved pairings, in the same transaction that writes the
binding and replaces the password. Without the closing, the other devices of a household keep a
session that has just started signing under one person's name; without the password being replaced,
everyone who knew the shared key still walks in under it. The pairing row matters on its own: it
survives a session purge, and `claim()` turns a `deviceCode` into a fresh session on that username
afterwards, so a television approved while the key was shared would come back as the person the
account has just become. Unbinding closes the same two. The new session is opened by the route
**after** the commit, because it belongs to whoever just proved the address and a blanket close run
afterwards would sign them straight out.

## Attempt throttling

`packages/server/src/throttle.ts`, in memory. Each failure increments **three** counters, and the
most restrictive of the three determines whether to block.

| Axis          | Key                           | Free attempts | What it catches                                    |
| ------------- | ----------------------------- | ------------- | -------------------------------------------------- |
| `couple`      | `<ip>` + `<identifiant>`      | 5             | The normal case: someone mistyping their password. |
| `identifiant` | `<identifiant en minuscules>` | 10            | A distributed attack on a specific account.        |
| `ip`          | `<ip>`                        | 20            | A single source cycling through usernames.         |

Beyond the free attempts, each axis applies the same scale: 2 s, then doubling (4, 8, 16 s…),
capped at **15 minutes**. One hour without a failure clears the sequence (`RESET_AFTER_MS`).

The `ip` axis is not cosmetic: without it, an address trying thousands of random usernames would
only create counters with one attempt, would never be slowed down, and would obtain as many argon2
checks—the server's most expensive computation.

A successful login clears the `couple` and `identifiant` counters, **not** the IP counter: having a
valid account on the instance must not provide a way to reset its scanning allowance between two
bursts. A block returns **429** with a `Retry-After` header in seconds, and is checked **before** any
argon2 verification.

The table is limited to `MAX_ENTRIES = 20 000` entries: beyond that, expired and then oldest
sequences are discarded (returning to 90% of the limit to avoid sorting again on every subsequent
attempt). `LoginThrottle.purge()` is called by the hourly housekeeping in `main.ts`, alongside the
expired-session purge: without it, counters from a burst would survive until restart.

`trustProxy` is essential here (`app.ts`): behind Caddy, `request.ip` would otherwise be the proxy's
address—all visitors would be grouped under one address, and the `ip` axis would block the entire
instance.

Its value is a **list**, `['loopback', 'uniquelocal']`, not `true`. `true` trusts any
`X-Forwarded-For`, including one written by the client itself: changing it on every attempt would
then make each of the three axes above count a single occurrence, and the throttle would no longer
slow anything down. Only intermediaries reachable on the loopback interface or a private network
are trusted—that is, our own proxies, the only path through which a request arrives. A header from
a public address is ignored, and `request.ip` falls back to the connection address.

This protection therefore no longer depends on the deployment topology. It previously relied only
on the port being published on `127.0.0.1`: if someone removed that prefix, the throttle became
bypassable without any warning.

Accepted limitations: the counters are in memory and therefore lost on restart, and a truly
distributed attack (one address per attempt, one username per attempt) is not slowed by any of the
three axes. For an instance with a few accounts behind a reverse proxy, this is the chosen trade-off.

**The code routes reuse these three axes; there is no fourth counter.** `/api/auth/code/verify`
calls `fail()` and `succeed()` with the **address** in place of the username, the way pairing puts
its `deviceCode` there, so probing codes is slowed exactly like probing passwords.

`/api/auth/code/request` is the exception, and the shape is deliberate. It counts on the caller's
`ip` axis alone, because a `429` keyed to an address is the oracle its uniform `202` exists to
close. And it counts **every call, whatever it decided to do**: before the body is even parsed,
before the address is looked up, and whether or not an email went out. The `ip` axis is shared with
`/auth/login`, so an attacker walks it to one below its threshold with failed sign-ins and then
sends a single request for a candidate address. If the counter moved, the address was known. The
uniform `202` closes the answer channel, and a counter that depended on the answer — counting only
what was actually sent, the version that looks careful — reopens it one call later. The counter is
therefore a function of how much the caller asked, never of what the answers were, which also still
bounds mail-bombing across a thousand addresses: a thousand calls trip the axis whether or not
anybody exists behind them.

## Sessions

`packages/server/src/sessions.ts`. A random 32-byte identifier
(`randomBytes(32).toString('base64url')`), stored in the database with its expiry date. **One-year
TTL, extended once the session has passed its half-life**: in practice, users are never logged out
while they keep using the gallery, and a truly abandoned session eventually expires. The timer in
`main.ts` purges expired sessions hourly.

Why not have no expiry at all, as the word "indefinitely" suggested: an eternal session is a
permanent login token—stolen once, valid for life—and the table would grow without anything to
clean it up. A vocabulary warning: an HTTP _session cookie_, without `maxAge`, is one that dies when
the browser closes, exactly the opposite. The cookie set here is persistent. Extending the deadline
at half-life rather than on every request reduces the cost to one write per visitor every six
months, instead of one per thumbnail.

The `lukarn_session` cookie is `httpOnly`, `sameSite: 'lax'`, **signed** with `SESSION_SECRET` via
`@fastify/cookie`, and `secure` only if `PUBLIC_URL` starts with `https://`—otherwise the browser
would never send it back during local development. Its options come from a single function
(`sessionCookieOptions`), used both **at login and on extension**: two diverging sets of options
would make the cookie change scope on its first renewal.

Extending the session in the database is not enough: the cookie has its own deadline, which the
browser enforces without knowing anything about the database. The `onRequest` hook therefore
reissues it whenever reading the session extends the expiry—otherwise even the most regular visitor
would be logged out one year after logging in, with the extension only making `sessions` grow.

`sameSite: 'lax'`, not `strict`: returning from the OAuth callback is an incoming navigation from
`accounts.google.com`, and `strict` would prevent the cookie from being sent, causing the callback
to fail with a 401.

**Why not a JWT.** A JWT remains valid until it expires, wherever it is: revoking it requires a
revocation list, meaning a database table—exactly what we were trying to avoid. Here the session
_is_ the database row, so:

- `POST /auth/logout` deletes it, cutting off access on the next request;
- the `onRequest` hook in `plugins/auth.ts` checks on **every request** that the session's account
  still exists in the database, and destroys the session otherwise. The configuration is
  authoritative, not the cookie.

Which administration operations close a session, and which do not:

| Operation             | Sessions   | Why                                                                                                         |
| --------------------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| Delete an account     | **closed** | The account no longer exists; the hook would kill them anyway, so do it immediately.                        |
| Change the password   | **closed** | This is the very reason for the change: an already logged-in browser must be cut off.                       |
| Remove the admin role | kept       | The account remains legitimate. `admin` is reread on every request: `/api/admin/*` returns 403 immediately. |
| Change the album list | kept       | Likewise: `canSee()` is reevaluated on every request, so removed access ends on the next request.           |

The cost is one SQLite read per request—negligible in-process.

## Pairing a screen without a keyboard

`packages/server/src/pairings.ts` holds the state, and `routes/auth.ts` the four routes. The full
reasoning is in [D260809c](./08-decisions/D260809c-a-television-does-not-type-a-password-it-displays.md); what follows concerns
access.

A television has no camera: **it** displays the QR code, and an already connected phone scans it.
Pairing therefore delegates existing access; it does not create any—the password remains the only
way for a first device to gain access.

|                     | What it is                                      | Who sees it                        |
| ------------------- | ----------------------------------------------- | ---------------------------------- |
| `userCode`, 8 chars | The name of a pending request                   | The screen, the QR, the whole room |
| `deviceCode`, 32 B  | Proof of being the device that made the request | The requester, and nobody else     |

What holds it all together:

- **The displayed code retrieves nothing.** Only the `deviceCode` can retrieve the session, and it
  never appears on screen. Without this separation, a photograph of the television would be enough
  to take its place.
- **Approval requires a session** (`requireAuth`), and the created session carries the approver's
  account and albums—reevaluated on every request like any other session.
- **The commenter identity does not follow an unbound account, and does follow a bound one.** From
  a shared key the paired screen arrives without an identity, as after a password login: the
  approver is one of several people, and without this rule the living-room television would sign
  with their name. On a bound account the identity **is** the account, so it follows by
  construction, and approving a screen from one delegates the ability to sign as you (D260819).
  `pairings.ts` needs no state for this, since the created session already carries the approver's
  account; `/device/poll` returns that account's identity and `identityBound` in its approval
  payload, so a paired screen is not cached as unidentified until some later `/me`.
- **A `deviceCode` is worth only one session**: the request is deleted when retrieved, and replaying
  it returns the same response as an unknown code.
- **Five minutes**, then the request dies. The hourly purge in `main.ts` removes requests that nobody
  retrieved.
- **An unknown, expired, or already claimed code receives the same response**—404 `unknown_code`.
  Distinguishing "expired" from "never existed" would tell someone trying random codes which ones
  had existed.
- **Failures count towards the throttle**, on the same three axes as login (`throttle.ts`), with the
  code standing in for the username. Probing codes is therefore slowed exactly like probing
  passwords, without another counter.
- **The number of pending requests is bounded** (`MAX_PENDING`). Beyond the limit, the opening route
  purges and then returns 429: the table is in the database, and a burst of requests must not make it
  grow without end. Nobody gains access from it—at worst pairing becomes unavailable for the
  duration of the burst, which a burst would achieve anyway.

**The accepted risk** is social, and no secret changes it: getting someone to scan a QR code that is
not theirs makes them grant their access. The approval page displays the code, which must match the
one on the screen being viewed; the request expires in five minutes; and what is granted is a shared
access key, revocable by changing its password—which closes all its sessions, including the screen's.

`packages/server/test/device-pairing.test.ts` locks down these points.

## Album access control

Everything starts with `ConfigRepo`: `albumsFor(username)` and `canSee(username, albumId)`, exposed
by `AppContext` under the same names. An account's permissions are either a list of IDs
(`user_albums` table) or the `*` wildcard (`all_albums` column), which also covers albums created
later.

Both reads go through `ConfigRepo`'s in-memory snapshot, not SQLite: `canSee()` is called for every
thumbnail in a grid, and one query per tile would be a clear regression.

Assigning a nonexistent album is rejected (**400 `unknown_album`**)—this is the check that YAML
loading performed, almost always catching a typo that would silently deprive someone of access.

`admin: true` grants access to the `/api/admin/*` routes and the OAuth callback. It does **not**
automatically grant all albums: the wildcard is a separate setting.

**The last administrator is protected.** Deleting them or removing their role returns **409
`last_admin`**: without them, nobody could connect Drive, create an account, or restore the role to
anyone—the instance would become impossible to administer and require shell access to repair.

## Media access control: 404, never 403

`routes/media.ts` installs two `preHandler` hooks across the `/media` prefix: `requireAuth`, then
`authorize`. The latter calls `media.albumsContaining(mediaId)` and grants access as soon as one of
those albums is visible to the user.

The rule: **a denial returns 404, never 403.** A 403 would confirm that the resource exists, making
the structure of other people's albums observable by probing. The same response therefore covers
three cases that are indistinguishable from the outside: nonexistent media, unindexed media, and
media in a forbidden album. The rule also applies to albums: `GET /api/albums/:albumId` returns 404
for a forbidden album just as for a nonexistent one.

`packages/server/test/access.test.ts` locks down this behaviour for `/api/albums/prive`, `/items`,
`/items/:mediaId`, and the four media routes.

The accepted exception: `/api/admin/*` returns **403** to a logged-in non-administrator. The
existence of the administration area is not secret—it is announced in the README and by a link in
the top bar.

**The browser cache is partitioned by session.** Media responses include `Vary: Cookie` in addition
to `Cache-Control: private, …, immutable`. Without it, two accounts used in succession in the same
browser profile—the living-room computer—share the same cache entries: the second reopens from
history a photo in an album they were never allowed to see, without any request reaching
`authorize()`. What this header does not solve, and no other header would, is described in D43.

## Commenter identity

`routes/identity.ts` and `commenters.ts`. Three routes: declare an address and name, validate the
received code, and forget the identity for this session.

- **The code is stored as an HMAC in the database** (`hashVerificationCode`), never in plain text: a
  dump must not provide what is needed to verify an address. It lives for fifteen minutes, allows
  five attempts, and can only be resent once per minute.
- **Verification prevents impersonation.** Without it, anyone who knows the shared password could
  sign as "Grandma", or declare a third party's address and make them receive notifications.
- **Requesting a code renames nobody.** A name supplied for an already verified identity waits in
  `pending_display_name` and is applied only by `verify`. Without this, the request alone—which
  anyone behind the shared key can make for someone else's address—would rename their signature
  throughout their history, because the thread rereads the current name on every request.
- **`POST /identity/request-code` returns `202` whether or not the address is already known**:
  distinguishing the two would tell a probing user which addresses have already commented on this
  instance. A `429` remains possible during the minute after a send—it reveals only that a code has
  just been sent to the address, not that the instance knows it, and the route is only open to an
  authenticated account. **That last clause is what carries the argument**, and it does not survive
  on a route anybody can call: `/api/auth/code/request` therefore answers `202` for the minute
  after a send as well, and `/api/auth/code/verify` returns one refusal where `/identity/verify`
  returns four (D260819b).
- **All three routes answer `409 identity_bound` on a bound account**, refused by a `preHandler`
  before any handler runs. The identity of such an account is not the session's to choose:
  declaring another address would attach an identity the account contradicts, and forgetting one
  would silently do nothing, since `plugins/auth.ts` reads the account rather than the session.
  Forgetting who you are is a shared-key operation; on a bound account the way out is to sign out.
- **The session remembers the identity; it does not define it.** The identity is reread on every
  request: deleting an address removes the right to comment without waiting for another login—the
  session lasts one year.
- **Without SMTP, no code is sent**, so nobody can identify themselves or comment.
  `SessionUser.commentsEnabled` tells the frontend, which explains this instead of offering a form
  doomed to fail.

## Comments: the thread is partitioned like the album

`routes/comments.ts` repeats the check in every handler instead of installing it as a prefix
`preHandler`: the album does not occupy a fixed URL segment here. The rule remains the same as for
albums—404 for an unknown album and for a forbidden one.

The points that maintain this partitioning:

- **A thread belongs to the `(albumId, mediaId)` pair.** The same Drive file indexed under two
  albums has two separate conversations. Otherwise, a visitor would read in their album remarks
  made in an album they are not allowed to open—the media access check covers the photo's bytes,
  not what was said about it.
- **`parentId` is checked against the current media.** Replying to a comment requires proving that
  it belongs to this particular photo; otherwise a guessed identifier would be enough to attach a
  message to a thread that cannot be read.
- **Deleting requires continued access to the album.** Otherwise, a visitor whose access had just
  been removed would retain write access to content they could no longer view. The same guard
  applies to editing.
- **Editing is reserved for the author, and the author alone.** An administrator may hide or
  delete, but never rewrite: putting different words in someone's mouth under their name is a
  different kind of power from removing a statement. The `COMMENT_EDIT_WINDOW_MS` window (30 s) is
  enforced **server-side**—a rule enforced only by the frontend is not a rule. An expired window
  returns **409 `edit_window_closed`**, neither 403 nor 404: the denial concerns the message's state,
  not access rights, and its author can already see it.
- **Commenting requires a verified identity**; otherwise the route returns **403
  `identity_required`**. This is the second accepted exception to "404, never 403": the denial does
  not concern someone else's resource whose existence must be hidden, but the state of the user's
  own account—it reveals nothing.
- **The email address never appears in a thread.** It identifies and notifies; only the declared
  name and moderation have access to it. The same applies to the identity identifier:
  `AdminComment` carries it so moderation can target all of one person's messages, while `Comment`
  does not—a stable key in a public thread would allow their messages to be linked across albums.

`packages/server/test/comments.test.ts` locks down these points, as well as the indistinguishability
of 404 responses for forbidden and nonexistent albums.

**Moderation.** A hidden comment disappears for everyone, **including its author**: letting the
author believe their message is still being read would be a lie by omission, and this is what
separates explicit moderation from shadow banning. Hiding is reversible; deletion is permanent and
remains available to both the author and the administrator.

**Bulk moderation.** `POST /api/admin/commenters/:commenterId/hide` removes all messages from an
identity at once, across every album—the action needed after an access key has circulated too
widely. It creates no new power: it is the same hiding operation that nobody would perform fifteen
times by hand. It remains reversible through the matching `show`, and **does not ban**—the identity
can still write, consistent with rejecting shadow banning above. Closing the door is done by
changing the access key, which the queue displays next to every message.
`packages/server/test/moderation.test.ts` verifies that the action does not affect other identities
and returns 403 to a visitor, never 404.

## Subscribing to new items in an album

`subscriptions.ts` holds the state, `notifier.ts` handles sending, and
`routes/subscriptions.ts` handles unsubscribing. The full reasoning is in
[D41](./08-decisions/D41-opening-an-album-subscribes-you-to-updates.md); what follows concerns
access and consent.

- **Opening the album subscribes the user**, on the first page of
  `GET /api/albums/:albumId/items`—therefore behind `requireAuth` and the album access check, just
  like reading. Nobody can subscribe to an album they are not allowed to see.
- **Only a verified identity is subscribed.** The condition lives in the SQL of
  `SubscriptionRepo.subscribe`, not in the caller: a merely declared address may belong to a third
  party (D39), whom this gallery has no business contacting.
- **Not on media details.** Otherwise, clicking "View the photo" from a comment notification would
  subscribe the user to new items in the album, which nobody requested.
- **An unsubscribe survives reopening the album.** This is the feature's most important invariant:
  because subscription is automatic, simply deleting a row would recreate it the next day. Hence
  the `opted_out` state and `INSERT OR IGNORE` (see [03](./03-data-model.md)).
- **Unsubscribing is per album.** `commenters.notify` remains the global switch: it disables comment
  replies **and** new-item announcements. Without this distinction, someone who finds "Christmas
  2019" too noisy would disable everything and lose replies to their own comments—the most valuable
  notifications.
- **The unsubscribe token covers both address and album** (`signAlbumUnsubscribeToken`). Without the
  album in the signed message, a link received for one album would apply to all the others. Like the
  comments token: no expiry, no session, and compared in constant time.
- If an album or identity has disappeared since sending, the page says so instead of returning an
  error: the link lives in an email that may be reopened months later.

`packages/server/test/subscriptions.test.ts` locks down these points, including through the API: the
first page subscribes, media details do not, a subsequent page does not either, and one album's
token is rejected for another.

**Unsubscribe link.** `signUnsubscribeToken` (`crypto.ts`) produces an HMAC of the address using
`SESSION_SECRET`, compared in constant time. **No expiry and no session**: the link lives in an
email that may be reopened months later, and an expired token would send someone who specifically
wants to stop being disturbed to a login screen. What it grants is harmless—disabling one's own
notifications—and can be restored from /admin. Changing `SESSION_SECRET` invalidates previously
sent links, just as it invalidates sessions.

## One encrypted secret per storage connection

`packages/server/src/crypto.ts`. AES-256-GCM, with a key derived by `scryptSync` from a salt
generated for each encryption. Stored format:
`base64( salt(16) | iv(12) | tag(16) | ciphertext )`.

Because the salt is random, encrypting the same secret twice produces two different strings—a
database observer cannot infer that it has not changed.

**Every connection carries its own.** `storage_connections.ciphertext` holds whatever its kind
needs to authenticate — Drive's refresh token, a bucket's `accessKeyId` and `secretAccessKey` as
JSON, a WebDAV username and app password as JSON — and `StorageConnectionRepo`
(`storage/connections.ts`) is the only thing that encrypts or decrypts it. The rest of the
application handles a `StorageProvider` and never a secret: the registry builds one from a row, the
provider uses it, and nothing else sees either. `settings` sits beside it in plain JSON and is
deliberately readable — an endpoint or a bucket name gives access to nothing.

The threat model is explicit: **a dump of `lukarn.db` must not be enough to reach any storage.**
`TOKEN_KEY` is also required; it lives in the process environment and is never written to the
database. The VPS is not an HSM; someone who obtains a shell in the container has both.

If `TOKEN_KEY` changes, decryption fails on the GCM tag. `StorageConnectionRepo.secret()` **keeps
the row** and raises `StorageKeyMismatchError`, a `StorageNotConnectedError` whose message says the
one thing that matters: the secret exists, the key is wrong. Deleting it would destroy a still-valid
authorisation over a mistyped environment variable; restoring the original key is enough, and
`/admin` offers reconnection meanwhile. The same distinction is why **disconnecting clears the
secret without deleting the connection**: the albums reading it name it by id, and removing the row
would leave them pointing at nothing.

## A local folder: the root is a fence, and `realpath` is what enforces it

`packages/server/src/storage/local.ts`. A folder on the machine is the one storage
whose references are paths the server itself resolves, so it is the one that can be
talked into opening a file nobody meant to publish. Two mechanisms answer that, and
they answer different attacks.

**The root is declared by the environment.** `STORAGE_LOCAL_ROOT` names one
directory, and it is empty by default — the kind is then not offered at all. A
connection chooses a **subpath under it**; an absolute path is refused rather than
reinterpreted, and so is one containing `..`. This is deliberately not an /admin
decision: the account that administers albums is not the account that runs the
container, and letting the first name `/etc` or `/app/data` would turn an
administrator password into a file-read primitive over the whole machine (D260816d).

**Every resolved path goes through `realpath`, then is checked to still sit under
that root.** `path.resolve` normalises `..` away and knows nothing about links: a
symlink named `holidays` pointing at `/etc` survives it untouched. `realpath` is
what turns a request into the file that would actually be opened, and only then is
the comparison meaningful. The comparison itself includes the separator —
`/photos-private` must not count as inside `/photos`.

The check covers three moments, because each is a separate way in:

| Moment                | What is checked                                                       |
| --------------------- | --------------------------------------------------------------------- |
| Resolving the subpath | The connection's folder is really under the root, links followed      |
| Listing a folder      | An escaping entry is **dropped**, so it never enters the index at all |
| Fetching bytes        | The reference resolves under the root, or the request is refused      |

Dropping an escaping link at listing time is the load-bearing half: an entry that
reaches the index acquires a media id, and every later request for it arrives
looking legitimate. Refusing it at `fetch` alone would be a check on the wrong side
of the database.

The fence is recomputed on every call rather than cached at startup, for the same
reason a session is revalidated per request: a root replaced by a link afterwards
must be caught the next time it is used, not remembered from when it was valid.

Two things are deliberately **not** claimed. A hard link inside the root to a file
outside it is indistinguishable from the file itself and is not detected — the
mount is the boundary there, which is why `docker-compose.yml` mounts the folder
`:ro` and the volume is what the operator controls. And the application never
writes to a storage: the interface has no write operation, and the read-only mount
makes that a property of the deployment rather than a promise of the code.

## A WebDAV connection cannot read above its root

`storage/webdav.ts` builds every URL from the connection's base address and its root, and
**refuses any path segment that is `.` or `..`**. Neither `encodeURIComponent` nor the URL parser
touches a dot, so an album whose folder is written `photos/../../..` would otherwise resolve
above the collection the connection is fenced to. The refusal is an error rather than a silent
rewrite: serving a directory nobody named is the failure worth preventing, and quietly rewriting
the path hides that someone asked for it.

The base address is also rebuilt rather than used as typed — origin, then the decoded path
segments re-encoded one by one. That drops a query string, a fragment, and any `user:password@`
pasted into the URL, which would otherwise reach every log line naming it.

The fence is only as wide as the account behind it: an app password with access to a whole
Nextcloud account reaches that whole account, whatever the root says. This is why the field asks
for an **app password** rather than the login one, and says so beside itself — revoking one costs
nothing, and it grants file access alone.

Credentials travel as HTTP Basic, which is base64 and not encryption. `https` is therefore the
only sensible scheme; `http` is accepted because a WebDAV server on the same private network is a
real deployment, and refusing it would push people to expose one instead.

## Detecting `invalid_grant`

Google returns `invalid_grant` when the refresh token can no longer be exchanged: access revoked
from `myaccount.google.com`, six months without use, or the application moved back to "Testing"
status (see [06](./06-configuration-and-deployment.md)).

`StorageProvider.guard(operation)` wraps every call reaching a backend, and callers wrap rather
than the provider wrapping itself—only the caller knows which unit of work to abandon. In the Drive
implementation, `isRevocation` recognises the error in **two** places—`error.response.data.error`
and the message—because its shape varies depending on whether it originates while refreshing the
token or calling the API. When triggered:

1. `revoked_at` is dated on that connection (the token and account are retained);
2. the cached OAuth client is discarded;
3. a `StorageRevokedError` is thrown instead of the original error.

Afterwards, `authorizedClient()` fails immediately with `StorageRevokedError` without calling Google
again: there is no point retrying an already rejected token. `Syncer.syncAll` stops the loop on this
error **for the albums on that connection**, and continues with the albums on the others: a token
Google refused says nothing about a bucket. `/admin` displays "Authorisation revoked for <account>"
on that row rather than "No account connected", and offers "Reconnect Google Drive". New consent
resets `revoked_at` to `NULL`.

A network outage or a Google 500 **does not** trigger revocation:
`packages/server/test/revocation.test.ts` verifies this explicitly. Invalidating the connection on
a transient error would require new consent for no reason.

## Drive rate limits

These must be distinguished from revocation, which they can resemble: Google rejects an excess
request with a `429`, or a `403` whose **body** carries the reason. `fetchAuthorized` retries up to
four times, doubling the delay (1 s, 2 s, 4 s…, capped at 30 s) or following the provided
`Retry-After` when present.

The body decides, not the status: a file the account cannot access also returns `403`, and retrying
it four times would only delay the failure. `downloadQuotaExceeded` is excluded for the same
reason—that quota is measured in hours, and waiting thirty seconds changes nothing.

Without this fallback, every rejection would leave a broken thumbnail that no mechanism recovers.
It matters even more since prewarming (D45, for which D58 redefined what is downloaded and when),
which concentrates downloads instead of spreading them across clicks.

## Service account as an alternative to consent

`GOOGLE_SERVICE_ACCOUNT_FILE` points to a service account's JSON key. When present,
`DriveService.mode` is `service_account` and **nothing else is read**: neither the connection's
stored secret, nor
`TOKEN_KEY`, nor `GOOGLE_CLIENT_*`. `auth.JWT` exchanges the key for an access token and renews it
automatically.

What this changes, and why it is the recommended path (D46):

- **No more "Google hasn't verified this app" screen.** `drive.readonly` is a _restricted_ scope:
  removing the warning would require Google application verification and a third-party security
  audit.
- **No refresh token**, so there is nothing left to encrypt, renew, or lose—`invalid_grant` after six
  months of inactivity disappears with it.
- **Reduced scope.** `drive.readonly` grants read access to the owner's **entire** Drive; a service
  account sees only what is explicitly shared with it. This is a security gain and a constraint:
  every album folder must be shared read-only with the service account address, or its
  synchronisation finds nothing.
- **The key does not expire.** It is protected like `TOKEN_KEY`: outside the repository and mounted
  read-only in the container.

A configured but unreadable key **stops startup** (`env.ts`) instead of falling back to OAuth:
switching silently would make the consent screen reappear where it had just been removed, without
explaining why. A path not mounted in the container is the most likely error, and it must be visible.

`/api/admin/oauth/start` and `/api/admin/drive/disconnect` return **409** in this mode: the first
would save a token that nothing uses, while the second would suggest the instance is disconnected
when it continues reading everything. /admin displays the service account address instead—the one
to copy into Drive sharing.

## OAuth consent

- `GET /api/admin/oauth/start` requires an administrator session, generates a random 24-byte
  `state`, stores it in a signed `lukarn_oauth_state` cookie (path `/api`, TTL 600 s), and returns the
  consent URL.
- `authUrl()` requests `access_type: 'offline'` and `prompt: 'consent'`: without the latter, a second
  authorisation would not return a refresh token and reconnection would fail without explanation.
- `GET /api/oauth/callback` **requires the same administrator session** and compares the received
  `state` with the cookie. Without this double check, a third party could complete a callback using
  a code obtained elsewhere and connect _their_ Drive to this instance. Failures redirect to
  `/admin/storage?oauth=<reason>` instead of displaying a raw error.

The requested scopes are `drive.readonly` (read access to the whole Drive—needed to point to any
folder without sharing it) and `userinfo.email` (only to display the connected account in `/admin`;
failure is ignored).

## What a visitor can and cannot see

| Can see                                                                       | Cannot see                                                               |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Their assigned albums, title, description, cover, item count, and date bounds | The existence of other albums, including through URL probing             |
| The metadata and EXIF of media in their albums                                | Any Google URL, Drive folder ID, or `folderId`                           |
| Downloadable originals from their albums                                      | The account list, settings, and synchronisation status                   |
| Their own username and admin status (`/auth/me`)                              | `/admin` (403) and the hidden "Administration" link in the bar           |
| —                                                                             | Visit telemetry: who came and what others viewed                         |
| Comments on photos in their albums, and their authors' display names          | Comments on an unassigned album, and comments hidden by an administrator |

## Visit telemetry: what is and is not recorded

`packages/server/src/telemetry.ts` holds the counters, and `device.ts` the device class. Measurement
happens **in the database, server-side**: there is no third-party script, so no data leaves the
instance for this purpose (D260809h).

| Recorded                                        | Not recorded                           |
| ----------------------------------------------- | -------------------------------------- |
| The access key (`username`)                     | The IP address                         |
| The session identifier, already in the database | The raw user agent                     |
| The album, day (UTC), and counters              | Each individual media item opened      |
| The device class: mobile/tablet/computer/TV     | The referrer, resolution, and language |

Two points support everything else:

- **The device class is inferred from the user agent when the session is created, then the user
  agent is discarded.** It is a fingerprint—browser and OS versions, model—whereas one of four
  values cannot re-identify anyone. This distinction reveals what the gallery is viewed on without
  separating two people behind a shared key.
- **Never the media item.** Counting photo by photo would produce someone's viewing history in an
  application where an entire household shares a password. The counters stop at "how many photos
  were opened in this album on that day".

**The counters did not change in 1.3, and their justification did.** A bound account is one person,
so the sentence above no longer holds on its own: what was "the counters cannot identify a person"
is now "the counters do not identify a person", which is the stronger promise and the one this
application intends to keep. Personal accounts are not permission to count photo by photo, and any
later work that wants finer telemetry is deciding to build a viewing history (D260819).

Reading is reserved for administrators: `GET /api/admin/visits` is under the prefix-level
`requireAdmin`, like everything else (see [05](./05-api.md)). The hourly purge in `main.ts` retains
data for four hundred days.

## What leaves the instance

Three destinations, and only three. Knowing them matters for an application whose promise is that
nothing leaks.

| Destination                     | What is sent                                                           |
| ------------------------------- | ---------------------------------------------------------------------- |
| Google Drive                    | Indexing and download requests, with the owner's token                 |
| The SMTP relay                  | Verification codes, comment notifications, and new-photo announcements |
| `GEOCODING_URL` (Nominatim/OSM) | **Coordinates rounded to one hundredth of a degree**, and nothing else |

Geocoding deserves an explanation because it sends photo data to a third party. What leaves is a
`lat,lng` cell rounded to two decimal places, a point accurate to roughly one kilometre: never a file
identifier, date, album name, or exact position. The service therefore cannot reconstruct a
journey, and two stays in the same place produce only one request thanks to the `geo_places` cache.
`GEOCODING_URL` accepts a private Nominatim instance, and an empty value disables this outbound
traffic entirely—the days retain their clusters, without labels.

## The uploaded logo: rasterised, never relayed

An administrator can replace the mark with an image of their own
(`PUT /api/admin/branding/logo`). This is the only place in the application where
a **file supplied by a person** is stored on the instance and served back from its
own origin, so it gets its own paragraph.

The obvious threat is SVG. It is the natural format for a logo and it is also a
document: `<script>`, `onload=` and `<foreignObject>` all work inside one, and
served from `PUBLIC_URL` it would run with the session cookie in scope. The CSP's
`script-src 'self'` does not help — the file _is_ self.

The answer is not to inspect the upload but to **stop serving it**:
`BrandingStore.replace` decodes whatever arrived and writes a PNG, so what leaves
the instance is a bitmap in every case (D260813b). An SVG is accepted as _input_
and never survives as one. A `Content-Type` check would have been the reflex
answer, and it checks a value the client chooses.

Three other limits sit around it:

- **512 KB** (`LOGO_MAX_BYTES`), enforced by `bodyLimit` on that route alone; the
  rest of the API keeps the 64 KB that fits a JSON payload. The body is held whole
  in memory before sharp sees it, so the limit is what prevents a request being
  used to occupy it.
- **Decoding is throttled** by the store's own semaphore, for the same reason as
  media rendering: rasterising holds a full bitmap.
- **An image sharp cannot read is a 400**, logged and refused. Not a 500: the
  instance is fine, the file is not — and not a silent success either, which
  would leave the previous logo in place while reporting a change.

The two `GET` routes are public, unlike everything else that reads instance
state. They serve an image the sign-in screen already shows and the tab icon
already requests before a session exists; they reveal nothing the page title does
not.

## Security headers

`packages/server/src/plugins/headers.ts`, registered **before** everything else in `app.ts`. The hook
is `onRequest`: at that point no route has responded, so none can omit the headers—not even those
served by `@fastify/static` without passing through one of our handlers, nor 404s and 500s.

| Header                      | Value                              | What it prevents                                                                           |
| --------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `Content-Security-Policy`   | see below                          | Execution of injected scripts, exfiltration to a third-party origin, and page framing.     |
| `X-Content-Type-Options`    | `nosniff`                          | A browser guessing a MIME type and executing as a script something served as another type. |
| `X-Frame-Options`           | `DENY`                             | Clickjacking in browsers that do not support `frame-ancestors`.                            |
| `Referrer-Policy`           | `no-referrer`                      | A Drive identifier in a media URL reaching a third-party site's logs.                      |
| `Strict-Transport-Security` | `max-age=15552000`, **if `https`** | Returning to clear text and interception on first access over a hostile network.           |

The CSP fits on one line, with a single directive doing the work: `script-src 'self'`. It makes a
`<script>` inserted into an album title or comment unusable—React already escapes what it displays;
the CSP is the second barrier, the one that holds if the first fails. The rest closes adjacent
doors: `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`,
`connect-src 'self'`.

Two allowances, and why they exist:

- **`style-src 'unsafe-inline'`.** React sets styles through the DOM's `style` property, which the
  CSP does not filter; but Vite may inline a small stylesheet during the build, and a CSP that
  breaks the layout on the next tooling update eventually gets disabled. Inline styles cannot
  execute code.
- **`img-src 'self' data:`.** Vite inlines images smaller than 4 kB as `data:`.

**HSTS is set only if `PUBLIC_URL` starts with `https://`.** Setting it unconditionally would condemn
a browser that visited a development instance to demand HTTPS from `localhost` for six months,
without an easy way back. The `max-age` is six months rather than two years, without `preload`: long
enough for the protection to matter, short enough for an instance that loses its certificate to
become reachable again within a human timeframe.

These headers come from the **application**, not the frontend proxy. They therefore apply in
development, in tests, and behind a proxy nobody thought to configure—a `Caddyfile` replaced by an
`nginx.conf` does not take them away (D47).

## Miscellaneous

- `noindex, nofollow` on every page (`packages/web/index.html`).
- `bodyLimit: 64 * 1024`: only short JSON payloads are posted; large transfers are outbound.
- The global error handler (`app.ts`) never returns the details of a 500—they may contain paths or
  identifiers. The message remains in the logs; the response says "Internal error".
- `safeEqual` (`crypto.ts`) performs a constant-time comparison that tolerates different lengths.
  It is used for unsubscribe tokens and verification codes; the OAuth `state` is compared through
  `unsignCookie` and then strict equality.
