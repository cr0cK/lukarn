import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/**
 * Trois colonnes sont écrites sans qu'aucune requête ne les relise. Ce n'est
 * pas un oubli, et il ne faut pas les supprimer — SQLite ne sait pas retirer
 * une colonne autrement qu'en recréant la table, ce qui ne vaut pas le gain sur
 * une base en service :
 *
 * - `media.modified_time` — date de modification Drive, seul repère
 *   chronologique quand l'EXIF manque. `takenAt` en dérive au moment de la
 *   synchronisation ; la garder permet de recalculer sans réindexer, et de
 *   diagnostiquer un `taken_at` qui surprend.
 * - `oauth_token.scope` — portée demandée lors du consentement. Elle sert à
 *   savoir, quand `SCOPES` évoluera, si le jeton stocké couvre encore ce que
 *   l'application demande ou s'il faut refaire le consentement.
 * - `sessions.created_at` — date d'ouverture. `expires_at` suffit à la purge,
 *   mais c'est la seule trace qui dise depuis quand une session traîne, ce qui
 *   est la première question posée après un accès suspect.
 *
 * Migrations appliquées dans l'ordre, suivies par `PRAGMA user_version`.
 * Ne jamais modifier une migration déjà publiée : en ajouter une nouvelle.
 *
 * Exporté pour que les tests puissent reconstituer une base d'une version
 * antérieure et vérifier qu'elle se met à jour sans perdre de données.
 */
export const MIGRATIONS: string[] = [
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

  // 2 — trace de la révocation du refresh token par Google (`invalid_grant`),
  // pour que /admin distingue « jamais connecté » de « accès retiré ».
  `
  ALTER TABLE oauth_token ADD COLUMN revoked_at TEXT;
  `,

  // 3 — comptes, albums et réglages passent de config/albums.yaml à la base.
  // Le fichier ne sert plus qu'à amorcer une installation neuve ; une fois ces
  // tables peuplées, il n'est plus jamais relu.
  `
  CREATE TABLE users (
    -- COLLATE NOCASE sur la clé primaire : le login est déjà insensible à la
    -- casse, et l'unicité doit l'être aussi — sinon « Alexis » et « alexis »
    -- coexisteraient et la connexion en désignerait un au hasard. La casse
    -- saisie reste stockée telle quelle et c'est elle qui est affichée. Une
    -- seconde colonne en minuscules donnerait le même résultat, au prix d'un
    -- risque de désynchronisation entre les deux. NOCASE ne replie que
    -- l'ASCII : c'est exactement ce qu'accepte USERNAME_PATTERN.
    username       TEXT PRIMARY KEY COLLATE NOCASE,
    password_hash  TEXT NOT NULL,
    admin          INTEGER NOT NULL DEFAULT 0,
    -- Joker « tous les albums ». Un booléen plutôt qu'une ligne '*' dans
    -- user_albums : cette ligne-là exigerait un album fictif pour satisfaire la
    -- clé étrangère, ou d'y renoncer. Et le joker doit suivre les albums créés
    -- plus tard, ce qu'une liste de liaisons figées ne ferait pas.
    all_albums     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );

  CREATE TABLE albums (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    description  TEXT,
    folder_id    TEXT NOT NULL,
    recursive    INTEGER NOT NULL DEFAULT 1,
    -- Rang d'affichage. Il remplace l'ordre de déclaration du YAML, que
    -- created_at ne restituerait pas : l'amorçage crée tous les albums dans la
    -- même milliseconde.
    position     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  -- ON DELETE CASCADE : une liaison orpheline redonnerait l'accès à un compte
  -- homonyme recréé plus tard, ou à un album recréé sous le même id.
  CREATE TABLE user_albums (
    username  TEXT NOT NULL REFERENCES users (username) ON DELETE CASCADE,
    album_id  TEXT NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    PRIMARY KEY (username, album_id)
  );

  -- Sert « qui a accès à cet album », affiché dans l'écran d'administration.
  CREATE INDEX idx_user_albums_album ON user_albums (album_id);

  -- Réglages en clé/valeur JSON. Les défauts vivent dans le code : une clé
  -- absente n'est pas une anomalie, et ajouter un réglage ne demande pas de
  -- migration.
  CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
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
