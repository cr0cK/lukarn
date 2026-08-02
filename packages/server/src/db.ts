import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/**
 * Migrations appliquées dans l'ordre, suivies par `PRAGMA user_version`.
 * Ne jamais modifier une migration déjà publiée : en ajouter une nouvelle.
 */
const MIGRATIONS: string[] = [
  // 1 — schéma initial
  `
  CREATE TABLE media (
    album_id            TEXT NOT NULL,
    id                  TEXT NOT NULL,
    name                TEXT NOT NULL,
    mime_type           TEXT NOT NULL,
    kind                TEXT NOT NULL CHECK (kind IN ('photo', 'video')),
    size                INTEGER,
    width               INTEGER,
    height              INTEGER,
    taken_at            TEXT NOT NULL,
    taken_at_from_exif  INTEGER NOT NULL DEFAULT 0,
    modified_time       TEXT NOT NULL,
    duration_ms         INTEGER,
    camera_make         TEXT,
    camera_model        TEXT,
    lens                TEXT,
    iso_speed           INTEGER,
    exposure_time       REAL,
    aperture            REAL,
    focal_length        REAL,
    lat                 REAL,
    lng                 REAL,
    md5                 TEXT,
    seen_at             TEXT NOT NULL,
    PRIMARY KEY (album_id, id)
  );

  -- Sert le tri chronologique de la grille et la pagination par curseur.
  CREATE INDEX idx_media_album_taken ON media (album_id, taken_at DESC, id DESC);
  -- Sert la résolution mediaId -> albums pour le contrôle d'accès.
  CREATE INDEX idx_media_id ON media (id);

  CREATE TABLE sync_state (
    album_id      TEXT PRIMARY KEY,
    last_sync_at  TEXT,
    status        TEXT NOT NULL DEFAULT 'never',
    error         TEXT
  );

  -- Ligne unique (id = 1) : le refresh token Google chiffré.
  CREATE TABLE oauth_token (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    ciphertext  TEXT NOT NULL,
    account     TEXT,
    scope       TEXT,
    granted_at  TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
  );

  CREATE INDEX idx_sessions_expires ON sessions (expires_at);
  `,
];

export function openDb(dataDir: string): Db {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, 'gdv.db'));

  // WAL : les lectures de la grille ne bloquent pas la sync qui écrit en fond.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  // Une écriture concurrente attend au lieu de renvoyer SQLITE_BUSY.
  db.pragma('busy_timeout = 5000');

  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version]!;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.pragma(`user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Échec de la migration ${version + 1} : ${(error as Error).message}`);
    }
  }
}
