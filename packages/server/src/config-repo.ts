import {
  ALL_ALBUMS,
  DEFAULT_GROUP_BY,
  DEFAULT_SORT_ORDER,
  type AdminUser,
  type AppSettings,
  type GroupBy,
  type SortOrder,
} from '@nonni/shared';
import { z } from 'zod';
import type { Db } from './db.js';

/**
 * Dépôt des comptes, des albums et des réglages — la configuration de
 * l'application, administrée depuis l'application elle-même.
 *
 * Tout passe par ici : c'est le seul écrivain de `users`, `albums`,
 * `user_albums` et `settings`, ce qui rend le cache mémoire ci-dessous sûr.
 *
 * **Pourquoi un cache.** `canSee()` est appelé sur chaque requête média, donc
 * sur chaque vignette d'une grille de plusieurs centaines de tuiles. Une
 * requête SQL par vignette serait un net recul par rapport à la config en
 * mémoire qu'on remplace. L'instantané est reconstruit à la première lecture
 * qui suit une écriture, jamais pendant.
 */

/** Album tel qu'il est stocké. Superset de ce dont la synchronisation a besoin. */
export interface StoredAlbum {
  id: string;
  title: string;
  description: string | null;
  folderId: string;
  recursive: boolean;
  /** Découpage de la grille à l'ouverture. Une préférence, pas une contrainte. */
  groupBy: GroupBy;
  /**
   * Sens de lecture à l'ouverture. Une préférence elle aussi : l'URL et la
   * mémoire du navigateur passent devant.
   */
  sortOrder: SortOrder;
  /**
   * Média choisi comme couverture, `null` pour la plus récente automatiquement.
   * Le choix seul : la couverture réellement servie est calculée par
   * `MediaRepo.stats`, qui replie sur l'automatique si la photo a quitté l'index.
   */
  coverMediaId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Compte tel qu'il est stocké, empreinte comprise — ne jamais le sérialiser tel quel. */
export interface StoredUser {
  username: string;
  passwordHash: string;
  admin: boolean;
  /** Joker `*` : accès à tous les albums, y compris ceux créés plus tard. */
  allAlbums: boolean;
  /** Ids d'albums explicitement attribués, hors joker. */
  albums: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  username: string;
  passwordHash: string;
  admin: boolean;
  /** Ids d'albums, ou une liste contenant `'*'` pour le joker. */
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
  /** Omis, c'est le défaut partagé — le mois. */
  groupBy?: GroupBy;
  /** Omis, c'est le défaut partagé — les plus anciennes d'abord. */
  sortOrder?: SortOrder;
}

export interface UpdateAlbumInput {
  title?: string;
  description?: string | null;
  folderId?: string;
  recursive?: boolean;
  groupBy?: GroupBy;
  sortOrder?: SortOrder;
  /** `null` rend la couverture au choix automatique. */
  coverMediaId?: string | null;
}

/** Valeurs appliquées tant qu'aucun réglage n'a été enregistré. */
export const DEFAULT_SETTINGS: AppSettings = {
  syncIntervalMinutes: 30,
  syncOnStartup: true,
  cacheMaxSizeGB: 20,
  prewarmCache: true,
  transcodeVideos: true,
  // Cinq giga-octets, soit environ trois heures de 1080p transcodé : de quoi
  // couvrir plusieurs albums de vacances. Un dixième du budget des vignettes,
  // parce qu'une bibliothèque tient bien plus de photos que de films.
  videoCacheMaxSizeGB: 5,
  moderationEmail: null,
};

const settingsSchema = z.object({
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

/** Vue mémoire de la configuration, reconstruite après chaque écriture. */
interface Snapshot {
  albums: StoredAlbum[];
  albumsById: Map<string, StoredAlbum>;
  /** Clé en minuscules : le login est insensible à la casse. */
  users: Map<string, StoredUser>;
  /** Même clé, ensemble d'ids pour un `canSee` en temps constant. */
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

/** Forme exposée par l'API : le joker redevient `['*']`, l'empreinte disparaît. */
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
  /** Dernière valeur observée de `PRAGMA data_version`. Voir `read()`. */
  private dataVersion = -1;

  constructor(private readonly db: Db) {}

  /* ----------------------------------------------------------------- lecture */

  /** Tous les albums, dans leur ordre d'affichage (rang de création). */
  albums(): StoredAlbum[] {
    return this.read().albums;
  }

  album(albumId: string): StoredAlbum | undefined {
    return this.read().albumsById.get(albumId);
  }

  /** Recherche insensible à la casse : le login ne doit pas dépendre de la frappe. */
  user(username: string): StoredUser | undefined {
    return this.read().users.get(username.toLowerCase());
  }

  users(): StoredUser[] {
    return [...this.read().users.values()];
  }

  /** Albums visibles par ce compte, dans l'ordre d'affichage. */
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

  /** Comptes ayant explicitement accès à cet album, hors détenteurs du joker. */
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

  /* ---------------------------------------------------------------- écriture */

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
    if (!stored) throw new Error(`Compte inconnu : "${username}"`);
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
        // Remplacement complet : la requête décrit l'état voulu, pas un delta.
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

  /** Les liaisons partent avec le compte (ON DELETE CASCADE). */
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
    if (!stored) throw new Error(`Album inconnu : "${albumId}"`);

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
   * Supprime l'album et ses liaisons (ON DELETE CASCADE). L'index média et
   * l'état de synchronisation, eux, appartiennent à `MediaRepo` : l'appelant
   * doit les purger — voir `routes/admin.ts`.
   */
  deleteAlbum(albumId: string): boolean {
    const changes = this.db.prepare('DELETE FROM albums WHERE id = ?').run(albumId).changes;
    this.invalidate();
    return changes > 0;
  }

  /** Écrit les réglages fournis ; les autres restent inchangés. */
  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const statement = this.db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    );

    this.db.transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        // Une adresse vidée dans le formulaire arrive en chaîne vide : la
        // stocker telle quelle donnerait deux façons de dire « aucune », et
        // `moderationEmail: ''` passerait le test de présence des destinataires.
        const stored = key === 'moderationEmail' ? normalize(value as string | null) : value;
        statement.run(key, JSON.stringify(stored));
      }
    })();

    this.invalidate();
    return this.settings();
  }

  /**
   * Amorçage d'une installation neuve, en une transaction : soit tout est
   * repris du fichier, soit rien ne l'est. Un amorçage à moitié fait ne serait
   * jamais rejoué, puisque la présence d'un compte suffit à le désactiver.
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

  /* ------------------------------------------------------------------ interne */

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
   * Rend l'instantané, après s'être assuré qu'aucune autre connexion n'a écrit
   * dans la base depuis sa construction.
   *
   * `PRAGMA data_version` ne bouge pas pour les écritures de *cette* connexion,
   * mais change dès qu'un autre processus valide une transaction. C'est ce qui
   * permet à `pnpm reset-password`, lancé pendant que le serveur tourne, de
   * prendre effet immédiatement : sans cette vérification, le serveur
   * continuerait d'authentifier avec l'ancienne empreinte jusqu'au redémarrage,
   * ce qui vide de son sens une commande faite pour reprendre la main en
   * urgence.
   *
   * Le coût est une lecture de compteur en mémoire par appel, là où reconstruire
   * l'instantané à chaque fois coûterait plusieurs requêtes — y compris sur le
   * chemin de `canSee()`, appelé pour chaque vignette.
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
        // Trié comme les albums : la liste rendue par l'API est stable.
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
        // Valeur illisible (base éditée à la main) : le défaut reprend la main.
      }
    }

    const parsed = settingsSchema.partial().safeParse(raw);
    return { ...DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) };
  }
}

/** Une chaîne vide venue d'un formulaire vaut « pas de valeur ». */
function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** `['*', 'a']` vaut joker : le plus permissif l'emporte, sans erreur silencieuse. */
function splitAlbums(albums: string[]): { allAlbums: boolean; ids: string[] } {
  const allAlbums = albums.includes(ALL_ALBUMS);
  return { allAlbums, ids: allAlbums ? [] : [...new Set(albums)] };
}
