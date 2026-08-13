import {
  ALL_ALBUMS,
  DEFAULT_GROUP_BY,
  DEFAULT_INSTANCE_NAME,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SORT_ORDER,
  HEX_COLOR_PATTERN,
  INSTANCE_NAME_MAX_LENGTH,
  normalizeHexColor,
  type AdminUser,
  type AppSettings,
  type GroupBy,
  type SortOrder,
} from '@lukarn/shared';
import { z } from 'zod';
import type { Db } from './db.js';

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
 */

/** Album as stored. A superset of what synchronisation needs. */
export interface StoredAlbum {
  id: string;
  title: string;
  description: string | null;
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
    folderId: row.folder_id,
    recursive: row.recursive === 1,
    groupBy: row.group_by,
    sortOrder: row.sort_order,
    coverMediaId: row.cover_media_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** API shape: the wildcard becomes `['*']` again and the hash disappears. */
export function toAdminUser(user: StoredUser): AdminUser {
  return {
    username: user.username,
    admin: user.admin,
    albums: user.allAlbums ? [ALL_ALBUMS] : [...user.albums],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export class ConfigRepo {
  private snapshot: Snapshot | null = null;
  /** Last observed value of `PRAGMA data_version`. See `read()`. */
  private dataVersion = -1;

  /**
   * `instanceName` is the value `APP_NAME` seeds while nothing has been saved. It is
   * a default, not a source of truth: once someone renames the gallery from /admin,
   * the environment variable no longer says anything (D260813c). Command-line tools
   * construct this without one — they never render a page.
   */
  constructor(
    private readonly db: Db,
    private readonly instanceName: string = DEFAULT_INSTANCE_NAME,
  ) {}

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

  adminCount(): number {
    return [...this.read().users.values()].filter((user) => user.admin).length;
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

  createAlbum(input: CreateAlbumInput): StoredAlbum {
    const now = new Date().toISOString();
    const next = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM albums')
      .get() as {
      next: number;
    };

    this.db
      .prepare(
        `INSERT INTO albums (id, title, description, folder_id, recursive, group_by, sort_order, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.title,
        input.description ?? null,
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
            SET title = ?, description = ?, folder_id = ?, recursive = ?, group_by = ?,
                sort_order = ?, cover_media_id = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        next.title,
        next.description,
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
        `SELECT id, title, description, folder_id, recursive, group_by, sort_order,
                cover_media_id, created_at, updated_at
           FROM albums ORDER BY position, id`,
      )
      .all() as AlbumRow[];
    const userRows = this.db
      .prepare(
        `SELECT username, password_hash, admin, all_albums, created_at, updated_at
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

/** `['*', 'a']` means wildcard: the most permissive value wins without silent error. */
function splitAlbums(albums: string[]): { allAlbums: boolean; ids: string[] } {
  const allAlbums = albums.includes(ALL_ALBUMS);
  return { allAlbums, ids: allAlbums ? [] : [...new Set(albums)] };
}
