# D46 — A service account to stop seeing "Google hasn't verified this app"

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** `drive.readonly` is a scope that Google classifies as **restricted**:
until the application is verified, every consent displays a red warning screen
that recommends not continuing and hides the real link behind "Advanced
settings". Removing that screen requires a verification procedure which, for a
restricted scope, extends to a third-party security audit — entirely out of
proportion for a self-hosted family gallery. The other options are not options:
the "Internal" type is reserved for Workspace organisations, and "Testing" mode
keeps the screen **and** makes refresh tokens expire after seven days.

**Choice.** `GOOGLE_SERVICE_ACCOUNT_FILE` points to a service account's JSON key,
which takes precedence over OAuth when present. There is then no consent at all:
authorisation comes from **sharing the folder** in Drive, exactly as one shares a
folder with someone.

The two paths coexist instead of one replacing the other. A live instance already
runs with its OAuth token; forcing it to migrate because of a screen it will not
see again for six months would be a regression. Adding the key is enough to
switch, removing it is enough to switch back — and configuring both is the normal
transitional state during this change, hence the priority given to the key.

**Rejected.** Requesting `drive.file` instead of `drive.readonly`, which is not a
restricted scope: it only grants access to files selected one by one in Google's
picker, so it cannot index an entire folder — the application's core feature.
Also rejected: having the application verified, whose cost bears no relation to
the use case.

**Consequences.** The scope narrows, which is a benefit: `drive.readonly` grants
read access to **all** of Drive, while a service account only sees what is shared
with it. It is also a constraint, and the only thing not to forget — an album
folder that has not been shared produces no error, only an empty album. /admin
therefore displays the service account address prominently; this is the address
to copy into the sharing settings.

The key does not expire: it must be protected like `TOKEN_KEY`, outside the
repository and mounted read-only. In return, nothing can expire or be revoked —
D20's `invalid_grant` does not exist in this mode.
