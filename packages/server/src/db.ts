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

  // 4 — commentaires des visiteurs, et de quoi les notifier.
  `
  -- AUTOINCREMENT, contrairement au rowid ordinaire : sans lui, SQLite réattribue
  -- l'identifiant d'une ligne supprimée à la ligne suivante. Les emails de
  -- notification portent un lien vers #<id> et survivent des mois dans une boîte
  -- aux lettres ; un id recyclé ferait pointer un vieux message vers la
  -- conversation de quelqu'un d'autre.
  CREATE TABLE comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Le fil appartient au couple (album, média), jamais au seul média : le même
    -- fichier Drive indexé sous deux albums porte deux conversations. Les
    -- mélanger montrerait à un visiteur les propos tenus dans un album auquel il
    -- n'a pas accès, ce qui contredirait le cloisonnement décidé en D12.
    album_id    TEXT NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    -- Pas de clé étrangère vers media : deleteStale retire une photo dès
    -- qu'une synchronisation ne la revoit pas — dossier renommé, sync
    -- interrompue, corbeille Drive le temps d'un retour en arrière. Une cascade
    -- détruirait les commentaires sur un simple contretemps d'indexation, alors
    -- que l'identifiant Drive est stable : la photo revenue retrouve son fil.
    media_id    TEXT NOT NULL,
    -- ON DELETE SET NULL et non CASCADE : supprimer un compte emporte ses
    -- messages, mais les réponses que d'autres y ont écrites leur appartiennent.
    -- Elles remontent en tête de fil plutôt que de disparaître avec lui.
    parent_id   INTEGER REFERENCES comments (id) ON DELETE SET NULL,
    -- COLLATE NOCASE comme la colonne référencée : la clé étrangère compare déjà
    -- avec la collation du parent, l'écrire ici évite qu'un index posé plus tard
    -- sur cette colonne se comporte autrement que la contrainte.
    username    TEXT NOT NULL COLLATE NOCASE REFERENCES users (username) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    -- Modération a posteriori : le commentaire est publié tout de suite et
    -- masqué après coup, plutôt que retenu jusqu'à validation. Masquer plutôt que
    -- supprimer laisse à l'administrateur le droit de se raviser.
    hidden_at   TEXT,
    hidden_by   TEXT COLLATE NOCASE
  );

  -- Sert la lecture d'un fil et le compteur affiché avec le détail d'un média.
  -- Trier sur id plutôt que sur created_at suffit : AUTOINCREMENT ne réattribue
  -- jamais un identifiant, donc l'ordre des id est l'ordre d'écriture. C'est ce
  -- qui permet aussi à la file de modération de paginer sur un simple entier
  -- plutôt que sur un curseur (date, id).
  CREATE INDEX idx_comments_thread ON comments (album_id, media_id, id);
  -- Sert le rattachement des réponses à leur racine, et leur remontée en tête de
  -- fil quand le parent disparaît (ON DELETE SET NULL ci-dessus).
  CREATE INDEX idx_comments_parent ON comments (parent_id);

  -- Le nom affiché sépare l'identité de connexion de l'identité sociale : on
  -- signe « Mamie » sans avoir à se connecter sous ce nom. NULL = on s'en tient
  -- à l'identifiant.
  ALTER TABLE users ADD COLUMN display_name TEXT;
  -- Adresse de notification. NULL est le cas normal d'une instance qui n'envoie
  -- pas d'email : la fonctionnalité s'éteint d'elle-même, compte par compte.
  ALTER TABLE users ADD COLUMN email TEXT;
  -- Désabonnement. Une colonne plutôt qu'une adresse effacée : se désabonner ne
  -- doit pas obliger l'administrateur à ressaisir l'adresse pour réabonner.
  ALTER TABLE users ADD COLUMN notify INTEGER NOT NULL DEFAULT 1;
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
