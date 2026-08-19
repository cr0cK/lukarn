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
  passwordHash: string;
  admin: boolean;
  /** `*` wildcard: access to every album, including ones created later. */
  allAlbums: boolean;
  /** Explicitly assigned album IDs, excluding the wildcard. */
  albums: string[];
  /**
   * The person this account **is**, or `null` for the key a household shares. It is
   * written when a code is consumed and never at creation, so a bound identity is
   * always a verified one.
   */
  commenterId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  username: string;
  passwordHash: string;
  admin: boolean;
  /** Album IDs, or a list containing `'*'` for the wildcard. */
  albums: string[];
}

export interface UpdateUserInput {
  passwordHash?: string;
  admin?: boolean;
  albums?: string[];
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
  password_hash: string;
  admin: number;
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
  const bound = user.commenterId === null ? null : commenters.byId(user.commenterId);
  const pending = codes.pendingInvite(user.username);

  return {
    username: user.username,
    admin: user.admin,
    albums: user.allAlbums ? [ALL_ALBUMS] : [...user.albums],
    identity: bound ? { email: bound.email, displayName: bound.displayName } : null,
    invitation: pending ? { email: pending.target, expiresAt: pending.expiresAt } : null,
    state: accountState(user, bound !== null, pending !== null),
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
  admin: boolean;
  /** Album IDs, or a list containing `'*'` for the wildcard. */
  albums: string[];
  /** The address the invitation goes to. Nothing is written to `commenters` yet. */
  email: string;
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
   *
   * No check on `verified_at`: `commenter_id` is written only when a code is
   * consumed, so a bound identity is a verified one by construction.
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

  /** Albums visible to this account, in display order. */
  albumsFor(username: string): StoredAlbum[] {
    const snapshot = this.read();
    const user = snapshot.users.get(username.toLowerCase());
    if (!user) return [];
    if (user.allAlbums) return snapshot.albums;
    const granted = snapshot.granted.get(username.toLowerCase());
    return snapshot.albums.filter((album) => granted?.has(album.id));
  }

  canSee(username: string, albumId: string): boolean {
    const snapshot = this.read();
    const key = username.toLowerCase();
    const user = snapshot.users.get(key);
    if (!user) return false;
    return user.allAlbums || (snapshot.granted.get(key)?.has(albumId) ?? false);
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
    return [...this.read().users.values()].filter((user) => user.admin && usable(user)).length;
  }

  /**
   * Whether this account has a way in: a real password, or a completed binding.
   *
   * Structural, and deliberately silent about whether mail leaves the machine this
   * morning. An instance that turns its mailer off has `pnpm reset-password` as the
   * way back, and an account state that changed with the weather would be worse than
   * the lockout it tried to prevent.
   *
   * The count above answers "how many are left"; this answers "is this one of them",
   * which is the question asked of the account about to be demoted or deleted.
   */
  isUsable(username: string): boolean {
    const user = this.user(username);
    return user !== undefined && usable(user);
  }

  settings(): AppSettings {
    return this.read().settings;
  }

  /* -------------------------------------------------------------------- writing */

  createUser(input: CreateUserInput): StoredUser {
    const now = new Date().toISOString();
    const { allAlbums, ids } = splitAlbums(input.albums);

    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO users (username, password_hash, admin, all_albums, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(input.username, input.passwordHash, input.admin ? 1 : 0, allAlbums ? 1 : 0, now, now);
      this.linkAlbums(input.username, ids);
    })();

    this.invalidate();
    return this.user(input.username)!;
  }

  updateUser(username: string, patch: UpdateUserInput): StoredUser {
    const stored = this.user(username);
    if (!stored) throw new Error(`Unknown account: "${username}"`);
    // A bound account holds no password, and the single way to give it one is
    // `unbindUser`, which clears the binding and closes the sessions in the same
    // transaction. Without this refusal an administrator sets a password on a bound
    // account, signs in, and the session signs as that person — the binding they were
    // forbidden to assert, entered through the door instead of the window. The rule
    // sits here rather than on the route because `pnpm reset-password` writes through
    // this repository without passing any route.
    if (patch.passwordHash !== undefined && stored.commenterId !== null) {
      throw new Error(
        `"${stored.username}" is bound to a person and holds no password: ` +
          'unbind it to give it one, which also closes its sessions.',
      );
    }
    const now = new Date().toISOString();

    this.db.transaction(() => {
      if (patch.passwordHash !== undefined) {
        this.db
          .prepare('UPDATE users SET password_hash = ? WHERE username = ?')
          .run(patch.passwordHash, stored.username);
      }
      if (patch.admin !== undefined) {
        this.db
          .prepare('UPDATE users SET admin = ? WHERE username = ?')
          .run(patch.admin ? 1 : 0, stored.username);
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
   * Creates an account by address: the reserved hash and the invitation, together.
   *
   * They land in one transaction because neither is any use alone. An invitation
   * refused after the account was written leaves a sentinel account nobody invited
   * and nobody can enter, and only an administrator reading the account list would
   * ever find out. No binding is written here and no existing `commenters` row is
   * touched: a verified address proves that somebody controls an inbox, not that they
   * accepted this account, and consuming the code is what proves the second.
   *
   * `createUser` is not reused: it invalidates the snapshot before returning, so
   * composing it here would rebuild that snapshot from writes this transaction may
   * still roll back — and `PRAGMA data_version` does not move for a write on this
   * connection, so nothing would ever notice.
   */
  createInvitedUser(
    input: CreateInvitedUserInput,
    codes: VerificationCodeRepo,
  ): CreateInvitedUserResult {
    const now = new Date().toISOString();
    const { allAlbums, ids } = splitAlbums(input.albums);

    let minted: { code: string };
    try {
      minted = this.db.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO users (username, password_hash, admin, all_albums, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(input.username, NO_PASSWORD_HASH, input.admin ? 1 : 0, allAlbums ? 1 : 0, now, now);
        this.linkAlbums(input.username, ids);

        const result = codes.mint(input.email, 'invite', { username: input.username });
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
   *
   * One transaction for what is one act. It writes the binding, marks the address
   * verified — creating the identity when the instance does not know it — spends the
   * code, replaces the password with the reserved hash, closes the account's sessions
   * and forgets its paired screens.
   *
   * The last three are what a **conversion** needs, and they are unconditional
   * because an account created by address has no password to replace, no session and
   * no paired screen: the same statements, doing nothing. On a shared key they are
   * the whole point. Without the closing, the other devices of a household keep a
   * session that has just started signing under one person's name; without the
   * password, everyone who knew the key still walks in under it; without the pairing
   * row, `claim()` turns a television approved while the key was shared into a fresh
   * session as the person it has just become.
   *
   * **The new session is opened by the caller, after this returns**, and the order
   * is the point: the session belongs to whoever just proved the address, and a
   * blanket close run afterwards would sign them straight back out.
   */
  consumeInvitation(input: ConsumeInvitationInput, codes: VerificationCodeRepo): StoredUser {
    const stored = this.user(input.username);
    if (!stored) throw new Error(`Unknown account: "${input.username}"`);
    const now = new Date().toISOString();

    this.db.transaction(() => {
      const known = this.identities.byEmail(input.email);
      let identity: StoredCommenter;
      if (known && known.verifiedAt !== null) {
        // Adopting an identity that already signs comments is the good case: the
        // household member who has commented keeps their comments. Its name is left
        // exactly as they wrote it.
        identity = known;
      } else {
        // A row nobody has verified carries a name anybody behind the shared key
        // could have chosen, so it takes the unknown path rather than being adopted
        // as it stands. The route asks for the name before spending the code.
        const name = input.displayName?.trim();
        if (!name) {
          throw new Error(`No verified identity for "${input.email}" and no name supplied`);
        }
        this.identities.declare(input.email, name);
        identity = this.identities.markVerified(input.email)!;
      }

      // A UNIQUE index guards `commenter_id`: an identity bound to another account
      // between the invitation and this moment raises here, and the whole act —
      // the binding, the code, the closing — rolls back rather than half-applying.
      this.db
        .prepare(
          `UPDATE users SET commenter_id = ?, password_hash = ?, updated_at = ?
            WHERE username = ?`,
        )
        .run(identity.id, NO_PASSWORD_HASH, now, stored.username);
      this.closeAccess(stored.username);
      codes.consume(input.email, 'invite');
    })();

    this.invalidate();
    return this.user(stored.username)!;
  }

  /**
   * Takes the account back from the person it was: clears the binding, sets a real
   * password, closes the sessions and forgets the paired screens.
   *
   * The password is required rather than optional, and this is the exception that
   * makes the refusal in `updateUser` liveable: unbinding without one would leave an
   * account with no identity and a hash nobody can enter, the administrator included.
   * It is also the answer to somebody losing access to their address — the account
   * becomes the shared key it has become in practice, and the comments it signed keep
   * the name they were signed with.
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

  /**
   * Everything that could still open a session on this account, in two statements.
   *
   * Written here rather than through `SessionStore` and `PairingStore` because it is
   * two statements and no rule: both classes would have to be handed this connection
   * to keep the surrounding transaction, and `PairingStore` a secret it would not
   * use. Closing the sessions alone is not enough — an approved `device_pairings` row
   * survives it, and `claim()` turns it into a fresh session afterwards.
   */
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

  private invalidate(): void {
    this.snapshot = null;
  }

  /**
   * Returns the snapshot after ensuring that no other connection has written to the
   * database since it was built.
   *
   * `PRAGMA data_version` does not move for writes from *this* connection, but changes
   * as soon as another process commits a transaction. This allows `pnpm reset-password`,
   * run while the server is active, to take effect immediately: without this check,
   * the server would continue authenticating with the old hash until restart, defeating
   * a command designed for urgently regaining control.
   *
   * The cost is one in-memory counter read per call, whereas rebuilding the snapshot
   * each time would cost several queries — including on the `canSee()` path called
   * for every thumbnail.
   */
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
        `SELECT username, password_hash, admin, all_albums, commenter_id, created_at, updated_at
           FROM users ORDER BY username`,
      )
      .all() as UserRow[];
    const linkRows = this.db.prepare('SELECT username, album_id FROM user_albums').all() as {
      username: string;
      album_id: string;
    }[];

    const granted = new Map<string, Set<string>>();
    for (const link of linkRows) {
      const key = link.username.toLowerCase();
      const set = granted.get(key) ?? new Set<string>();
      set.add(link.album_id);
      granted.set(key, set);
    }

    const albums = albumRows.map(toAlbum);
    const users = new Map<string, StoredUser>();
    for (const row of userRows) {
      const key = row.username.toLowerCase();
      users.set(key, {
        username: row.username,
        passwordHash: row.password_hash,
        admin: row.admin === 1,
        allAlbums: row.all_albums === 1,
        // Sorted like albums so the list returned by the API is stable.
        albums: albums.filter((album) => granted.get(key)?.has(album.id)).map((album) => album.id),
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
 * A way in: a real password, or a completed binding. An account with the reserved
 * hash and no binding holds album grants somebody set on purpose and no credential
 * that could exercise them.
 */
function usable(user: StoredUser): boolean {
  return !hasNoPassword(user.passwordHash) || user.commenterId !== null;
}

/** `['*', 'a']` means wildcard: the most permissive value wins without silent error. */
function splitAlbums(albums: string[]): { allAlbums: boolean; ids: string[] } {
  const allAlbums = albums.includes(ALL_ALBUMS);
  return { allAlbums, ids: allAlbums ? [] : [...new Set(albums)] };
}
