---
code: SHR
status: done
version: v1.3
created: 2026-08-24
builds-on: ACC
---

# Lukarn — SHR specification

SHR covers token-based share links for recipients without accounts, covering whole albums,
multi-photo selections across albums, and single photographs, together with composable access/comment
options, revocation and restoration lifecycle, and privacy-preserving visit telemetry. It predates
the spec delivery process, so it has no plans, and describes the application as it stands.

## Share credential model and scopes

- A share link (`share_links`) carries a 32-byte random base64url token (`SHARE_TOKEN_PATTERN`) and
  acts as a fourth, revocable credential alongside accounts; its `sessions` row has `username = NULL`
  and `share_token` set (D260825).
- Three scopes are supported:
  - **Single album / multi-album** (`share_link_albums`): renders the shared album grid (sorted and
    paginated via `/api/share/:token/items`) with instance branding and album title.
  - **Curated selection** (`share_link_items`): renders an ordered list of selected photos across
    one or more albums; displays the custom `label` or, when omitted/blank, the localised fallback
    title ("Shared photographs" / "Photographies partagées").
  - **Single photograph** (`media_id` set): opens that single item with no grid and no page title.
- Single-photograph and selection shares never leak source album IDs or album titles in UI labels,
  URLs, API payloads (`ShareItem` omits `albumId`), comment routes, or verification emails (D260825e).
- Share pages (`/s/:token`) render only the instance mark/name and shared content, with no `TopBar`,
  `BottomTabs`, album directory, sign-in form, or search indexing (D260825d).
- Sessions opened by a share link are confined to `/api/share/*`, `/api/media/*`, `/api/identity/*`,
  `/api/favorites/*`, `/api/comments/feed`, and comment edit/delete; `requireAccount` answers `404`
  elsewhere (D260825).

## Creation, editing, and lifecycle

- Only administrators can create, edit, revoke, restore, or delete share links, either from
  `/admin/shares` (collapsible share cards with search) or contextually from an album header or
  lightbox (`ShareModal`).
- Links can carry an optional `label` (used in administration and as the display title for
  selection, multi-album, and locked shares; never shown on single-album or single-photo shares) and
  an optional `expiresAt` timestamp (no expiry by default).
- Administrators can update `label`, `expiresAt`, `allowComments`, `requireIdentity`, and
  included albums/items (`POST`/`DELETE /api/admin/shares/:token/items`) without reissuing tokens.
- **Revoking vs deleting**: revoking sets `revoked_at`, immediately closes all sessions holding that
  token, preserves opening history, and can be undone via `restore` (prompting a new `expiresAt`
  if already expired); deleting removes the link and its `share_openings` history permanently
  (D260825b).
- An unknown or malformed token returns `404`; a revoked or expired token returns `410`
  (`share_revoked` / `share_expired`) rendered in words on `/s/:token` without exposing a login
  prompt, and a live link whose target media left the index returns `410 share_gone` (D260825b).

## Identity gates, comments, and subscribers

- `requireIdentity`: when enabled, `GET /api/share/:token` returns `kind: 'locked'` and all item,
  media, comment-read, and feed endpoints return `403 identity_required` until the visitor verifies
  an email identity or holds an authenticated account session (every account carries a `commenters`
  row, or grants album access directly); verified share sessions keep `req.user.identity` populated
  even when `allowComments` is disabled.
- `allowComments`: when disabled, posting comments returns `403 comments_disabled` and comment
  threads and feeds return empty lists.
- **Subscriber tracking** (`commenter_shares`): identified share visitors (excluding admins, the
  link creator, and accounts that already hold `ConfigRepo.canSee` access to all covered albums) are
  recorded as subscribers and can toggle `notifyPhotos` / `notifyComments` via
  `PATCH /api/share/:token/subscription` or `/settings`; if an account already has visibility over
  the link's albums, opening the link keeps their account session and records no share opening or
  subscriber row (D260825c).

## Privacy-preserving visit telemetry

- All telemetry is measured server-side in SQLite with zero third-party analytics (D260809h).
- `album_visits` records daily aggregated counts per `(album_id, username, session_id, utc_day)` and
  coarse device class (`mobile`, `tablette`, `ordinateur`, `tv`, inferred at session creation while
  discarding the raw `User-Agent`); rows are purged after 400 days, and it never records IP
  addresses, referrers, or which individual photos were viewed.
- `share_openings` records one row per `(token, session_id, utc_hour)` to answer whether and when
  a recipient opened a link (retained until the share link is deleted), without recording individual
  photos, email addresses, or IPs (D260825c).
