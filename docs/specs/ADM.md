---
code: ADM
status: done
version: v1.0
amended: [v1.1, v1.2, v1.3]
created: 2026-08-03
builds-on: ACC
---

# Lukarn — ADM specification

ADM covers the live administration console, database-authoritative configuration, instance branding
and shell rendering, bilingual internationalisation, and user preferences (`/settings`). It builds on
[ACC](ACC.md). It predates the spec delivery process, so it has no plans, and describes the
application as it stands.

## Live administration console

- `/admin` is restricted to administrators (`admin: true`; `/api/admin/*` returns `403` to
  non-admins). On desktop (`≥ md`), `/admin` redirects to `/admin/albums`; on phones (`< md`),
  `/admin` renders the grouped section directory (`Library`, `People`, `Instance`) with an unread
  badge on Comments (D66).
- `ADMIN_TABS` defines the eight sections in order: `storage`, `albums`, `shares`, `accounts`,
  `comments`, `identity`, `server`, and `visits`.
- SQLite is the single source of truth after initial bootstrap; all runtime mutations go through
  `ConfigRepo` (which invalidates its in-memory snapshot on write and detects external CLI edits via
  `PRAGMA data_version`) and take effect immediately without restarting the server (D24, D25).
- Each section manages its domain:
  - **Storage**: create, edit, test (`probe`), OAuth-connect/disconnect, and delete storage
    connections; shows `storageKinds` and `storageLocalRoot` reported by the server (D260816g).
  - **Albums**: create, edit (title, description, storage connection, folder, recursive flag, default
    `groupBy`/`sortOrder`, explicit cover photo), and delete albums; triggers background sync on
    creation or scope changes.
  - **Shares**: issue, search, inspect, edit, pause/revoke, restore, and delete share links (see
    [SHR](SHR.md)).
  - **Accounts**: list users with credential state badges (`shared_key`, `person`, `invited`,
    `no_way_in`), create/edit/delete users, toggle `admin`, `roleViewer`, `roleCommenter`, and
    album grants, invite or convert accounts by email, or generate copyable offline `/invite/:token`
    links when SMTP is absent.
  - **Comments**: moderate comment threads and bulk-hide/show by commenter.
  - **Identity**: edit instance name, accent brand colour, and custom logo.
  - **Server**: configure `syncIntervalMinutes`, `syncOnStartup`, `cacheMaxSizeGB`,
    `videoCacheMaxSizeGB`, `prewarmCache`, `transcodeVideos`, and `moderationEmail`; trigger manual
    resync or cache clear; view running Lukarn version and available release badge.
  - **Visits**: view privacy-preserving access-key and album visit counters across `7`/`30`/`90` day
    windows (D260809h).

## Branding and instance shell

- `instanceName` (seeded from `APP_NAME` only while no settings row exists) and `primaryColor`
  (`#rrggbb`, from which a full light/dark CSS palette is derived) are stored in `settings`
  (D260813, D260813c, D260813d).
- Uploading a custom logo (`PUT /api/admin/branding/logo`, 512 KB limit) rasterises any accepted
  image format—including SVG—via `sharp` into PNG assets under `DATA_DIR/branding/` so no
  user-supplied SVG document is ever served back from the application origin (D260813b).
- Updating `instanceName` or `primaryColor` invalidates the cached HTML shell and
  `manifest.webmanifest` templates immediately so subsequent navigations reflect the new identity
  without restarting; uploading or resetting the custom logo updates `BrandingStore` and clears
  derived icon variants (D260813c).

## Internationalisation

- All human-facing strings (web UI, HTTP error responses, emails, and unsubscribe pages) live in
  strictly typed English and French catalogues (`en` declares keys, `fr` is type-checked against
  them) (D260811b, D260812c).
- Request locale resolves from `Accept-Language` (stripping region subtags such as `fr-CA` → `fr`)
  and falls back to `DEFAULT_LOCALE` (`en`) when unsupported; formatters accept the active
  translator `t` so dates and counts match the reader's language (D260812d).
- Unaddressed UI controls use impersonal forms (French infinitives such as `Se connecter`), while
  emails and unsubscribe pages address the reader directly (`you` / `vous`).

## User settings (`/settings`)

- Authenticated accounts (and bound members) can open `/settings` to choose their browser-local
  language and theme (`light` / `dark`) (D260812d, D260815d).
- When the session carries a verified email identity, `/settings` also displays a **Profile** section
  to update `displayName` and toggle `notify` / `notifyPhotos` / `notifyComments` via
  `PATCH /api/auth/profile`.
