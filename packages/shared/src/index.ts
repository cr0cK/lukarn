/**
 * API contract shared by the Fastify server and React front end. Every payload shape
 * crossing the network is described here; the front end never redeclares response types.
 */

/**
 * Visual identity: the primary colour and everything derived from it. Re-exported
 * rather than left aside because the package has a single entry point, and both
 * ends import the palette from here like any other part of the contract.
 */
export * from './branding.js';

/** Thumbnail sizes the server accepts to generate. */
export const THUMB_SIZES = [320, 640, 1280] as const;
export type ThumbSize = (typeof THUMB_SIZES)[number];

export function isThumbSize(value: number): value is ThumbSize {
  return (THUMB_SIZES as readonly number[]).includes(value);
}

/**
 * Languages the interface, the emails and the server's messages are written in.
 *
 * Declared here rather than in the front end because both ends need the same list:
 * the browser announces its choice with `Accept-Language`, and the server composes
 * an email in the language the recipient reads. A locale absent from this list is
 * resolved back to `DEFAULT_LOCALE` rather than rejected — an unsupported language
 * must degrade to a readable page, never to an error.
 */
export const LOCALES = ['en', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Language used when nothing else answers: an unrecognised browser preference, or a
 * recipient who has never opened the gallery. English because it is the language the
 * repository itself is written in.
 */
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * The supported language behind a language tag: `fr-CA` reads as `fr`.
 *
 * Region is dropped deliberately. The gallery translates a language, not a variant,
 * and matching `fr-FR` exactly would leave a Swiss browser in English.
 */
export function resolveLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const base = tag.trim().toLowerCase().split('-')[0];
  return isLocale(base) ? base : null;
}

export type MediaKind = 'photo' | 'video';

/** Direction of an album's chronological sort. `desc` = newest first. */
export type SortOrder = 'desc' | 'asc';

/**
 * Grid grouping into sections. The served list does not change between groupings:
 * the server returns a sorted sequence and layout segments it. The album **preference**
 * (`Album.groupBy`) crosses the network, not the grouping of a request.
 *
 * No yearly grouping: a holiday album would produce one section and no landmark.
 */
export type GroupBy = 'month' | 'day';

export const DEFAULT_GROUP_BY: GroupBy = 'month';

export function isGroupBy(value: unknown): value is GroupBy {
  return value === 'month' || value === 'day';
}

/**
 * Direction used until something overrides it — the default for both
 * `albums.sort_order` and the API `?order=` parameter.
 *
 * `asc` because an album reads in the order it was lived: opening a trip on its last
 * day gives the ending before the beginning (D99).
 */
export const DEFAULT_SORT_ORDER: SortOrder = 'asc';

export function isSortOrder(value: unknown): value is SortOrder {
  return value === 'desc' || value === 'asc';
}

/**
 * Render variant served by the media pipeline. `hd` exists for zoom: `full` is capped
 * at 2560 px, enough to fill a screen but not inspect a photo at native resolution.
 */
export const IMAGE_VARIANTS = ['full', 'hd'] as const;
export type ImageVariant = (typeof IMAGE_VARIANTS)[number];

export interface MediaItem {
  id: string;
  albumId: string;
  name: string;
  kind: MediaKind;
  mimeType: string;
  /** Bytes. `null` for rare Drive files without a reported size. */
  size: number | null;
  width: number | null;
  height: number | null;
  /** ISO 8601. EXIF capture date when known, otherwise Drive modification date. */
  takenAt: string;
  /** `true` when `takenAt` comes from EXIF, `false` for the Drive fallback. */
  takenAtFromExif: boolean;
  /** Duration in milliseconds, for videos only. */
  durationMs: number | null;
  /**
   * `true` when the server can render an image for this media — the photo itself or
   * the preview Drive produces from a video's first second (D92).
   *
   * A capability, not a column: the front end requests a thumbnail "when available"
   * without duplicating the photo/video rule or requesting an image destined for 415
   * when Drive has no preview — an unusual codec or a file uploaded too recently.
   */
  hasPreview: boolean;
  /**
   * Short content fingerprint appended to media URLs.
   *
   * Drive retains a file ID when content is replaced by a new version: without this
   * discriminator in the URL, derivatives served as `immutable` would forever remain
   * from the old version. `null` for rare files without a fingerprint.
   */
  version: string | null;
  /**
   * Four-letter video-track codec — `avc1`, `hvc1`, `hev1` — as written in the file.
   *
   * `null` for a photo, a video whose header could not be read, and rows indexed before
   * the column existed. Empty string when the header was read without a recognised
   * video track.
   *
   * This lets the client choose its source: `canPlayType` on `video/mp4` alone returns
   * `maybe` everywhere and reveals nothing (D98); with the real codec, the answer is
   * decisive and an HEVC-capable browser keeps the full-quality original (D260809b).
   */
  videoCodec: string | null;
  /**
   * Manually written caption for this photo, `null` if nobody wrote one.
   *
   * Scoped to the **(album, media)** pair rather than the Drive file alone: one file
   * indexed under two albums has two descriptions, like its two comment threads —
   * isolation also applies to authored content (D12).
   *
   * It travels with the item rather than a grouped call like comment counts: the viewer
   * must display it on the newly reached photo, and the item list is already loaded (D83).
   */
  description: string | null;
}

export interface MediaExif {
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  isoSpeed: number | null;
  exposureTime: number | null;
  aperture: number | null;
  focalLength: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface MediaDetail extends MediaItem {
  exif: MediaExif;
  /**
   * Number of visible comments including replies. Served with details so the viewer
   * can show the count without loading the thread; most photos are viewed without
   * opening comments.
   */
  commentCount: number;
}

/** Absent field = unchanged, `null` = cleared. */
export interface UpdateMediaRequest {
  description?: string | null;
}

/**
 * Maximum photo-description length.
 *
 * Between the screen's other two text lengths for the same rendering reason: longer
 * than a day note (`ALBUM_DAY_DESCRIPTION_MAX_LENGTH`, 300), whose section heading
 * precalculates height without DOM (D49), and shorter than an album description
 * (`ALBUM_DESCRIPTION_MAX_LENGTH`, 2000) in a free paragraph. This sits on the photo:
 * expanded, it is capped at half the screen height, and beyond a thousand characters
 * it would stop being a caption and hide the image.
 */
export const MEDIA_DESCRIPTION_MAX_LENGTH = 1000;

export interface Album {
  id: string;
  title: string;
  description: string | null;
  /**
   * Grouping applied on opening until the URL overrides it. A trip reads by day and
   * ten years of children's photos by month: the right grouping depends on the album.
   */
  groupBy: GroupBy;
  /**
   * Reading order on opening until the URL or browser memory overrides it. A trip is
   * told first to last day, a current library by latest arrivals: order depends on
   * the album, not a global default (D99).
   */
  sortOrder: SortOrder;
  itemCount: number;
  /**
   * Media ID displayed as cover: the administrator's choice or the most recent photo
   * as fallback, including when the chosen photo left the index. `null` if empty.
   */
  coverId: string | null;
  /** Cover fingerprint appended to its URL. See `MediaItem.version`. */
  coverVersion: string | null;
  /** ISO 8601 chronological album bounds, `null` when empty. */
  newestAt: string | null;
  oldestAt: string | null;
  lastSyncAt: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
}

export type SyncStatus = 'never' | 'running' | 'ok' | 'error';

/**
 * Current session.
 *
 * `username` is an **access key**, not a person: a household may share one username.
 * `identity` identifies someone — self-declared and verified by email.
 */
export interface SessionUser {
  username: string;
  admin: boolean;
  /** `null` until someone identifies themselves in this session. */
  identity: CommenterIdentity | null;
  /**
   * `false` if the instance has no SMTP server: no verification code can be sent, so
   * nobody can identify themselves or comment. The interface must say so rather than
   * offer a form that will fail.
   */
  commentsEnabled: boolean;
}

/**
 * Commenter identity as seen by its holder. Present only after address verification:
 * an unverified identity is attached to no session.
 */
export interface CommenterIdentity {
  email: string;
  displayName: string;
  /** `false` after unsubscribing from a received email. */
  notify: boolean;
}

/** What is declared to identify oneself. The address then receives a code. */
export interface IdentityRequest {
  email: string;
  displayName: string;
}

export interface VerifyIdentityRequest {
  email: string;
  code: string;
}

/** Length of the emailed code. Six digits entered by hand. */
export const VERIFICATION_CODE_LENGTH = 6;

export interface LoginRequest {
  username: string;
  password: string;
}

/* --------------------------------------------------------------------------
 * Pairing a keyboardless screen
 *
 * A television has no camera: it displays the QR code and an already signed-in phone
 * scans it. Two opposite values circulate — one intended for the whole room to see,
 * the other never to be seen. See D260809c.
 * ------------------------------------------------------------------------ */

/**
 * Displayed-code alphabet. No `I`, `O`, `0` or `1`: it is read on a screen three
 * metres away and sometimes copied by hand onto a phone.
 */
export const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Eight characters from `USER_CODE_ALPHABET`, providing 40 bits. */
export const USER_CODE_LENGTH = 8;

/** What the requesting screen receives when opening a pairing request. */
export interface DevicePairingStart {
  /** The eight displayed characters without a separator. */
  userCode: string;
  /**
   * Requester secret returned **once**. It claims the session and is never displayed
   * or carried by the QR code.
   */
  deviceCode: string;
  expiresAt: string;
  /** Recommended polling interval in milliseconds. */
  intervalMs: number;
}

/** What the phone reads before approval. */
export interface DevicePairingState {
  userCode: string;
  expiresAt: string;
  /** True if someone already approved — state to report, not an error. */
  approved: boolean;
}

/**
 * Poll response. `pending` arrives as 202, `approved` as 200 with the session cookie:
 * HTTP status and discriminant express the same thing for intermediaries and callers.
 */
export type DevicePollResult = { status: 'pending' } | { status: 'approved'; user: SessionUser };

/**
 * Folds a typed or URL code into stored form: uppercase without separators. Without
 * folding, a screen code copied with its hyphen would match no request.
 */
export function normalizeUserCode(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

/** Readable code form, grouped by four: `ABCD-EFGH`. */
export function formatUserCode(value: string): string {
  const code = normalizeUserCode(value);
  return code.length <= 4 ? code : `${code.slice(0, 4)}-${code.slice(4)}`;
}

export interface ItemsPage {
  items: MediaItem[];
  /** Pass back as `?cursor=` for the next page. `null` = end of album. */
  nextCursor: string | null;
}

/* --------------------------------------------------------------------------
 * Album days
 *
 * A dated grid does not say what happened. A day may therefore carry a note and the
 * place already present in its photos' EXIF data.
 * ------------------------------------------------------------------------ */

/**
 * An annotated day. Served only for days with something to show — no need to carry
 * one empty row per album day.
 */
export interface AlbumDay {
  /** `YYYY-MM-DD` in UTC, the same key as day grouping in the grid. */
  day: string;
  description: string | null;
  /**
   * Manually entered place. **Takes precedence over `autoPlaces`**: it is a correction,
   * and one overwritten by recalculation would be useless.
   */
  place: string | null;
  /**
   * Places inferred from EXIF coordinates, earliest to latest in the day. Empty until
   * reverse geocoding returns something — it is asynchronous and the interface must
   * work without it.
   */
  autoPlaces: string[];
}

/** Absent field = unchanged, `null` = cleared. */
export interface UpdateAlbumDayRequest {
  description?: string | null;
  place?: string | null;
}

/**
 * A day note is a landmark, not a story: one truncated line in a section heading whose
 * height layout precalculates. Unbounded length would require DOM measurement (D49).
 * The full text appears in the viewer banner and expands on click (D85).
 */
export const ALBUM_DAY_DESCRIPTION_MAX_LENGTH = 300;
export const ALBUM_DAY_PLACE_MAX_LENGTH = 120;

/* --------------------------------------------------------------------------
 * Search
 *
 * Search returns a **navigable entity**, not a text excerpt: an album, day or photo.
 * "Marseille" must open the day in Marseille rather than the matching line — what
 * distinguishes search from `grep`.
 * ------------------------------------------------------------------------ */

/** Where a result leads. Also decides its display group. */
export type SearchHitKind = 'album' | 'day' | 'media';

/** A search result: enough to display and navigate to it. */
export interface SearchHit {
  kind: SearchHitKind;
  albumId: string;
  albumTitle: string;
  /** What appears in the list: album title, place or start of a note. */
  label: string;
  /**
   * The line below: context without repeating the label — an album description or the
   * note for a day already named by its place. `null` when the label is sufficient.
   *
   * Album name and date travel separately (`albumTitle`, `day`): `format.ts` displays
   * dates in UTC, and composing them here would fix them to the server time zone.
   */
  context: string | null;
  /** Target day, `YYYY-MM-DD`. Present for `kind: 'day'`. */
  day?: string;
  /** Target media. Present for `kind: 'media'`. */
  mediaId?: string;
}

/**
 * Below this, do not search: one prefix letter would return much of the library for
 * input that says almost nothing.
 */
export const SEARCH_MIN_LENGTH = 2;

/**
 * Results returned **per type**. This is a type-ahead suggestion, not a results page:
 * beyond the limit it no longer fits and the right answer is slower to find than by
 * refining the query.
 */
export const SEARCH_HITS_PER_KIND = 5;

/* --------------------------------------------------------------------------
 * Comments
 *
 * One thread per media *and album*: the same Drive file indexed under two albums has
 * two distinct conversations. See `specs/04-security-and-access.md`.
 * ------------------------------------------------------------------------ */

/**
 * Comment author reduced to what display requires.
 *
 * **The email address is absent and must remain absent**: it identifies and notifies,
 * but must not be disclosed to other thread readers.
 */
export interface CommentAuthor {
  /** Self-declared name verified by email. Never empty. */
  displayName: string;
}

export interface Comment {
  id: number;
  /** `null` for a top-level comment, otherwise the thread-root ID. */
  parentId: number | null;
  author: CommentAuthor;
  body: string;
  createdAt: string;
  /**
   * `true` when the current reader may delete the comment — their own, or any comment
   * for an administrator. Calculated by the server so the front end need not duplicate
   * the authorisation rule.
   */
  canDelete: boolean;
  /**
   * `true` if the server would accept an edit **when it returned this response**: the
   * reader is its author and `COMMENT_EDIT_WINDOW_MS` has not elapsed.
   *
   * Unlike `canDelete`, this value **expires by itself**. The front end must compare it
   * with `createdAt` rather than trust it alone: a thread open for an hour would still
   * carry `true`.
   */
  canEdit: boolean;
}

/**
 * A root comment and its replies. Hierarchy stops there: replying to a reply attaches
 * the message to the thread root (see D35).
 */
export interface CommentThread {
  root: Comment;
  replies: Comment[];
}

export interface CommentsPage {
  threads: CommentThread[];
  /** Visible total including replies — what the panel counter displays. */
  total: number;
}

export interface CreateCommentRequest {
  body: string;
  /** Reply to this comment. Absent or `null` to open a new thread. */
  parentId?: number | null;
}

/**
 * Visible comment counts per photo across a whole album.
 *
 * Served in one block rather than per photo: the viewer must badge the newly reached
 * photo, and requesting this count on every arrow would cost one request per photo.
 *
 * Only commented photos appear in `counts`: for thousands of views with ten threads,
 * the response remains a few hundred bytes. An absent photo therefore means zero.
 */
export interface AlbumCommentCounts {
  counts: Record<string, number>;
}

/** What is returned to edit a comment. Its thread does not change. */
export interface UpdateCommentRequest {
  body: string;
}

/**
 * A comment shown outside its photo in the activity feed.
 *
 * A conversation is not discovered by randomly opening the right photo among
 * thousands. Hence context accompanies the message; otherwise the list says someone
 * wrote, never where.
 */
export interface FeedComment extends Comment {
  albumId: string;
  albumTitle: string;
  mediaId: string;
  /**
   * `null` if the photo has left the index. The message remains readable — deleting it
   * with its missing medium would erase words nobody chose to remove — but has no
   * thumbnail or link.
   */
  mediaName: string | null;
  /** Photo fingerprint appended to its thumbnail URL. See `MediaItem.version`. */
  mediaVersion: string | null;
}

/**
 * One activity-feed page, newest to oldest.
 *
 * The cursor is a comment ID, as in moderation: `AUTOINCREMENT` makes ID order match
 * insertion order, avoiding the composite cursor needed by media pagination.
 *
 * No `total`, unlike `AdminCommentsPage`: this shows what just arrived rather than
 * moderating. Counting the whole visible corpus would cost a second query for an
 * unread number.
 */
export interface CommentsFeedPage {
  comments: FeedComment[];
  nextCursor: string | null;
}

/**
 * Activity-feed page size.
 *
 * Large enough for the unread badge, capped at "9+", to be decided from the first
 * page alone — otherwise returning after a long absence would show "9+" then a lower
 * number while scrolling.
 */
export const COMMENTS_FEED_PAGE_SIZE = 30;

/**
 * Time during which an author may edit a comment.
 *
 * A typo-recovery window, not an editing right: long enough to reread what was sent,
 * too short to rewrite a conversation others already read (D57).
 */
export const COMMENT_EDIT_WINDOW_MS = 30_000;

/**
 * Milliseconds remaining to edit, `0` after the window closes.
 *
 * Shared because both sides must decide **identically**: the server refuses while the
 * front end stops offering. Separate calculations would diverge by a second, exactly
 * where someone clicks a button that says no.
 */
export function remainingEditMs(createdAt: string, now: number): number {
  const started = Date.parse(createdAt);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, started + COMMENT_EDIT_WINDOW_MS - now);
}

/** Maximum comment length, checked identically on both sides. */
export const COMMENT_MAX_LENGTH = 2000;

/* --------------------------------------------------------------------------
 * What this instance runs, and whether something newer exists
 * ------------------------------------------------------------------------ */

/** A published release: the version it carries, and the page announcing it. */
export interface ReleaseRef {
  /** Version without its `v` prefix, as `1.2.3`. */
  version: string;
  /** Release page, where its notes are published. */
  url: string;
}

/**
 * What `/api/version` answers: what is running, where to read what changed, and —
 * for an administrator — whether a newer release exists.
 *
 * `update` is deliberately the **only** field that costs a network call, and it is
 * `null` for everyone who could do nothing with it: an access key cannot update the
 * machine, so nothing asks GitHub on its behalf (D260815).
 */
export interface VersionInfo {
  /** Version this instance runs. `dev` for anything built outside a release. */
  version: string;
  /** The whole changelog, every version, including the one being offered. */
  changelogUrl: string;
  /** A newer release, or `null` — up to date, check disabled, unknown, not an admin. */
  update: ReleaseRef | null;
}

/* --------------------------------------------------------------------------
 * Storage connections
 *
 * Where the albums live. One instance may read several — a Drive and a bucket —
 * and every album names the one it belongs to.
 * ------------------------------------------------------------------------ */

/** A backend this application knows how to read. */
export type StorageKind = 'drive' | 'local' | 's3' | 'webdav';

/**
 * How a connection is authorised, which is what decides the controls /admin offers.
 *
 * - `consent` — a button starts an OAuth flow and the backend hands back a token.
 * - `key` — the environment already holds it; there is nothing to connect or revoke,
 *   only an address to share the folder with (D46).
 * - `settings` — an endpoint and a secret typed into the form itself.
 */
export type StorageAuthorization = 'consent' | 'key' | 'settings';

/** A connection as /admin displays it. Never carries a secret, under any key. */
export interface StorageConnectionStatus {
  /** Slug, written into every album that reads this storage. */
  id: string;
  kind: StorageKind;
  label: string;
  /** What names it to a person: an address, a bucket, a URL. */
  account: string | null;
  /** `true` when this storage can serve bytes right now. */
  connected: boolean;
  /**
   * ISO 8601 if the backend stopped accepting the stored secret, otherwise `null`.
   * Distinct from never connected: authorisation existed and is no longer valid.
   */
  revokedAt: string | null;
  authorization: StorageAuthorization;
  /**
   * Backend settings as stored, so an edit form can show what a connection reads
   * rather than asking for it again. Safe to return and deliberately so — an
   * endpoint, a bucket, a folder give access to nothing on their own, which is why
   * they are stored in the clear. The secret half never leaves the server.
   */
  settings: Record<string, string>;
  /** Albums reading it. A connection with albums cannot be deleted. */
  albumCount: number;
  createdAt: string;
}

export interface CreateStorageRequest {
  /**
   * Slug this connection is stored under. **Optional**: /admin no longer asks for
   * one, and the server derives it from the label, suffixing it when taken
   * (D260816h). Sending one keeps the old behaviour, conflict included.
   */
  id?: string;
  kind: StorageKind;
  label: string;
  /** Backend settings, nothing secret: an endpoint, a bucket, a root. */
  settings?: Record<string, string>;
  /** The secret half, encrypted before it is stored. */
  secret?: string;
}

export interface UpdateStorageRequest {
  label?: string;
  settings?: Record<string, string>;
  /** `null` forgets the stored secret; absent leaves it untouched. */
  secret?: string | null;
}

/** What `POST /api/admin/storage/:id/test` answers: does this connection work? */
export interface StorageProbeResult {
  ok: boolean;
  account: string | null;
  /** The backend's own words when it does not — a wrong key, an unreachable host. */
  error: string | null;
}

export interface AdminStatus {
  /**
   * Every storage this instance reads, in the order they were added. Replaces the four
   * `drive*` fields of 1.1: an instance may now read several, and an album names which.
   */
  storage: StorageConnectionStatus[];
  /**
   * Kinds this build can create, in the order the form offers them. Reported rather
   * than hard-coded in the interface: a kind the server cannot build must not be
   * offered in a form, and the two lists would drift the day one arrives.
   */
  storageKinds: StorageKind[];
  /**
   * The directory a `local` connection may read inside, or `null` when
   * `STORAGE_LOCAL_ROOT` is unset. Reported so the folder field can name it: that
   * field holds a path relative to this value, and a relative path measured against
   * something the screen never shows is a path typed blind (D260816d).
   */
  storageLocalRoot: string | null;
  /**
   * `true` if either Google authentication path is configured. An environment fact
   * rather than a per-connection one: without it, no Drive connection can be
   * authorised at all, and /admin says so once instead of on every row.
   */
  oauthConfigured: boolean;
  albums: Album[];
  cache: {
    entryCount: number;
    bytes: number;
    maxBytes: number;
  };
  /** Hidden comments, used to signal the moderation queue without opening it. */
  hiddenComments: number;
  /**
   * `true` if SMTP_URL and MAIL_FROM are configured. Otherwise entering an address
   * produces nothing, and administration must say so rather than imply notifications
   * will be sent.
   */
  mailConfigured: boolean;
  /**
   * `true` when an operator has uploaded a logo, `false` while the built-in mark is
   * in force. Reported rather than inferred from the image: both are served at the
   * same URL, so nothing in the picture says which one it is — and "back to the
   * built-in mark" must only be offered when there is something to go back from.
   */
  logoCustom: boolean;
}

export interface ApiError {
  error: string;
  message: string;
}

/* --------------------------------------------------------------------------
 * Administration: accounts, albums and settings
 *
 * These objects are administered from the application and live in the database.
 * `config/albums.yaml` only bootstraps a new installation and is never read again once
 * the database is populated.
 * ------------------------------------------------------------------------ */

/** The `*` wildcard grants access to all present and future albums. */
export const ALL_ALBUMS = '*';

/**
 * An access key. It opens albums and may be shared by several people: no email address
 * is attached; addresses belong to commenter identities.
 */
export interface AdminUser {
  username: string;
  admin: boolean;
  /** List of album IDs, or `['*']`. */
  albums: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  admin?: boolean;
  albums?: string[];
}

/** Omitted fields = unchanged. An absent `password` retains the password. */
export interface UpdateUserRequest {
  password?: string;
  admin?: boolean;
  albums?: string[];
}

export interface AdminAlbum {
  id: string;
  title: string;
  description: string | null;
  /** The storage connection this album reads. */
  connectionId: string;
  folderId: string;
  recursive: boolean;
  /** Grouping applied when the album opens. See `Album.groupBy`. */
  groupBy: GroupBy;
  /** Reading order applied when the album opens. See `Album.sortOrder`. */
  sortOrder: SortOrder;
  /** Indexed-media count and latest synchronisation state. */
  itemCount: number;
  lastSyncAt: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  /** Accounts with explicit access, excluding wildcard holders. */
  members: string[];
  /**
   * Photo **chosen** as cover, `null` for the automatic latest photo. Distinct from
   * `Album.coverId`, the cover actually served: that falls back to automatic when the
   * choice is no longer indexed without erasing the choice.
   */
  coverId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAlbumRequest {
  id: string;
  title: string;
  description?: string;
  /** Omitted means the instance's first connection — what a single-storage instance has. */
  connectionId?: string;
  folderId: string;
  recursive?: boolean;
  groupBy?: GroupBy;
  sortOrder?: SortOrder;
}

export interface UpdateAlbumRequest {
  title?: string;
  description?: string | null;
  /** Changing it purges the index, exactly like changing the container (D26). */
  connectionId?: string;
  folderId?: string;
  recursive?: boolean;
  groupBy?: GroupBy;
  sortOrder?: SortOrder;
  /**
   * Photo to display as cover. It must be indexed in this album and not be a video.
   * `null` restores automatic selection.
   */
  coverId?: string | null;
}

/**
 * Maximum album-description length.
 *
 * Much longer than a day note (`ALBUM_DAY_DESCRIPTION_MAX_LENGTH`) for a rendering
 * reason: the note lives in a heading whose height layout precalculates without DOM,
 * while an album description is a free paragraph with no fixed height (D49).
 */
export const ALBUM_DESCRIPTION_MAX_LENGTH = 2000;

export interface AppSettings {
  /**
   * Displayed instance name: browser tab, sign-in screen and, above all, the label
   * under the icon once the application is installed.
   *
   * A setting rather than an environment variable (D260813c): whoever names their
   * gallery is already in /admin, and renaming it should not mean opening a shell.
   * `APP_NAME` still seeds this value while nothing has been saved, exactly as
   * `config/albums.yaml` seeds accounts (D24).
   */
  instanceName: string;
  /**
   * Instance colour as `#rrggbb`. It drives the mark's dot, filled buttons, the
   * active tab border and a softer derived hover — see `derivePalette`.
   */
  primaryColor: string;
  /** Minutes between automatic synchronisations. 0 to disable. */
  syncIntervalMinutes: number;
  syncOnStartup: boolean;
  cacheMaxSizeGB: number;
  /**
   * Renders photos in the background before they are opened. Reduces first opening
   * from seconds to milliseconds at the cost of early Drive downloads.
   */
  prewarmCache: boolean;
  /**
   * Prepares a playable version of videos whose codec no current browser decodes. One
   * video at a time in the background at low priority: around one CPU minute per film
   * minute (D260809b). Without `ffmpeg`, the setting has no effect.
   */
  transcodeVideos: boolean;
  /**
   * Space for playable video versions, separate from thumbnails. Two budgets because
   * their costs differ: a thumbnail takes seconds to recreate, a video several CPU
   * minutes — shared LRU would let grid browsing evict an hour of work (D260809b).
   */
  videoCacheMaxSizeGB: number;
  /**
   * Address notified of every new comment. `null` to notify none.
   *
   * An instance setting rather than an account column: an administrator account is an
   * access key, not a reachable person, and the instance has one owner.
   */
  moderationEmail: string | null;
}

export type UpdateSettingsRequest = Partial<AppSettings>;

/**
 * Comment viewed in moderation: visitors read a thread on a photo in front of them;
 * administrators scan every album and need to know which photo is discussed.
 */
export interface AdminComment extends Comment {
  albumId: string;
  albumTitle: string;
  mediaId: string;
  /** Drive file name, or `null` if the media has since left the index. */
  mediaName: string | null;
  /**
   * Author's verified address. Visible **only here**: moderation needs to know who is
   * behind a declared name; the thread does not.
   */
  authorEmail: string;
  /**
   * Author identity targeted by bulk moderation. Absent from `Comment` for the same
   * reason as `authorEmail`: a public thread must not identify a person with a stable
   * key that links their messages across albums.
   */
  commenterId: number;
  /**
   * Access key used to write, `null` if since deleted. This is changed when a shared
   * password has circulated too widely.
   */
  account: string | null;
  /** ISO 8601 hiding time, `null` if the comment is visible. */
  hiddenAt: string | null;
  /** Administrator who hid it. On a multi-admin instance, this identifies whom to ask. */
  hiddenBy: string | null;
}

/**
 * What the moderation queue requests: everything, what remains visible, or what was
 * removed. The latter two partition the first.
 */
export type ModerationFilter = 'all' | 'visible' | 'hidden';

/** What the moderation queue can narrow beyond the filter. */
export interface ModerationQuery {
  filter: ModerationFilter;
  /** Restricted to one album, `null` for all. */
  albumId: string | null;
  /** Searched in body, declared name and address. `null` for no search. */
  q: string | null;
  limit: number;
  /** Identifier of the previous page's last row. `null` for the first page. */
  cursor: number | null;
}

export interface AdminCommentsPage {
  comments: AdminComment[];
  /** Pass back as `?cursor=`. `null` = end of list. */
  nextCursor: string | null;
  /**
   * Comments retained by the filter, **excluding the cursor**: corpus size, not the
   * remainder. Without it, a page cannot say whether it contains everything to
   * moderate or is the hundredth page.
   */
  total: number;
}

/** Bulk moderation result: the number of messages actually affected. */
export interface BulkModerationResult {
  affected: number;
}

/* --------------------------------------------------------------------------
 * Visit telemetry
 *
 * Measured server-side and aggregated on write: one row per (album, key, session, day)
 * with counters (D260809h). Because access is authenticated by key, only the instance
 * knows *who* views — a third-party tracker would see only an anonymous browser.
 * ------------------------------------------------------------------------ */

/**
 * Device class inferred from the user-agent when the session is created, **then
 * discarded**: only the class remains. One of four values cannot re-identify anyone,
 * whereas a complete user-agent is a fingerprint.
 */
export type DeviceKind = 'mobile' | 'tablette' | 'ordinateur' | 'tv';

/** What an access key did during the requested window. */
export interface VisitorRow {
  /** The access key, not a person: it may be shared (D38). */
  username: string;
  /** Visits from the administration key are shown, not excluded. */
  admin: boolean;
  /** Device classes seen across sessions opened with this key. */
  devices: DeviceKind[];
  /** Latest album opening, `null` if the key signed in without opening anything. */
  lastAt: string | null;
  /** Latest request received from this key, to the nearest hour. */
  lastSeenAt: string | null;
  /** Distinct days on which something was opened. */
  days: number;
  /** Distinct sessions, meaning distinct browsers. */
  sessions: number;
  albums: number;
  visits: number;
  photos: number;
}

/** What an album received during the requested window. */
export interface AlbumVisitRow {
  albumId: string;
  /** `null` if the album was since deleted: its past visits remain real. */
  title: string | null;
  /** Distinct sessions — the best approximation of a visitor. */
  visitors: number;
  /** Distinct access keys. Always ≤ `visitors`, since a key may be shared. */
  keys: number;
  visits: number;
  photos: number;
  lastAt: string;
}

export interface VisitsOverview {
  /** Window width as retained by the server. */
  days: number;
  /** First counted day, `YYYY-MM-DD` in UTC. */
  since: string;
  visitors: VisitorRow[];
  albums: AlbumVisitRow[];
}

/** Windows offered by the "Visits" tab. */
export const VISIT_WINDOWS = [7, 30, 90] as const;

/** Default for `GET /api/admin/visits` and its accepted upper bound. */
export const VISIT_WINDOW_DEFAULT = 30;
export const VISIT_WINDOW_MAX = 365;

/** Input constraints shared for identical validation on both sides. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
export const USERNAME_MAX_LENGTH = 64;
export const ALBUM_ID_PATTERN = USERNAME_PATTERN;
export const PASSWORD_MIN_LENGTH = 8;
export const DISPLAY_NAME_MAX_LENGTH = 64;
/** Maximum address length as specified by RFC 5321. */
export const EMAIL_MAX_LENGTH = 254;

/**
 * Derives an identifier from what a person typed — an album title, a storage name.
 * No accents and no spaces: the result is read from an album URL and from a
 * `connection_id` in a log line.
 *
 * Shared rather than owned by the form because the server derives a storage
 * connection's identifier with it (D260816h). A slug previewed by one
 * implementation and stored by another would eventually disagree, and the
 * identifier of a connection never changes afterwards.
 *
 * May return an empty string: a title made only of emoji or punctuation slugifies
 * to nothing, and whoever calls this decides what to do about it — a form asks
 * again, the storage route falls back.
 */
export function slugifyAlbumId(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, USERNAME_MAX_LENGTH);
}
