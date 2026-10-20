import {
  ALL_ALBUMS,
  DEFAULT_GROUP_BY,
  DEFAULT_INSTANCE_NAME,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SORT_ORDER,
  HEX_COLOR_PATTERN,
  INSTANCE_NAME_MAX_LENGTH,
  normalizeHexColor,
  type AccountState,
  type AdminUser,
  type AppSettings,
  type GroupBy,
  type Locale,
  type SortOrder,
} from '@lukarn/shared';
import { z } from 'zod';
import { CommenterRepo, type StoredCommenter } from './commenters.js';
import { hasNoPassword, NO_PASSWORD_HASH } from './crypto.js';
import type { Db } from './db.js';
import { DEFAULT_CONNECTION_ID } from './storage/connections.js';
import type { MintFailure, VerificationCodeRepo } from './verification-codes.js';

/**
 * Repository of accounts, albums and settings — the application configuration,
 * administered from the application itself.
 *
 * Everything passes through here: this is the sole writer of `users`, `albums`,
 * `user_albums` and `settings`, making the in-memory cache below safe.
 *
 * **Why a cache.** `canSee()` is called on every media request, meaning every thumbnail
 * in a grid of several hundred tiles. One SQL query per thumbnail would be a clear
 * regression from the in-memory configuration being replaced. The snapshot is rebuilt
 * on the first read following a write, never during the write.
 *
 * **Binding an account to a person writes three further tables**, and that exception
 * is deliberate: creating an invitation, consuming one and unbinding are each one
 * transaction, and the snapshot must be rebuilt once that transaction has committed.
 * A second owner would mean either a second transaction or an invalidation from
 * inside this one, and `PRAGMA data_version` does not move for a write on this
 * connection, so nothing would notice. The rule followed inside them: borrow the
 * repository that carries rules — `CommenterRepo` for the rename D42 holds back,
 * `VerificationCodeRepo` for the code itself — and write the statement where it is
 * only a statement, which is what closing sessions and forgetting paired screens are.
 */

/** Album as stored. A superset of what synchronisation needs. */
export interface StoredAlbum {
  id: string;
  title: string;
  description: string | null;
  /** Which storage connection this album reads. Never empty — see migration 17. */
  connectionId: string;
  folderId: string;
  recursive: boolean;
  /** Grid grouping on opening. A preference, not a constraint. */
  groupBy: GroupBy;
  /**
   * Reading order on opening. Also a preference: the URL and browser memory take
   * precedence.
   */
  sortOrder: SortOrder;
  /**
   * Media chosen as the cover, `null` to use the most recent automatically. This is
   * only the choice: the cover actually served is calculated by `MediaRepo.stats`,
   * which falls back to automatic if the photo has left the index.
   */
  coverMediaId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Account as stored, including its hash — never serialise it as-is. */
export interface StoredUser {
  username: string;
  displayName: string;
  passwordHash: string;
  admin: boolean;
  roleViewer: boolean;
  roleCommenter: boolean;
  /** `*` wildcard: access to every album, including ones created later. */
  allAlbums: boolean;
  /** Explicitly assigned album IDs, excluding the wildcard. */
  albums: string[];
  /** Shared link tokens associated via `commenter_shares`. */
  shareTokens: string[];
  /**
   * The commenter record backing this account (`email = NULL` for password-only
   * accounts, or a verified email address when bound), or `null` while an email-only
   * invitation is still unconsumed.
   */
  commenterId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  username: string;
  displayName?: string;
  passwordHash: string;
  admin: boolean;
  roleViewer?: boolean;
  roleCommenter?: boolean;
  /** Album IDs, or a list containing `'*'` for the wildcard. */
  albums: string[];
  email?: string | null;
  shareTokens?: string[];
  commenterId?: number | null;
}

export interface UpdateUserInput {
  displayName?: string;
  passwordHash?: string;
  admin?: boolean;
  roleViewer?: boolean;
  roleCommenter?: boolean;
  albums?: string[];
  email?: string | null;
  notifyPhotos?: boolean;
  notifyComments?: boolean;
  shareTokens?: string[];
}

export interface CreateAlbumInput {
  id: string;
  title: string;
  description?: string | null;
  /** When omitted, the connection every album read before there were several. */
  connectionId?: string;
  folderId: string;
  recursive: boolean;
  /** When omitted, uses the shared default — month. */
  groupBy?: GroupBy;
  /** When omitted, uses the shared default — oldest first. */
  sortOrder?: SortOrder;
}

export interface UpdateAlbumInput {
  title?: string;
  description?: string | null;
  connectionId?: string;
  folderId?: string;
  recursive?: boolean;
  groupBy?: GroupBy;
  sortOrder?: SortOrder;
  /** `null` returns the cover to automatic selection. */
  coverMediaId?: string | null;
}

/**
 * Values applied while no settings have been saved.
 *
 * A function rather than a constant because one of them comes from outside: the
 * instance name is seeded by `APP_NAME` and only by it, the same way
 * `config/albums.yaml` seeds accounts and is never read again (D260813c). Everything
 * else is a judgement this repository makes.
 */
export function defaultSettings(instanceName: string): AppSettings {
  return {
    instanceName,
    primaryColor: DEFAULT_PRIMARY_COLOR,
    syncIntervalMinutes: 30,
    syncOnStartup: true,
    cacheMaxSizeGB: 20,
    prewarmCache: true,
    transcodeVideos: true,
    // Five gigabytes, around three hours of transcoded 1080p: enough to cover several
    // holiday albums. One tenth of the thumbnail budget because a library holds far
    // more photos than films.
    videoCacheMaxSizeGB: 5,
    moderationEmail: null,
  };
}

const settingsSchema = z.object({
  instanceName: z.string().trim().min(1).max(INSTANCE_NAME_MAX_LENGTH),
  primaryColor: z.string().regex(HEX_COLOR_PATTERN),
  syncIntervalMinutes: z.number().int().min(0),
  syncOnStartup: z.boolean(),
  cacheMaxSizeGB: z.number().positive(),
  prewarmCache: z.boolean(),
  transcodeVideos: z.boolean(),
  videoCacheMaxSizeGB: z.number().positive(),
  moderationEmail: z.string().nullable(),
});

interface AlbumRow {
  id: string;
  title: string;
  description: string | null;
  connection_id: string;
  folder_id: string;
  recursive: number;
  group_by: GroupBy;
  sort_order: SortOrder;
  cover_media_id: string | null;
  created_at: string;
  updated_at: string;
}

interface UserRow {
  username: string;
  display_name: string;
  password_hash: string;
  admin: number;
  role_viewer: number;
  role_commenter: number;
  all_albums: number;
  commenter_id: number | null;
  created_at: string;
  updated_at: string;
}

/** In-memory configuration view, rebuilt after each write. */
interface Snapshot {
  albums: StoredAlbum[];
  albumsById: Map<string, StoredAlbum>;
  /** Lower-case key: sign-in is case-insensitive. */
  users: Map<string, StoredUser>;
  /** Same key, with a set of IDs for constant-time `canSee`. */
  granted: Map<string, Set<string>>;
  /** Whole albums granted via active shares in `commenter_shares`, mapped to max expiry ms. */
  sharedAlbums: Map<string, Map<string, number>>;
  /** Whether the user has a verified email on their linked `commenters` row. */
  hasVerifiedEmail: Map<string, boolean>;
  settings: AppSettings;
}

function toAlbum(row: AlbumRow): StoredAlbum {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    connectionId: row.connection_id,
    folderId: row.folder_id,
    recursive: row.recursive === 1,
    groupBy: row.group_by,
    sortOrder: row.sort_order,
    coverMediaId: row.cover_media_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * API shape: the wildcard becomes `['*']` again, the hash disappears, and the two
 * things a snapshot row cannot say are looked up — who this account is, and what
 * invitation is still open on it.
 *
 * The reserved hash never leaves the server. `state` is the conclusion drawn from it
 * here, so that no client ever compares a hash of its own.
 *
 * The repositories are passed rather than held: this is a projection run once per row
 * of the account list, and neither lookup belongs on the `canSee()` path the snapshot
 * exists for.
 */
export function toAdminUser(
  user: StoredUser,
  codes: VerificationCodeRepo,
  commenters: CommenterRepo,
): AdminUser {
  const commenter = user.commenterId === null ? null : commenters.byId(user.commenterId);
  const hasBoundEmail =
    commenter !== null && commenter.email !== null && commenter.verifiedAt !== null;
  const pending = codes.pendingInvite(user.username);

  return {
    username: user.username,
    displayName: user.displayName,
    admin: user.admin,
    roleViewer: user.roleViewer,
    roleCommenter: user.roleCommenter,
    email: commenter?.email ?? null,
    hasPassword: !hasNoPassword(user.passwordHash),
    notifyPhotos: commenter?.notifyPhotos ?? true,
    notifyComments: commenter?.notifyComments ?? true,
    albums: user.allAlbums ? [ALL_ALBUMS] : [...user.albums],
    shareTokens: [...user.shareTokens],
    identity: hasBoundEmail
      ? { email: commenter.email!, displayName: commenter.displayName }
      : null,
    invitation: pending ? { email: pending.target, expiresAt: pending.expiresAt } : null,
    state: accountState(user, hasBoundEmail, pending !== null),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * How the account is entered today, which is not always what is in flight on it.
 *
 * A conversion keeps its real password until the code is consumed, so an invitation
 * to convert that nobody takes up leaves a working shared key exactly as it was —
 * `state` says `shared_key` and `invitation` says an invitation is also waiting. The
 * expired one is already gone from `pendingInvite`, which is what turns an account
 * created by address into one with no way in.
 */
function accountState(user: StoredUser, bound: boolean, invited: boolean): AccountState {
  if (bound) return 'person';
  if (!hasNoPassword(user.passwordHash)) return 'shared_key';
  return invited ? 'invited' : 'no_way_in';
}

/** What creating an account by address needs: the account, and where to invite it. */
export interface CreateInvitedUserInput {
  username: string;
  displayName?: string;
  admin: boolean;
  roleViewer?: boolean;
  roleCommenter?: boolean;
  /** Album IDs, or a list containing `'*'` for the wildcard. */
  albums: string[];
  /** The address the invitation goes to. Nothing is written to `commenters` yet. */
  email: string;
  /** Optional password hash if the user is given both a password and an email invitation. */
  passwordHash?: string;
  /** Share link tokens to pre-attach. */
  shareTokens?: string[];
  /**
   * Language the invitation is written in, chosen by whoever invites. Omitted when
   * nobody chose one, and the instance default then applies to this message and to
   * every later one until its recipient's browser announces theirs.
   */
  locale?: Locale;
}

/**
 * The account and the digits to send it, or the refusal that left neither behind.
 *
 * The code is returned once, to the caller that will put it in an email — nothing
 * reads it back afterwards.
 */
export type CreateInvitedUserResult =
  { user: StoredUser; code: string } | { failure: MintFailure; retryAfterMs: number };

/** What consuming an invitation needs, once its code has been checked. */
export interface ConsumeInvitationInput {
  /** The account the invitation named. */
  username: string;
  /** The address whose control has just been proved. */
  email: string;
  /**
   * Name for an identity this instance does not know, or knows without having
   * verified it. Ignored for an already verified one: somebody's name is theirs to
   * give, and a name arriving here must never rename them (D42).
   */
  displayName?: string;
  /**
   * Language the invitation was written in, read from the code row that has just
   * been proved. It seeds the identity when that identity carries none.
   */
  locale?: Locale | null;
}

/**
 * Rollback signal for an invitation that could not be minted.
 *
 * Thrown rather than returned because `better-sqlite3` commits a transaction whose
 * function returns: the account must leave with the invitation, or an address typed
 * one minute too early leaves a sentinel account nobody invited and nobody can enter.
 */
class InvitationRefused extends Error {
  constructor(readonly refusal: { failure: MintFailure; retryAfterMs: number }) {
    super(`Invitation refused: ${refusal.failure}`);
  }
}

export class ConfigRepo {
  private snapshot: Snapshot | null = null;
  /** Last observed value of `PRAGMA data_version`. See `read()`. */
  private dataVersion = -1;

  /**
   * Identity writes made inside the transactions below. Constructed here rather than
   * received: it needs this connection and nothing else, and the rename it holds back
   * until proof (D42) must be applied by its own code rather than reimplemented.
   */
  private readonly identities: CommenterRepo;

  /**
   * `instanceName` is the value `APP_NAME` seeds while nothing has been saved. It is
   * a default, not a source of truth: once someone renames the gallery from /admin,
   * the environment variable no longer says anything (D260813c). Command-line tools
   * construct this without one — they never render a page.
   */
  constructor(
    private readonly db: Db,
    private readonly instanceName: string = DEFAULT_INSTANCE_NAME,
  ) {
    this.identities = new CommenterRepo(db);
  }

  /* -------------------------------------------------------------------- reading */

  /** All albums in display order (creation rank). */
  albums(): StoredAlbum[] {
    return this.read().albums;
  }

  album(albumId: string): StoredAlbum | undefined {
    return this.read().albumsById.get(albumId);
  }

  /** Case-insensitive lookup: sign-in must not depend on capitalisation. */
  user(username: string): StoredUser | undefined {
    return this.read().users.get(username.toLowerCase());
  }

  users(): StoredUser[] {
    return [...this.read().users.values()];
  }

  /**
   * The account bound to this address, or `undefined` when no account is that person.
   *
   * This is the one lookup here that queries SQLite rather than the snapshot: it runs
   * once per sign-in, while the snapshot exists for `canSee()`, which runs once per
   * thumbnail. Carrying addresses in memory would enlarge that snapshot for a path
   * that is asked a few times a day.
   */
  userForEmail(email: string): StoredUser | undefined {
    const row = this.db
      .prepare(
        `SELECT u.username AS username
           FROM users u JOIN commenters c ON c.id = u.commenter_id
          WHERE c.email = ?`,
      )
      .get(email.trim()) as { username: string } | undefined;
    return row ? this.user(row.username) : undefined;
  }

  userByCommenterId(commenterId: number): StoredUser | undefined {
    const row = this.db
      .prepare('SELECT username FROM users WHERE commenter_id = ?')
      .get(commenterId) as { username: string } | undefined;
    return row ? this.user(row.username) : undefined;
  }

  /**
   * Whether the account was auto-created solely for a share-link visitor (`ensureUserForCommenter`)
   * with no password, no admin role, and no direct album permissions.
   */
  isShareVisitorAccount(username: string): boolean {
    const u = this.user(username);
    if (!u || u.commenterId === null) return false;
    if (!hasNoPassword(u.passwordHash) || u.admin || u.allAlbums || u.albums.length > 0) {
      return false;
    }
    const hasShare = this.db
      .prepare('SELECT 1 FROM commenter_shares WHERE commenter_id = ? LIMIT 1')
      .get(u.commenterId);
    return hasShare !== undefined;
  }

  /** Albums visible to this account, in display order. */
  albumsFor(username: string): StoredAlbum[] {
    const snapshot = this.read();
    const key = username.toLowerCase();
    const user = snapshot.users.get(key);
    if (!user) return [];
    if (!user.roleViewer && !user.admin) return [];
    if (user.allAlbums) return snapshot.albums;
    const granted = snapshot.granted.get(key);
    const shared = snapshot.sharedAlbums.get(key);
    const nowMs = Date.now();
    return snapshot.albums.filter((album) => {
      if (granted?.has(album.id)) return true;
      const exp = shared?.get(album.id);
      return exp !== undefined && exp > nowMs;
    });
  }

  canSee(username: string, albumId: string): boolean {
    const snapshot = this.read();
    const key = username.toLowerCase();
    const user = snapshot.users.get(key);
    if (!user) return false;
    if (!user.roleViewer && !user.admin) return false;
    if (user.allAlbums || (snapshot.granted.get(key)?.has(albumId) ?? false)) return true;
    const exp = snapshot.sharedAlbums.get(key)?.get(albumId);
    return exp !== undefined && exp > Date.now();
  }

  /** Albums reading this storage connection — what makes deleting it a 409. */
  albumsOn(connectionId: string): StoredAlbum[] {
    return this.read().albums.filter((album) => album.connectionId === connectionId);
  }

  /** Accounts with explicit access to this album, excluding wildcard holders. */
  members(albumId: string): string[] {
    const snapshot = this.read();
    return [...snapshot.users.values()]
      .filter((user) => snapshot.granted.get(user.username.toLowerCase())?.has(albumId))
      .map((user) => user.username);
  }

  userCount(): number {
    return this.read().users.size;
  }

  /**
   * Administrators who can **actually sign in**, which is what the last-admin
   * protection has to count.
   *
   * An account created by address holds the reserved hash until its invitation is
   * consumed, so counting rows would let the only working administrator demote or
   * delete themselves while the other one is an unread email — leaving the instance
   * administrable by nobody, the outcome `specs/04-security-and-access.md` says
   * requires shell access to repair. The name is unchanged because both callers are
   * that protection, and neither ever wanted a row count.
   */
  adminCount(): number {
    const snapshot = this.read();
    return [...snapshot.users.values()].filter(
      (user) =>
        user.admin &&
        usable(user, snapshot.hasVerifiedEmail.get(user.username.toLowerCase()) ?? false),
    ).length;
  }

  /**
   * Whether this account has a way in: a real password, or a completed email binding.
   */
  isUsable(username: string): boolean {
    const snapshot = this.read();
    const key = username.toLowerCase();
    const user = snapshot.users.get(key);
    return user !== undefined && usable(user, snapshot.hasVerifiedEmail.get(key) ?? false);
  }

  settings(): AppSettings {
    return this.read().settings;
  }

  /* -------------------------------------------------------------------- writing */

  /**
   * Ensures the user account has a backing `commenters` row and returns it.
   *
   * Password-only accounts get a `commenters` row with `email = NULL` and
   * `display_name = user.displayName` so they can comment and favorite photos
   * without requiring SMTP or OTP verification.
   */
  ensureUserCommenter(username: string): number {
    const stored = this.user(username);
    if (!stored) throw new Error(`Unknown account: "${username}"`);

    if (stored.commenterId !== null) {
      const existing = this.identities.byId(stored.commenterId);
      if (existing) return existing.id;
    }

    const commenter = this.identities.createForUser(stored.displayName || stored.username, null);
    this.db
      .prepare('UPDATE users SET commenter_id = ?, updated_at = ? WHERE username = ?')
      .run(commenter.id, new Date().toISOString(), stored.username);
    this.invalidate();
    return commenter.id;
  }

  /**
   * Ensures a unified `users` row (`role_viewer = 1, role_commenter = 1`) exists for
   * a verified commenter (e.g. a share-link visitor who verified their email).
   */
  ensureUserForCommenter(
    commenterId: number,
    email: string,
    displayName: string,
    shareToken?: string,
  ): StoredUser {
    const existingRow = this.db
      .prepare('SELECT username FROM users WHERE commenter_id = ?')
      .get(commenterId) as { username: string } | undefined;

    if (existingRow) {
      if (shareToken) {
        this.db
          .prepare(
            `INSERT INTO commenter_shares (commenter_id, token, notify_photos, notify_comments, created_at)
             VALUES (?, ?, 1, 1, ?)
             ON CONFLICT (commenter_id, token) DO NOTHING`,
          )
          .run(commenterId, shareToken, new Date().toISOString());
        this.invalidate();
      }
      return this.user(existingRow.username)!;
    }

    const now = new Date().toISOString();
    const baseSlug =
      (displayName || email.split('@')[0] || 'visiteur')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 24) || 'visiteur';

    let candidate = baseSlug;
    let suffix = 2;
    while (this.user(candidate) !== undefined) {
      candidate = `${baseSlug}-${suffix++}`;
    }

    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO users (username, display_name, password_hash, admin, role_viewer, role_commenter, all_albums, commenter_id, created_at, updated_at)
           VALUES (?, ?, ?, 0, 1, 1, 0, ?, ?, ?)`,
        )
        .run(candidate, displayName.trim() || candidate, NO_PASSWORD_HASH, commenterId, now, now);
      if (shareToken) {
        this.db
          .prepare(
            `INSERT INTO commenter_shares (commenter_id, token, notify_photos, notify_comments, created_at)
             VALUES (?, ?, 1, 1, ?)
             ON CONFLICT (commenter_id, token) DO NOTHING`,
          )
          .run(commenterId, shareToken, now);
      }
    })();

    this.invalidate();
    return this.user(candidate)!;
  }

  createUser(input: CreateUserInput): StoredUser {
    const now = new Date().toISOString();
    const { allAlbums, ids } = splitAlbums(input.albums);
    const displayName = (input.displayName ?? '').trim() || input.username;
    const admin = input.admin;
    const roleViewer = admin ? true : (input.roleViewer ?? true);
    const roleCommenter = admin ? true : (input.roleCommenter ?? true);

    this.db.transaction(() => {
      let commenterId: number | null = input.commenterId !== undefined ? input.commenterId : null;

      if (commenterId === null && (input.email || !hasNoPassword(input.passwordHash))) {
        const normalizedEmail = input.email ? input.email.trim() : null;
        if (normalizedEmail) {
          const existingCommenter = this.identities.byEmail(normalizedEmail);
          if (existingCommenter) {
            this.absorbShareVisitorIfCompeting(existingCommenter.id, input.username);
            const boundUser = this.db
              .prepare('SELECT username FROM users WHERE commenter_id = ?')
              .get(existingCommenter.id) as { username: string } | undefined;
            if (boundUser) {
              throw new Error(`Email already bound to "${boundUser.username}"`);
            }
            if (existingCommenter.verifiedAt === null) {
              this.identities.declare(normalizedEmail, displayName);
              this.identities.markVerified(normalizedEmail);
            }
            commenterId = existingCommenter.id;
          } else {
            const created = this.identities.createForUser(displayName, normalizedEmail);
            commenterId = created.id;
          }
        } else {
          const created = this.identities.createForUser(displayName, null);
          commenterId = created.id;
        }
      }

      this.db
        .prepare(
          `INSERT INTO users (username, display_name, password_hash, admin, role_viewer, role_commenter, all_albums, commenter_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.username,
          displayName,
          input.passwordHash,
          admin ? 1 : 0,
          roleViewer ? 1 : 0,
          roleCommenter ? 1 : 0,
          allAlbums ? 1 : 0,
          commenterId,
          now,
          now,
        );
      this.linkAlbums(input.username, ids);
      if (commenterId !== null && input.shareTokens && input.shareTokens.length > 0) {
        this.syncShareTokens(commenterId, input.shareTokens, now);
      }
    })();

    this.invalidate();
    return this.user(input.username)!;
  }

  updateUser(username: string, patch: UpdateUserInput): StoredUser {
    const stored = this.user(username);
    if (!stored) throw new Error(`Unknown account: "${username}"`);
    const now = new Date().toISOString();

    const nextAdmin = patch.admin !== undefined ? patch.admin : stored.admin;
    const nextRoleViewer = nextAdmin
      ? true
      : patch.roleViewer !== undefined
        ? patch.roleViewer
        : stored.roleViewer;
    const nextRoleCommenter = nextAdmin
      ? true
      : patch.roleCommenter !== undefined
        ? patch.roleCommenter
        : stored.roleCommenter;
    const nextDisplayName =
      patch.displayName !== undefined
        ? patch.displayName.trim() || stored.username
        : stored.displayName;

    this.db.transaction(() => {
      let commenterId = stored.commenterId;

      const needsCommenter =
        patch.email !== undefined ||
        patch.notifyPhotos !== undefined ||
        patch.notifyComments !== undefined ||
        patch.shareTokens !== undefined ||
        patch.displayName !== undefined;

      if (commenterId === null && needsCommenter) {
        const created = this.identities.createForUser(nextDisplayName, null);
        commenterId = created.id;
        this.db
          .prepare('UPDATE users SET commenter_id = ? WHERE username = ?')
          .run(commenterId, stored.username);
      }

      if (patch.displayName !== undefined) {
        this.db
          .prepare('UPDATE users SET display_name = ? WHERE username = ?')
          .run(nextDisplayName, stored.username);
        if (commenterId !== null) {
          this.identities.setDisplayName(commenterId, nextDisplayName);
        }
      }

      if (patch.email !== undefined && commenterId !== null) {
        const normalizedEmail = patch.email ? patch.email.trim() : null;
        if (normalizedEmail !== null) {
          const existingByEmail = this.identities.byEmail(normalizedEmail);
          if (existingByEmail && existingByEmail.id !== commenterId) {
            this.absorbShareVisitorIfCompeting(existingByEmail.id, stored.username);
            const otherUser = this.db
              .prepare('SELECT username FROM users WHERE commenter_id = ? AND username != ?')
              .get(existingByEmail.id, stored.username) as { username: string } | undefined;
            if (otherUser) {
              throw new Error(`Email already bound to "${otherUser.username}"`);
            }
            // Adopt the existing commenter row for this email and migrate records.
            const oldCommenterId = commenterId;
            this.migrateCommenterRecords(oldCommenterId, existingByEmail.id);
            commenterId = existingByEmail.id;
            if (existingByEmail.verifiedAt === null) {
              this.identities.markVerified(normalizedEmail);
            }
            this.db
              .prepare('UPDATE users SET commenter_id = ? WHERE username = ?')
              .run(commenterId, stored.username);
            this.db.prepare('DELETE FROM commenters WHERE id = ?').run(oldCommenterId);
          } else {
            this.identities.setEmail(commenterId, normalizedEmail, true);
          }
        } else {
          this.identities.setEmail(commenterId, null);
        }
      }

      if (
        (patch.notifyPhotos !== undefined || patch.notifyComments !== undefined) &&
        commenterId !== null
      ) {
        this.identities.setNotifyPreferences(commenterId, {
          notifyPhotos: patch.notifyPhotos,
          notifyComments: patch.notifyComments,
        });
      }

      if (patch.shareTokens !== undefined && commenterId !== null) {
        this.syncShareTokens(commenterId, patch.shareTokens, now);
      }

      if (patch.passwordHash !== undefined) {
        this.db
          .prepare('UPDATE users SET password_hash = ? WHERE username = ?')
          .run(patch.passwordHash, stored.username);
      }

      if (
        patch.admin !== undefined ||
        patch.roleViewer !== undefined ||
        patch.roleCommenter !== undefined
      ) {
        this.db
          .prepare(
            'UPDATE users SET admin = ?, role_viewer = ?, role_commenter = ? WHERE username = ?',
          )
          .run(
            nextAdmin ? 1 : 0,
            nextRoleViewer ? 1 : 0,
            nextRoleCommenter ? 1 : 0,
            stored.username,
          );
      }

      if (patch.albums !== undefined) {
        const { allAlbums, ids } = splitAlbums(patch.albums);
        this.db
          .prepare('UPDATE users SET all_albums = ? WHERE username = ?')
          .run(allAlbums ? 1 : 0, stored.username);
        // Full replacement: the request describes the desired state, not a delta.
        this.db.prepare('DELETE FROM user_albums WHERE username = ?').run(stored.username);
        this.linkAlbums(stored.username, ids);
      }

      this.db
        .prepare('UPDATE users SET updated_at = ? WHERE username = ?')
        .run(now, stored.username);
    })();

    this.invalidate();
    return this.user(stored.username)!;
  }

  /** Associations leave with the account (ON DELETE CASCADE). */
  deleteUser(username: string): boolean {
    const changes = this.db.prepare('DELETE FROM users WHERE username = ?').run(username).changes;
    this.invalidate();
    return changes > 0;
  }

  /* --------------------------------------------- an account that is a person */

  /**
   * Creates an account by address: the reserved hash (or supplied password) and the
   * invitation, together.
   */
  createInvitedUser(
    input: CreateInvitedUserInput,
    codes: VerificationCodeRepo,
  ): CreateInvitedUserResult {
    const now = new Date().toISOString();
    const { allAlbums, ids } = splitAlbums(input.albums);
    const displayName = (input.displayName ?? '').trim() || input.username;
    const admin = input.admin;
    const roleViewer = admin ? true : (input.roleViewer ?? true);
    const roleCommenter = admin ? true : (input.roleCommenter ?? true);
    const passwordHash = input.passwordHash ?? NO_PASSWORD_HASH;

    let minted: { code: string };
    try {
      minted = this.db.transaction(() => {
        // While an email-only invitation is pending, commenter_id remains NULL so no
        // existing commenter row for that email is bound until the code is verified.
        this.db
          .prepare(
            `INSERT INTO users (username, display_name, password_hash, admin, role_viewer, role_commenter, all_albums, commenter_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          )
          .run(
            input.username,
            displayName,
            passwordHash,
            admin ? 1 : 0,
            roleViewer ? 1 : 0,
            roleCommenter ? 1 : 0,
            allAlbums ? 1 : 0,
            now,
            now,
          );
        this.linkAlbums(input.username, ids);

        const result = codes.mint(input.email, 'invite', {
          username: input.username,
          locale: input.locale,
        });
        if ('failure' in result) throw new InvitationRefused(result);
        return result;
      })();
    } catch (error) {
      // Nothing was committed, so the snapshot still describes the database.
      if (error instanceof InvitationRefused) return error.refusal;
      throw error;
    }

    this.invalidate();
    return { user: this.user(input.username)!, code: minted.code };
  }

  /**
   * Consumes an invitation: the account becomes this person, and stops being a key.
   */
  consumeInvitation(input: ConsumeInvitationInput, codes: VerificationCodeRepo): StoredUser {
    const stored = this.user(input.username);
    if (!stored) throw new Error(`Unknown account: "${input.username}"`);
    const now = new Date().toISOString();

    this.db.transaction(() => {
      const known = this.identities.byEmail(input.email);
      let identity: StoredCommenter;
      if (known && known.verifiedAt !== null) {
        identity = known;
      } else {
        const name = input.displayName?.trim();
        if (!name) {
          throw new Error(`No verified identity for "${input.email}" and no name supplied`);
        }
        this.identities.declare(input.email, name);
        identity = this.identities.markVerified(input.email)!;
      }

      if (input.locale) this.identities.seedLocale(identity.id, input.locale);

      this.absorbShareVisitorIfCompeting(identity.id, stored.username);

      // If this user previously had an auto-created password-only commenter row
      // (email === null), migrate its records to `identity.id` and clean it up.
      const prevCommenterId = stored.commenterId;
      if (prevCommenterId !== null && prevCommenterId !== identity.id) {
        const prev = this.identities.byId(prevCommenterId);
        this.migrateCommenterRecords(prevCommenterId, identity.id);
        this.db
          .prepare('UPDATE users SET commenter_id = NULL WHERE username = ?')
          .run(stored.username);
        if (prev && prev.email === null) {
          this.db.prepare('DELETE FROM commenters WHERE id = ?').run(prevCommenterId);
        }
      }

      const nextDisplayName = identity.displayName || stored.displayName || stored.username;
      this.db
        .prepare(
          `UPDATE users
              SET commenter_id = ?, display_name = ?, password_hash = ?, updated_at = ?
            WHERE username = ?`,
        )
        .run(identity.id, nextDisplayName, NO_PASSWORD_HASH, now, stored.username);
      this.closeAccess(stored.username);
      codes.consume(input.email, 'invite');
    })();

    this.invalidate();
    return this.user(stored.username)!;
  }

  /**
   * Takes the account back from the person it was: clears the binding, sets a real
   * password, closes the sessions and forgets the paired screens.
   */
  unbindUser(username: string, passwordHash: string): StoredUser {
    const stored = this.user(username);
    if (!stored) throw new Error(`Unknown account: "${username}"`);
    if (hasNoPassword(passwordHash)) {
      throw new Error(`Unbinding "${stored.username}" requires a password it can be entered with.`);
    }
    const now = new Date().toISOString();

    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE users SET commenter_id = NULL, password_hash = ?, updated_at = ?
            WHERE username = ?`,
        )
        .run(passwordHash, now, stored.username);
      this.closeAccess(stored.username);
    })();

    this.invalidate();
    return this.user(stored.username)!;
  }

  createAlbum(input: CreateAlbumInput): StoredAlbum {
    const now = new Date().toISOString();
    const next = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM albums')
      .get() as {
      next: number;
    };

    this.db
      .prepare(
        `INSERT INTO albums (id, title, description, connection_id, folder_id, recursive, group_by, sort_order, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.title,
        input.description ?? null,
        input.connectionId ?? DEFAULT_CONNECTION_ID,
        input.folderId,
        input.recursive ? 1 : 0,
        input.groupBy ?? DEFAULT_GROUP_BY,
        input.sortOrder ?? DEFAULT_SORT_ORDER,
        next.next,
        now,
        now,
      );

    this.invalidate();
    return this.album(input.id)!;
  }

  updateAlbum(albumId: string, patch: UpdateAlbumInput): StoredAlbum {
    const stored = this.album(albumId);
    if (!stored) throw new Error(`Unknown album: "${albumId}"`);

    const next: StoredAlbum = {
      ...stored,
      title: patch.title ?? stored.title,
      description: patch.description === undefined ? stored.description : patch.description,
      connectionId: patch.connectionId ?? stored.connectionId,
      folderId: patch.folderId ?? stored.folderId,
      recursive: patch.recursive ?? stored.recursive,
      groupBy: patch.groupBy ?? stored.groupBy,
      sortOrder: patch.sortOrder ?? stored.sortOrder,
      coverMediaId: patch.coverMediaId === undefined ? stored.coverMediaId : patch.coverMediaId,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `UPDATE albums
            SET title = ?, description = ?, connection_id = ?, folder_id = ?, recursive = ?,
                group_by = ?, sort_order = ?, cover_media_id = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        next.title,
        next.description,
        next.connectionId,
        next.folderId,
        next.recursive ? 1 : 0,
        next.groupBy,
        next.sortOrder,
        next.coverMediaId,
        next.updatedAt,
        albumId,
      );

    this.invalidate();
    return this.album(albumId)!;
  }

  /**
   * Deletes the album and its associations (ON DELETE CASCADE). The media index and
   * synchronisation state belong to `MediaRepo`, so the caller must purge them —
   * see `routes/admin.ts`.
   */
  deleteAlbum(albumId: string): boolean {
    const changes = this.db.prepare('DELETE FROM albums WHERE id = ?').run(albumId).changes;
    this.invalidate();
    return changes > 0;
  }

  /** Writes supplied settings; the others remain unchanged. */
  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const statement = this.db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    );

    this.db.transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        statement.run(key, JSON.stringify(storedForm(key, value)));
      }
    })();

    this.invalidate();
    return this.settings();
  }

  /**
   * Bootstraps a new installation in one transaction: either everything is imported
   * from the file or nothing is. A half-completed bootstrap would never be replayed,
   * since the presence of one account is enough to disable it.
   */
  seed(input: {
    albums: CreateAlbumInput[];
    users: CreateUserInput[];
    settings: Partial<AppSettings>;
  }): void {
    this.db.transaction(() => {
      for (const album of input.albums) this.createAlbum(album);
      for (const user of input.users) this.createUser(user);
      this.updateSettings(input.settings);
    })();
    this.invalidate();
  }

  /* ------------------------------------------------------------------- internal */

  private absorbShareVisitorIfCompeting(commenterId: number, targetUsername: string): void {
    const other = this.db
      .prepare(
        `SELECT username, password_hash, admin, all_albums
           FROM users
          WHERE commenter_id = ? AND username != ? COLLATE NOCASE`,
      )
      .get(commenterId, targetUsername) as
      { username: string; password_hash: string; admin: number; all_albums: number } | undefined;
    if (!other) return;
    const hasAlbums = this.db
      .prepare('SELECT 1 FROM user_albums WHERE username = ? LIMIT 1')
      .get(other.username);
    const hasShares = this.db
      .prepare('SELECT 1 FROM commenter_shares WHERE commenter_id = ? LIMIT 1')
      .get(commenterId);
    if (
      hasNoPassword(other.password_hash) &&
      other.admin === 0 &&
      other.all_albums === 0 &&
      hasAlbums === undefined &&
      hasShares !== undefined
    ) {
      this.closeAccess(other.username);
      this.db.prepare('DELETE FROM users WHERE username = ?').run(other.username);
    }
  }

  private migrateCommenterRecords(fromId: number, toId: number): void {
    if (fromId === toId) return;
    this.db
      .prepare('UPDATE comments SET commenter_id = ? WHERE commenter_id = ?')
      .run(toId, fromId);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO commenter_favorites (commenter_id, album_id, media_id, created_at)
         SELECT ?, album_id, media_id, created_at FROM commenter_favorites WHERE commenter_id = ?`,
      )
      .run(toId, fromId);
    this.db.prepare('DELETE FROM commenter_favorites WHERE commenter_id = ?').run(fromId);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO commenter_shares (commenter_id, token, notify_photos, notify_comments, created_at)
         SELECT ?, token, notify_photos, notify_comments, created_at FROM commenter_shares WHERE commenter_id = ?`,
      )
      .run(toId, fromId);
    this.db.prepare('DELETE FROM commenter_shares WHERE commenter_id = ?').run(fromId);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO album_subscriptions (commenter_id, album_id, state, notify_photos, notify_comments, created_at)
         SELECT ?, album_id, state, notify_photos, notify_comments, created_at FROM album_subscriptions WHERE commenter_id = ?`,
      )
      .run(toId, fromId);
    this.db.prepare('DELETE FROM album_subscriptions WHERE commenter_id = ?').run(fromId);
  }

  private syncShareTokens(commenterId: number, tokens: string[], now: string): void {
    const unique = [...new Set(tokens)];
    this.db.prepare('DELETE FROM commenter_shares WHERE commenter_id = ?').run(commenterId);
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO commenter_shares (commenter_id, token, notify_photos, notify_comments, created_at)
       VALUES (?, ?, 1, 1, ?)`,
    );
    for (const token of unique) {
      const exists = this.db.prepare('SELECT 1 FROM share_links WHERE token = ?').get(token);
      if (exists) insert.run(commenterId, token, now);
    }
  }

  private closeAccess(username: string): void {
    this.db.prepare('DELETE FROM sessions WHERE username = ?').run(username);
    this.db.prepare('DELETE FROM device_pairings WHERE username = ?').run(username);
  }

  private linkAlbums(username: string, albumIds: string[]): void {
    const statement = this.db.prepare(
      'INSERT OR IGNORE INTO user_albums (username, album_id) VALUES (?, ?)',
    );
    for (const albumId of albumIds) statement.run(username, albumId);
  }

  invalidate(): void {
    this.snapshot = null;
  }

  private read(): Snapshot {
    const version = this.db.pragma('data_version', { simple: true }) as number;
    if (version !== this.dataVersion) {
      this.dataVersion = version;
      this.snapshot = null;
    }
    return (this.snapshot ??= this.build());
  }

  private build(): Snapshot {
    const albumRows = this.db
      .prepare(
        `SELECT id, title, description, connection_id, folder_id, recursive, group_by,
                sort_order, cover_media_id, created_at, updated_at
           FROM albums ORDER BY position, id`,
      )
      .all() as AlbumRow[];
    const userRows = this.db
      .prepare(
        `SELECT u.username, u.display_name, u.password_hash, u.admin, u.role_viewer,
                u.role_commenter, u.all_albums, u.commenter_id, u.created_at, u.updated_at,
                c.email AS commenter_email, c.verified_at AS commenter_verified_at
           FROM users u
           LEFT JOIN commenters c ON c.id = u.commenter_id
          ORDER BY u.username`,
      )
      .all() as (UserRow & {
      commenter_email: string | null;
      commenter_verified_at: string | null;
    })[];
    const linkRows = this.db.prepare('SELECT username, album_id FROM user_albums').all() as {
      username: string;
      album_id: string;
    }[];

    const shareRows = this.db
      .prepare(
        `SELECT u.username, cs.token
           FROM users u
           JOIN commenter_shares cs ON cs.commenter_id = u.commenter_id
           JOIN share_links s ON s.token = cs.token
          WHERE s.revoked_at IS NULL
          ORDER BY cs.created_at DESC`,
      )
      .all() as Array<{ username: string; token: string }>;

    const sharedAlbumRows = this.db
      .prepare(
        `SELECT u.username, sla.album_id, s.expires_at
           FROM users u
           JOIN commenter_shares cs ON cs.commenter_id = u.commenter_id
           JOIN share_links s ON s.token = cs.token
           JOIN share_link_albums sla ON sla.token = s.token
          WHERE s.revoked_at IS NULL
            AND (s.expires_at IS NULL OR s.expires_at > ?)`,
      )
      .all(new Date().toISOString()) as Array<{
      username: string;
      album_id: string;
      expires_at: string | null;
    }>;

    const granted = new Map<string, Set<string>>();
    for (const link of linkRows) {
      const key = link.username.toLowerCase();
      const set = granted.get(key) ?? new Set<string>();
      set.add(link.album_id);
      granted.set(key, set);
    }

    const sharedAlbums = new Map<string, Map<string, number>>();
    for (const row of sharedAlbumRows) {
      const key = row.username.toLowerCase();
      const map = sharedAlbums.get(key) ?? new Map<string, number>();
      const expMs = row.expires_at === null ? Infinity : Date.parse(row.expires_at);
      const prev = map.get(row.album_id) ?? 0;
      if (expMs > prev) map.set(row.album_id, expMs);
      sharedAlbums.set(key, map);
    }

    const shareTokensByUser = new Map<string, string[]>();
    for (const row of shareRows) {
      const key = row.username.toLowerCase();
      const list = shareTokensByUser.get(key) ?? [];
      list.push(row.token);
      shareTokensByUser.set(key, list);
    }

    const albums = albumRows.map(toAlbum);
    const users = new Map<string, StoredUser>();
    const hasVerifiedEmail = new Map<string, boolean>();

    for (const row of userRows) {
      const key = row.username.toLowerCase();
      const admin = row.admin === 1;
      hasVerifiedEmail.set(
        key,
        row.commenter_id !== null &&
          row.commenter_email !== null &&
          row.commenter_verified_at !== null,
      );
      users.set(key, {
        username: row.username,
        displayName: row.display_name || row.username,
        passwordHash: row.password_hash,
        admin,
        roleViewer: admin ? true : row.role_viewer === 1,
        roleCommenter: admin ? true : row.role_commenter === 1,
        allAlbums: row.all_albums === 1,
        // Sorted like albums so the list returned by the API is stable.
        albums: albums.filter((album) => granted.get(key)?.has(album.id)).map((album) => album.id),
        shareTokens: shareTokensByUser.get(key) ?? [],
        commenterId: row.commenter_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }

    return {
      albums,
      albumsById: new Map(albums.map((album) => [album.id, album])),
      users,
      granted,
      sharedAlbums,
      hasVerifiedEmail,
      settings: this.loadSettings(),
    };
  }

  private loadSettings(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as {
      key: string;
      value: string;
    }[];

    const raw: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        raw[row.key] = JSON.parse(row.value);
      } catch {
        // Unreadable value (manually edited database): the default takes over.
      }
    }

    const parsed = settingsSchema.partial().safeParse(raw);
    return { ...defaultSettings(this.instanceName), ...(parsed.success ? parsed.data : {}) };
  }
}

/**
 * Reduces a value to the single form it is stored in.
 *
 * Three settings arrive from a form in more than one shape, and the difference is
 * not cosmetic in any of them.
 */
function storedForm(key: string, value: unknown): unknown {
  switch (key) {
    // An address cleared in the form arrives as an empty string: stored as-is it
    // would be a second way to say "none", and `moderationEmail: ''` would pass the
    // recipient presence check.
    case 'moderationEmail':
      return normalize(value as string | null);
    // A colour picker sends `#EB2020` as readily as `#eb2020`. Both spellings go
    // into an `ETag` and into the generated-icon key, where they would be two
    // entries for one image.
    case 'primaryColor':
      return normalizeHexColor(String(value)) ?? DEFAULT_PRIMARY_COLOR;
    // A name with a trailing space is a different name in the tab title and under
    // the home-screen icon, and looks like neither.
    case 'instanceName':
      return String(value).trim();
    default:
      return value;
  }
}

/** An empty string from a form means "no value". */
function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * A way in: a real password, or a completed email binding.
 */
function usable(user: StoredUser, hasVerifiedEmail: boolean): boolean {
  return !hasNoPassword(user.passwordHash) || hasVerifiedEmail;
}

/** `['*', 'a']` means wildcard: the most permissive value wins without silent error. */
export function splitAlbums(albums: string[]): { allAlbums: boolean; ids: string[] } {
  const allAlbums = albums.includes(ALL_ALBUMS);
  return { allAlbums, ids: allAlbums ? [] : [...new Set(albums)] };
}
