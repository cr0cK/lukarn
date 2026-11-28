---
code: SOC
status: done
version: v1.0
amended: [v1.1, v1.2, v1.3]
created: 2026-08-03
builds-on: ACC
---

# Lukarn — SOC specification

SOC covers verified commenter identities, album-partitioned photo comments, post-hoc moderation,
the cross-album activity feed, per-user favourites, and email notifications and subscriptions. It
builds on [ACC](ACC.md), whose access-control rules all apply. It predates the spec delivery
process, so it has no plans, and describes the application as it stands.

## Commenter identity

- Commenting (on a shared access-key account or a share link) requires a verified identity
  (`commenters` row with email verified via 6-digit code), or an account with an email bound or
  `roleCommenter` enabled; unverified callers receive `403 identity_required` (D38, D39).
- Declaring an address and display name via `POST /api/identity/request-code` queues a 6-digit
  verification code (15-minute TTL, 5 attempts, 1-minute resend cooldown) and stores any new name in
  `pending_display_name` so an unverified request never renames an existing identity (D42).
- `/api/identity/*` routes return `409 identity_bound` when called on an email-bound personal
  account; bound members manage their display name and notification switches in `/settings`
  (`PATCH /api/auth/profile`) instead.
- If `SMTP_URL` and `MAIL_FROM` are unconfigured, anonymous identity verification cannot send codes
  and `SessionUser.commentsEnabled` disables identity forms cleanly.
- Commenter email addresses and internal `commenterId` values are never exposed in public `Comment`
  responses; only the `displayName` is shown under photographs (D38).

## Comments and moderation

- Comment threads are strictly partitioned by `(album_id, media_id)` so two albums indexing the same
  file never share messages across visibility boundaries (D12, D34).
- Threads support one reply level only: replying to a reply attaches to the thread root, and
  `parentId` is verified to belong to the same `(album_id, media_id)` (D35).
- Authors may edit their own comment (max 2000 characters) within 30 seconds of creation
  (`COMMENT_EDIT_WINDOW_MS`); after that, the server returns `409 edit_window_closed` (D57).
- Authors (while retaining access to the album or share) and administrators may permanently delete
  comments; editing and deleting require continued read access.
- Publishing is immediate with post-hoc moderation: administrators can reversibly hide or restore
  individual comments (`hidden_at` hides from everyone, including the author) or bulk-hide all
  comments from a given `commenterId` without banning the identity (D36).
- The moderation queue (`/admin/comments`) uses keyset cursor pagination with filtering (`all`,
  `visible`, `hidden`), album narrowing, and search over body, display name, and author email
  (D67).

## Activity feed

- `GET /api/comments/feed` (and `GET /api/share/:token/comments` for shares) returns recent visible
  comments newest-first using cursor pagination (`COMMENTS_FEED_PAGE_SIZE = 30`), scoped strictly
  to albums or shares the caller can view (respecting `requireIdentity` and `allowComments`) (D82).
- The client tracks unread feed comments locally per scope so the Activity tab and mobile badge
  surface new conversations (`9+` cap) without extra server state.

## Per-user favourites

- Any session with read access to the album or share and a resolved `commenterId` (authenticated
  accounts and verified share visitors, regardless of `roleCommenter`) can star and unstar
  photographs via `PUT` and `DELETE /api/favorites/:albumId/:mediaId`, persisted in
  `commenter_favorites` per `(commenter_id, album_id, media_id)`.
- Unidentified callers receive `403 identity_required`; callers without access to the album or
  share receive `404`.
- Album detail (`Album.favoriteMediaIds`) and share payloads (`ShareView.favoriteMediaIds`) include
  the caller's starred media IDs so both album grids and share grids can toggle a "Favourites only"
  filter.

## Email notifications and subscriptions

- All outbound emails leave asynchronously through a serialised queue outside HTTP request paths;
  send failures are logged and dropped without retrying (D37).
- Opening page 1 of an album (`GET /api/albums/:albumId/items` without `?cursor=`) or accepting a
  member invitation automatically subscribes a verified identity to new-photo announcements for that
  album (`album_subscriptions`, `state = 'auto'`), while single-photo detail requests never
  subscribe (D41).
- Unsubscribing (`opted_out`) persists across subsequent album openings, and granular flags
  (`notify_photos`, `notify_comments`) on `commenters`, `album_subscriptions`, and
  `commenter_shares` control album announcements vs comment reply/discussion mails independently.
- Hourly sweep (`AlbumNotifier`) announces newly added photos only after an album or share has been
  quiet for at least one hour since its last sync/item addition; share-link subscribers
  (`commenter_shares`) receive `/s/<token>` deep links rather than `/album/<albumId>` links, and
  unassociated secret share tokens are never leaked in notifications.
- Every notification email is composed in the recipient's recorded `commenters.locale` (updated on
  application `fetch` requests, never overwritten by subresource `<img>` requests) and carries
  stateless HMAC-signed one-click unsubscribe links (`/api/comments/unsubscribe` and
  `/api/subscriptions/unsubscribe`) that work without signing in (D260812d, D260819c).
- When `moderationEmail` is set in settings, every new comment also notifies that address in
  `DEFAULT_LOCALE`.
