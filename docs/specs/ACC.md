---
code: ACC
status: done
version: v1.0
amended: [v1.1, v1.2, v1.3]
created: 2026-08-02
---

# Lukarn — ACC specification

ACC covers user accounts, explicit roles, password and passwordless email authentication, member
invitation onboarding, keyboardless device QR pairing, database-backed sessions, throttling, and
all access-control and cryptographic invariants. It predates the spec delivery process, so it has no
plans, and describes the application as it stands.

## Accounts and explicit roles

- User accounts are stored in SQLite (`users`, case-insensitive `COLLATE NOCASE` usernames) and
  carry explicit permissions: `admin` (Administrator), `roleViewer` (Viewer: browse assigned albums
  and shares), and `roleCommenter` (Commenter: post comments on albums), alongside
  per-album grants (`user_albums` or `*` wildcard).
- Administrators always resolve `roleViewer = true` and `roleCommenter = true`; granting `admin`
  opens `/api/admin/*` and `/api/oauth/callback` but does not automatically grant all albums.
- The last usable administrator cannot be deleted or stripped of `admin` (returns `409 last_admin`).
- Accounts support two credential modes that may coexist:
  - **Shared access key**: username + argon2id password hash, shareable by a household, where
    individual commenters identify per session (D38).
  - **Email-bound personal account**: bound to a verified `commenters` row (`users.commenter_id`)
    with optional passwordlessness via the reserved `NO_PASSWORD_HASH` constant (`hasPassword ===
false`) (D260819, D260819b).
- On self-service routes (`/api/identity/*`, `/api/auth/code/*`, `/api/auth/invite/*`), email
  binding occurs solely upon consuming a verification code or invitation token; administrators can
  explicitly assign or update an account's email in `/admin` (which marks it verified or absorbs an
  unreferenced share-visitor row), while unbinding replaces the password and closes all sessions and
  pairings for that account.
- Every active user maintains an associated `commenters` row (`email = NULL` for password-only
  accounts until verified).

## Authentication, invitations, and pairing

- **Password sign-in** (`POST /api/auth/login`): trims the username (preserving whitespace in
  passwords) and always executes an argon2id verification (against `DUMMY_HASH` when unknown or
  passwordless) to prevent timing enumeration.
- **Email OTP sign-in** (`POST /api/auth/code/request`, `POST /api/auth/code/verify`):
  - `request` always returns `202` (unless mail is unconfigured: `503 mail_not_configured`, or
    IP throttled: `429`) regardless of whether the address exists, has a pending invite, or was
    requested within the 1-minute cooldown, preventing account enumeration (D260819b).
  - `verify` checks 6-digit HMAC-stored codes (15-minute TTL for `signin`/`identity`, 7-day TTL
    for `invite`, max 5 attempts) and returns one uniform `400 invalid_code` refusal on
    unknown/wrong/expired/exhausted codes, or `400 display_name_required` (without consuming an
    attempt) when an invitation needs a display name.
- **Magic invitation onboarding** (`/invite/:token`, `POST /api/auth/invite/:token`):
  - Administrators can invite members by email (`POST /api/admin/users/invite`) with optional
    display name, album grants, and locale; if SMTP is configured an invitation email is queued,
    otherwise an offline copyable `/invite/:token` URL is returned.
  - Consuming the token binds the account and verified identity, absorbs any pre-existing
    auto-created share-visitor account for the same email, auto-subscribes the member to their
    granted albums, opens a 1-year session, and prompts for a display name on `/invite/:token` only
    if none was set.
- **Password change / conversion**: changing a password, converting a shared account to a bound
  account, or deleting an account immediately invalidates all active sessions (and pending/approved
  device pairings on conversion/deletion).
- **TV / keyboardless QR pairing** (`/pair`, `POST /api/auth/device/*`):
  - The requesting screen holds a 32-byte secret `deviceCode` and displays an 8-character
    unambiguous `userCode` plus QR (`<origin>/pair?code=…`, encoded client-side) (D260809c).
  - An already signed-in account approves the `userCode` (refused to share-link sessions); bound
    accounts propagate their identity onto the paired screen while shared keys pair without an
    identity.
  - Requests expire after 5 minutes, are single-use, bounded by `MAX_PENDING`, and return uniform
    `404 unknown_code` for unknown, expired, or claimed codes.

## Sessions and throttling

- Sessions are random 32-byte tokens stored in SQLite (`sessions`, 1-year TTL, extended at
  half-life with matching persistent cookie expiry), signed via `SESSION_SECRET`, `httpOnly`,
  `sameSite: 'lax'`, and `secure` when `PUBLIC_URL` starts with `https://` (D11).
- The `onRequest` hook re-reads the user or share link on every request so deletions, permission
  changes, and share revocations take effect immediately.
- Progressive in-memory throttling (`LoginThrottle`, max 20,000 entries, purged hourly) tracks
  three axes (`ip+identifier` after 5 failures, `identifier` after 10, `ip` after 20) with
  exponential backoff from 2 s up to 15 minutes (reset after 1 hour idle) (D13).
- A successful login clears `ip+identifier` and `identifier` counters without resetting `ip`;
  `/api/auth/code/request` counts every call on the `ip` axis before parsing or sending.
- `trustProxy` trusts only `['loopback', 'uniquelocal']` so spoofed `X-Forwarded-For` headers from
  public clients cannot bypass IP throttling.

## Access control and security guarantees

- **404, never 403** on albums, media, and album-scoped comments: unauthorized and nonexistent
  resources return identical `404` responses so library structure cannot be probed (D12).
- `403` is returned only for `/api/admin/*` and `/api/oauth/callback` (non-admin), for
  `identity_required` when identification is needed to comment/favourite/unlock a gated share, for
  `comments_disabled` on shares, or when `roleCommenter` is disabled on an account.
- **Media prefix guard**: all `/api/media/*` routes share one `preHandler` checking `requireAuth`
  and either `ConfigRepo.canSee` (for accounts) or `ShareLinkRepo.covers` (for share sessions);
  responses carry `Vary: Cookie` alongside `Cache-Control: private, max-age=31536000, immutable`
  (D4, D43).
- **No upstream URLs**: visitors never receive Google Drive, S3, or WebDAV URLs; all bytes flow
  through the server.
- **Encrypted secrets**: storage credentials are encrypted with AES-256-GCM using scrypt-derived
  keys from `TOKEN_KEY` (stored outside SQLite with per-encryption random salts); a wrong
  `TOKEN_KEY` preserves the row and raises `StorageKeyMismatchError` (D14, D15).
- **Security headers**: Fastify sets `Content-Security-Policy`, `X-Content-Type-Options`,
  `Referrer-Policy`, and `Strict-Transport-Security` (when `PUBLIC_URL` is HTTPS) directly on
  every response.
