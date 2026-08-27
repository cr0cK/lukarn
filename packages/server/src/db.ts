import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/**
 * Three columns are written without any query reading them. This is intentional; do
 * not remove them — SQLite can only drop a column by recreating the table, not worth
 * the gain on a live database:
 *
 * - `media.modified_time` — modification date reported by the storage, the only
 *   chronological reference without EXIF. `takenAt` derives from it during sync;
 *   retaining it permits recalculation without reindexing and diagnosis of surprising
 *   `taken_at` values.
 * - `storage_connections.settings.scope` — for a Drive connection, the scope requested
 *   at consent. When `SCOPES` changes, it shows whether the stored token still covers
 *   the application or consent must be repeated. It was `oauth_token.scope` until
 *   migration 17.
 * - `sessions.created_at` — opening date. `expires_at` suffices for cleanup, but this
 *   is the only trace of how long a session has lingered, the first question after
 *   suspicious access.
 *
 * Migrations applied in order and tracked by `PRAGMA user_version`.
 * Never change a published migration: add a new one.
 *
 * Exported so tests can reconstruct an older database and verify lossless upgrades.
 */
export const MIGRATIONS: string[] = [
  // 1 — initial schema
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

  -- Supports chronological grid sorting and cursor pagination.
  CREATE INDEX idx_media_album_taken ON media (album_id, taken_at DESC, id DESC);
  -- Supports mediaId -> albums resolution for access control.
  CREATE INDEX idx_media_id ON media (id);

  CREATE TABLE sync_state (
    album_id      TEXT PRIMARY KEY,
    last_sync_at  TEXT,
    status        TEXT NOT NULL DEFAULT 'never',
    error         TEXT
  );

  -- Single row (id = 1): the encrypted Google refresh token.
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

  // 2 — records Google refresh-token revocation (`invalid_grant`) so /admin can
  // distinguish "never connected" from "access removed".
  `
  ALTER TABLE oauth_token ADD COLUMN revoked_at TEXT;
  `,

  // 3 — moves accounts, albums and settings from config/albums.yaml to the database.
  // The file only bootstraps new installations and is never reread once populated.
  `
  CREATE TABLE users (
    -- COLLATE NOCASE on the primary key: sign-in is already case-insensitive, so
    -- uniqueness must be too; otherwise "Alexis" and "alexis" could coexist and
    -- sign-in would select one arbitrarily. Entered casing remains stored and displayed.
    -- A second lower-case column would risk divergence. NOCASE folds only ASCII,
    -- exactly what USERNAME_PATTERN accepts.
    username       TEXT PRIMARY KEY COLLATE NOCASE,
    password_hash  TEXT NOT NULL,
    admin          INTEGER NOT NULL DEFAULT 0,
    -- "All albums" wildcard. A boolean rather than a '*' row in user_albums, which
    -- would require a fictitious album or no foreign key. The wildcard must also
    -- include future albums, unlike a fixed association list.
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
    -- Display rank. Replaces YAML declaration order, which created_at cannot reproduce
    -- because bootstrap creates all albums in the same millisecond.
    position     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  -- ON DELETE CASCADE: an orphan association would grant access to a later recreated
  -- account with the same name or album with the same ID.
  CREATE TABLE user_albums (
    username  TEXT NOT NULL REFERENCES users (username) ON DELETE CASCADE,
    album_id  TEXT NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    PRIMARY KEY (username, album_id)
  );

  -- Supports "who has access to this album" in administration.
  CREATE INDEX idx_user_albums_album ON user_albums (album_id);

  -- Settings as JSON key/value pairs. Defaults live in code: a missing key is valid,
  -- and adding a setting requires no migration.
  CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
  `,

  // 4 — comments and the identity signing them.
  //
  // Two levels that must remain distinct, the entire reason for this migration:
  //
  //   users      — an ACCESS KEY. It opens albums and may be shared by several people;
  //                a family-wide password has been intended since albums.yaml.
  //   commenters — a PERSON identified by an address they verified themselves. This
  //                person signs a comment.
  //
  // Conflating them would sign every household message as "family" and make the
  // administrator responsible for addresses that are not theirs.
  `
  CREATE TABLE commenters (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    -- The address IS the identity: identifying again with it from another device or
    -- after clearing cookies finds the same comments. Without this stable key, every
    -- browser would create another person.
    email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name    TEXT NOT NULL,
    notify          INTEGER NOT NULL DEFAULT 1,
    -- NULL until the emailed code is entered. Without verification, identity would be
    -- purely declarative: anyone behind the shared access key could use another name
    -- or send notifications to a third party.
    verified_at     TEXT,
    -- HMAC of the code, never plaintext: a database dump must not validate an address.
    -- Uses SESSION_SECRET, like the unsubscribe link.
    code_hash       TEXT,
    code_expires_at TEXT,
    -- Last delivery date: without it, the form could bombard an uncontrolled address.
    code_sent_at    TEXT,
    -- Six digits can be exhausted in one million attempts. Without a cap,
    -- verification would verify nothing.
    code_attempts   INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
  );

  -- The session remembers identity; it does not define it. ON DELETE SET NULL: losing
  -- identity does not revoke album access, which comes only from the access key.
  ALTER TABLE sessions ADD COLUMN commenter_id INTEGER REFERENCES commenters (id) ON DELETE SET NULL;

  -- AUTOINCREMENT unlike an ordinary rowid: otherwise SQLite reuses a deleted row's
  -- ID. Notification emails link to #<id> and remain for months; a recycled ID would
  -- point an old message to someone else's conversation.
  CREATE TABLE comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    -- A thread belongs to (album, media), never media alone: one Drive file in two
    -- albums has two conversations. Mixing them would expose words from an inaccessible
    -- album, contradicting isolation in D12.
    album_id    TEXT NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    -- No foreign key to media: deleteStale removes a photo whenever sync misses it —
    -- renamed folder, interrupted sync or temporary Drive bin. A cascade would destroy
    -- comments over an indexing incident, while stable Drive IDs let returning photos
    -- recover their thread.
    media_id    TEXT NOT NULL,
    -- ON DELETE SET NULL, not CASCADE: deleting an identity removes its messages, but
    -- replies written by others belong to them and rise to thread roots instead.
    parent_id   INTEGER REFERENCES comments (id) ON DELETE SET NULL,
    -- The author is a person, not an access key.
    commenter_id INTEGER NOT NULL REFERENCES commenters (id) ON DELETE CASCADE,
    -- Access key used to write, retained for moderation: it identifies which shared
    -- password delivered a problem and must change. ON DELETE SET NULL — deleting an
    -- account must not remove comments it does not own.
    account     TEXT COLLATE NOCASE REFERENCES users (username) ON DELETE SET NULL,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    -- Moderation after publication: comments appear immediately and may be hidden
    -- later rather than awaiting approval. Hiding keeps the decision reversible.
    hidden_at   TEXT,
    hidden_by   TEXT COLLATE NOCASE
  );

  -- Supports thread reads and the count shown with media details. Sorting by ID is
  -- enough: AUTOINCREMENT never reassigns IDs, so ID order is insertion order. This
  -- also lets moderation paginate by one integer rather than a (date, id) cursor.
  CREATE INDEX idx_comments_thread ON comments (album_id, media_id, id);
  -- Supports attaching replies to roots and promoting them when the parent disappears
  -- (ON DELETE SET NULL above).
  CREATE INDEX idx_comments_parent ON comments (parent_id);
  -- Supports "my comments": those the current reader may delete.
  CREATE INDEX idx_comments_commenter ON comments (commenter_id);
  `,

  // 5 — announces an album's new photos to those who open it.
  //
  // Identity is attached to no album: access comes from the key and identity from the
  // verified address. There is no inherent recipient, hence subscription on opening
  // and this table to store it.
  `
  CREATE TABLE album_subscriptions (
    commenter_id INTEGER NOT NULL REFERENCES commenters (id) ON DELETE CASCADE,
    album_id     TEXT NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    -- 'auto': subscribed by opening the album. 'opted_out': unsubscribed.
    --
    -- State rather than mere presence because subscription is automatic: otherwise
    -- reopening after unsubscribing would resubscribe. INSERT OR IGNORE retains an
    -- existing 'opted_out' row.
    state        TEXT NOT NULL CHECK (state IN ('auto', 'opted_out')),
    created_at   TEXT NOT NULL,
    PRIMARY KEY (commenter_id, album_id)
  );

  -- Supports "who subscribes to this album", the notifier's only read. The reverse
  -- direction is covered by the primary key.
  CREATE INDEX idx_album_subscriptions_album ON album_subscriptions (album_id);

  -- Date of last announced photos. Without it a second sync would reannounce everything.
  -- NULL on an existing database: the first run initialises without sending, avoiding
  -- an announcement of all history after upgrade.
  ALTER TABLE sync_state ADD COLUMN notified_at TEXT;

  -- Index insertion date, set on INSERT and NEVER touched by upsertMany's ON CONFLICT
  -- DO UPDATE. seen_at cannot serve: sync rewrites it for *all* media, so it would
  -- count every item as new.
  --
  -- Existing rows remain NULL and WHERE added_at > ? excludes them, preventing
  -- retroactive announcement of a whole album.
  ALTER TABLE media ADD COLUMN added_at TEXT;
  `,

  // 6 — renaming happens only after code validation.
  //
  // `requestCode` previously wrote `display_name` before verification, so requesting
  // a code for a verified third-party address renamed its identity and all past
  // comments. The requested name now waits until the code proves inbox control.
  `
  ALTER TABLE commenters ADD COLUMN pending_display_name TEXT;
  `,

  // 7 — annotates a day and names the place its photos already carry.
  //
  // Two place columns are the point of this migration: `cells` comes from EXIF while
  // `place` is manual. Position aggregation is deterministic and offline; geocoding
  // is slow and fallible. Separation permits free recalculation without recalling
  // Nominatim, and labels appear when they arrive.
  `
  CREATE TABLE album_days (
    album_id    TEXT NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    -- 'YYYY-MM-DD' in UTC, exactly the key calculated by front-end dayKey(). A local
    -- day would move a 23:30 photo to another section.
    day         TEXT NOT NULL,
    description TEXT,
    -- Manually entered place. Takes precedence over cells: recalculation must not
    -- overwrite a correction.
    place       TEXT,
    -- JSON string[] of geo_places keys in chronological cluster order. Rewritten on
    -- every pass; description and place never are.
    cells       TEXT,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (album_id, day)
  );

  -- Reverse-geocoding cache shared by all albums: two stays in one place cost one
  -- Nominatim call, whose policy caps requests at one per second.
  CREATE TABLE geo_places (
    -- 'lat,lng' rounded to 2 decimals, ~1.1 km — below this grid size two photos have
    -- the same place name anyway.
    cell       TEXT PRIMARY KEY,
    -- NULL: geocoding completed without a usable result. The row prevents endless
    -- retries; a network failure writes no row and is retried next pass.
    label      TEXT,
    fetched_at TEXT NOT NULL
  );

  -- Default grid grouping. It previously lived only in the URL, effectively nowhere:
  -- a holiday album reads by day and ten years of children by month, without asking
  -- on every opening.
  ALTER TABLE albums ADD COLUMN group_by TEXT NOT NULL DEFAULT 'month'
    CHECK (group_by IN ('month', 'day'));
  `,

  // 8 — makes album covers selectable rather than always newest. NULL means
  // "automatic" and remains the permanent fallback.
  //
  // No foreign key to media for the same reason as comments.media_id: deleteStale may
  // remove a temporarily missing photo. A cascade would erase the choice over an
  // indexing incident; stable Drive IDs let it become cover again on return while the
  // album shows the newest meanwhile.
  `
  ALTER TABLE albums ADD COLUMN cover_media_id TEXT;
  `,

  // 9 — one description per photo. Album says where, day says what happened; one
  // image's event cannot be inferred from file name, EXIF or day note.
  `
  CREATE TABLE media_notes (
    -- Text belongs to (album, media), never media alone: one Drive file in two albums
    -- has two descriptions, like two comment threads. Mixing them would expose text
    -- from an inaccessible album, contradicting D12.
    album_id    TEXT NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    -- No foreign key to media for the reasons behind comments.media_id and
    -- albums.cover_media_id: deleteStale may remove a temporarily missing photo. A
    -- cascade would destroy irreplaceable manual text; stable Drive IDs let returning
    -- photos recover their description (D83).
    media_id    TEXT NOT NULL,
    description TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (album_id, media_id)
  );
  `,

  // 10 — records whether Drive produced a file preview, allowing video thumbnails
  // without decoding one video byte here (D92).
  //
  // Default 0 is deliberate: existing rows show no preview until the next sync fills
  // the column. A temporary absence is better than one doomed 415 request per video
  // and grid load for information only sync can provide.
  `
  ALTER TABLE media ADD COLUMN has_thumbnail INTEGER NOT NULL DEFAULT 0;
  `,

  // 11 — search index: four **external-content** FTS5 tables maintained by triggers.
  //
  // Search cost is not the query — a few thousand rows in under a millisecond — but
  // maintaining the index. Text is written from six places (ConfigRepo.saveAlbum,
  // AlbumDayRepo.upsertNote and .replaceCells, Geocoder, MediaRepo.setDescription and
  // cascading album deletion). Code-side indexing would need every present and future
  // path; a stale index silently returns fewer results.
  //
  // `content='<table>'`: FTS stores only the index, never text copies. Every write must
  // propagate, hence three triggers per table — deletion uses the 'delete' command
  // with **old** values, the only way FTS5 can find terms after the row is gone.
  //
  // The tokenizer folds diacritics: "ete" finds "été" and "nim" finds "Nîmes"
  // without a manually maintained normalised column.
  //
  // Final `rebuild` indexes existing data: otherwise a live instance would become
  // searchable only through future writes, never for untouched albums (D96).
  `
  CREATE VIRTUAL TABLE albums_fts USING fts5(
    title, description,
    content='albums', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER albums_ai AFTER INSERT ON albums BEGIN
    INSERT INTO albums_fts (rowid, title, description)
      VALUES (new.rowid, new.title, new.description);
  END;
  CREATE TRIGGER albums_ad AFTER DELETE ON albums BEGIN
    INSERT INTO albums_fts (albums_fts, rowid, title, description)
      VALUES ('delete', old.rowid, old.title, old.description);
  END;
  CREATE TRIGGER albums_au AFTER UPDATE ON albums BEGIN
    INSERT INTO albums_fts (albums_fts, rowid, title, description)
      VALUES ('delete', old.rowid, old.title, old.description);
    INSERT INTO albums_fts (rowid, title, description)
      VALUES (new.rowid, new.title, new.description);
  END;

  CREATE VIRTUAL TABLE album_days_fts USING fts5(
    description, place,
    content='album_days', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER album_days_ai AFTER INSERT ON album_days BEGIN
    INSERT INTO album_days_fts (rowid, description, place)
      VALUES (new.rowid, new.description, new.place);
  END;
  CREATE TRIGGER album_days_ad AFTER DELETE ON album_days BEGIN
    INSERT INTO album_days_fts (album_days_fts, rowid, description, place)
      VALUES ('delete', old.rowid, old.description, old.place);
  END;
  CREATE TRIGGER album_days_au AFTER UPDATE ON album_days BEGIN
    INSERT INTO album_days_fts (album_days_fts, rowid, description, place)
      VALUES ('delete', old.rowid, old.description, old.place);
    INSERT INTO album_days_fts (rowid, description, place)
      VALUES (new.rowid, new.description, new.place);
  END;

  CREATE VIRTUAL TABLE media_notes_fts USING fts5(
    description,
    content='media_notes', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER media_notes_ai AFTER INSERT ON media_notes BEGIN
    INSERT INTO media_notes_fts (rowid, description) VALUES (new.rowid, new.description);
  END;
  CREATE TRIGGER media_notes_ad AFTER DELETE ON media_notes BEGIN
    INSERT INTO media_notes_fts (media_notes_fts, rowid, description)
      VALUES ('delete', old.rowid, old.description);
  END;
  CREATE TRIGGER media_notes_au AFTER UPDATE ON media_notes BEGIN
    INSERT INTO media_notes_fts (media_notes_fts, rowid, description)
      VALUES ('delete', old.rowid, old.description);
    INSERT INTO media_notes_fts (rowid, description) VALUES (new.rowid, new.description);
  END;

  CREATE VIRTUAL TABLE geo_places_fts USING fts5(
    label,
    content='geo_places', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER geo_places_ai AFTER INSERT ON geo_places BEGIN
    INSERT INTO geo_places_fts (rowid, label) VALUES (new.rowid, new.label);
  END;
  CREATE TRIGGER geo_places_ad AFTER DELETE ON geo_places BEGIN
    INSERT INTO geo_places_fts (geo_places_fts, rowid, label)
      VALUES ('delete', old.rowid, old.label);
  END;
  CREATE TRIGGER geo_places_au AFTER UPDATE ON geo_places BEGIN
    INSERT INTO geo_places_fts (geo_places_fts, rowid, label)
      VALUES ('delete', old.rowid, old.label);
    INSERT INTO geo_places_fts (rowid, label) VALUES (new.rowid, new.label);
  END;

  INSERT INTO albums_fts (albums_fts) VALUES ('rebuild');
  INSERT INTO album_days_fts (album_days_fts) VALUES ('rebuild');
  INSERT INTO media_notes_fts (media_notes_fts) VALUES ('rebuild');
  INSERT INTO geo_places_fts (geo_places_fts) VALUES ('rebuild');
  `,

  // 12 — default grid reading order beside grouping. It previously lived in one global
  // constant and only in the URL: trips opened on their last day and a changed order
  // was lost on leaving the page.
  //
  // `DEFAULT 'asc'` switches existing albums deliberately: nobody chose the previous
  // descending order; it was the only available one (D99).
  `
  ALTER TABLE albums ADD COLUMN sort_order TEXT NOT NULL DEFAULT 'asc'
    CHECK (sort_order IN ('desc', 'asc'));
  `,

  // 13 — pairs a keyboardless screen instead of typing a password on it.
  //
  // Transient table: rows live at most five minutes and disappear when the screen
  // claims its session. Pairing grants no new access; it delegates an existing key
  // from an already signed-in approver (D260809c).
  `
  CREATE TABLE device_pairings (
    -- Eight characters displayed on screen and in the QR code. Deliberately plaintext:
    -- they appear in a room, so hashing protects nothing the room cannot already see.
    user_code    TEXT PRIMARY KEY,
    -- HMAC of the 32-byte deviceCode returned only to the requester. IT authorises
    -- claiming the session, never the displayed code; otherwise a television photo
    -- would suffice. Hashed for the commenters.code_hash reason: a database dump must
    -- not impersonate a pending screen.
    device_hash  TEXT NOT NULL UNIQUE,
    -- Approver's account, NULL until approval. CASCADE prevents a request approved by
    -- a subsequently deleted account from becoming a session.
    username     TEXT COLLATE NOCASE REFERENCES users (username) ON DELETE CASCADE,
    approved_at  TEXT,
    created_at   TEXT NOT NULL,
    -- Five minutes. Longer would leave an approvable code on a lit screen.
    expires_at   TEXT NOT NULL
  );

  -- Supports hourly cleanup and the pending-request limit.
  CREATE INDEX idx_device_pairings_expires ON device_pairings (expires_at);
  `,

  // 14 — actual video-track codec, read from `moov` in the same window pass as its date.
  // It decides what is transcoded and which source the client requests (D6).
  //
  // Three values whose distinction matters:
  //
  //   NULL          file never examined — a pre-migration row or header Drive did not
  //                 return. Sync reopens it.
  //   ''            header read, no video track recognised. Reopening every pass would
  //                 reread hundreds of KB for nothing.
  //   'hvc1', …     four-letter code as written in `stsd`.
  //
  // Without the third state, an unusual container would be reread on every sync forever.
  `
  ALTER TABLE media ADD COLUMN video_codec TEXT;
  `,

  // 15 — who views what, and since when.
  //
  // The instance previously said nothing about use: `sessions.created_at` answers
  // "someone once signed in", not "were there visitors this week" or "who opens which
  // album". Comments were the only signal and severely undercount viewing (D260809h).
  `
  -- Last request from this session. Written at most hourly per session; otherwise every
  -- thumbnail would trigger an UPDATE.
  ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;

  -- Device class inferred from user-agent at sign-in, then discarded: only the class
  -- is stored. One of four values cannot re-identify anyone, unlike a full user-agent.
  -- NULL for pre-migration sessions and requests without the header.
  ALTER TABLE sessions ADD COLUMN device TEXT;

  -- Aggregated on write: one row per (album, key, session, day) with counters, never
  -- per request. The table stays around ten rows daily rather than tens of thousands.
  --
  -- No foreign key to sessions or albums, by design: sign-out deletes the session but
  -- must not erase viewing history — session_id is a bucket for distinct visitors,
  -- not a link. A deleted album follows the same rule: past visits remain real.
  --
  -- WITHOUT ROWID: the composite primary key fully defines the table, so an implicit
  -- secondary index would be useless.
  CREATE TABLE album_visits (
    album_id   TEXT NOT NULL,
    -- COLLATE NOCASE like users.username: "Alexis" and "alexis" are one access key;
    -- counting them separately would make one visitor into two.
    username   TEXT NOT NULL COLLATE NOCASE,
    session_id TEXT NOT NULL,
    -- 'YYYY-MM-DD' in UTC, like every date in this repository.
    day        TEXT NOT NULL,
    -- Album openings: the first grid page, never subsequent pages of the same action.
    visits     INTEGER NOT NULL DEFAULT 0,
    -- Photos opened in the viewer.
    photos     INTEGER NOT NULL DEFAULT 0,
    last_at    TEXT NOT NULL,
    PRIMARY KEY (album_id, username, session_id, day)
  ) WITHOUT ROWID;

  -- Supports both "Visits" tab aggregations, bounded by "day >= ?", and annual cleanup.
  CREATE INDEX idx_album_visits_day ON album_visits (day);
  `,

  // 16 — the language a person is written to in.
  //
  // On `commenters` rather than `users`: a username is an access key a household
  // may share, while an email lands in one inbox belonging to one reader. The
  // interface language stays in the browser (`localStorage`), which is what a
  // shared television needs; this column exists only so an email composed hours
  // later reaches its recipient in the language they read (D260812d).
  //
  // NULL until that person's browser announces one: the instance's DEFAULT_LOCALE
  // then applies, rather than a value invented at migration time.
  `
  ALTER TABLE commenters ADD COLUMN locale TEXT;
  `,

  // 17 — the single Google connection becomes a table of storages, and an album says
  // which one it reads.
  //
  // `oauth_token` carried `CHECK (id = 1)`: one instance, one Drive. That constraint
  // was the schema stating a scope decision, and the decision changed — an instance
  // may now serve one album from a Drive and another from a bucket, which requires a
  // row per connection and a column on `albums` (D260815g).
  //
  // **The `ciphertext` column is copied, never re-encrypted.** Re-encrypting would
  // mean decrypting with `TOKEN_KEY` during a migration, where a wrong or missing key
  // destroys an authorisation that only new Google consent can restore. What the
  // encrypted string contains therefore belongs to the kind: Drive's is the refresh
  // token itself, exactly as `oauth_token` stored it.
  `
  CREATE TABLE storage_connections (
    -- A slug chosen by whoever adds the connection — 'drive', 'archives-minio'. It is
    -- written into albums.connection_id and appears in logs, so it is a name rather
    -- than a number.
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    label       TEXT NOT NULL,
    -- JSON, and nothing secret: an endpoint, a bucket, a prefix, a scope. Readable in
    -- a dump without giving access to anything.
    settings    TEXT NOT NULL DEFAULT '{}',
    -- The secret half, encrypted with TOKEN_KEY as the refresh token already was.
    ciphertext  TEXT,
    -- What /admin displays to name the connection: an address, a bucket, a URL.
    account     TEXT,
    granted_at  TEXT,
    revoked_at  TEXT,
    created_at  TEXT NOT NULL,
    -- Display rank, like albums.position: the order connections were added is the
    -- order they are read in, and creation dates collide on a seeded instance.
    position    INTEGER NOT NULL DEFAULT 0
  );

  -- The 'drive' row exists whether or not anything was ever connected. Two
  -- installations depend on it: a fresh database, whose albums default to it, and a
  -- service-account installation, which never had an oauth_token row at all because
  -- its key lives in the environment.
  INSERT INTO storage_connections
    (id, kind, label, settings, ciphertext, account, granted_at, revoked_at, created_at, position)
  VALUES ('drive', 'drive', 'Google Drive',
    COALESCE((SELECT json_object('scope', scope) FROM oauth_token WHERE id = 1), '{}'),
    (SELECT ciphertext FROM oauth_token WHERE id = 1),
    (SELECT account    FROM oauth_token WHERE id = 1),
    (SELECT granted_at FROM oauth_token WHERE id = 1),
    (SELECT revoked_at FROM oauth_token WHERE id = 1),
    COALESCE(
      (SELECT granted_at FROM oauth_token WHERE id = 1),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ),
    0);

  DROP TABLE oauth_token;

  -- Which storage an album reads. DEFAULT 'drive' names the row inserted above, so
  -- every existing album keeps reading exactly what it was reading.
  --
  -- **No REFERENCES clause**: SQLite refuses to add a column carrying a foreign key
  -- unless its default is NULL, and a nullable connection would mean an album pointing
  -- nowhere. StorageConnectionRepo refuses to delete a connection an album still
  -- names, which is the same guarantee stated where its message can be read.
  ALTER TABLE albums ADD COLUMN connection_id TEXT NOT NULL DEFAULT 'drive';

  -- Readable path of the file inside its container, for a backend whose reference is
  -- a path rather than an opaque identifier. NULL for Drive, whose file id already
  -- survives a rename.
  ALTER TABLE media ADD COLUMN source_path TEXT;
  `,

  // 18 — an account may be a person, and the code apparatus leaves `commenters` for a
  // table of its own.
  //
  // `users` carries authorisation and `commenters` carries identity; a code is neither,
  // and D39 put its four columns on `commenters` when there was one thing to prove. A
  // second use would turn them into one column set with two meanings, and one pending
  // code per address means verifying an address while signing in overwrites one with
  // the other.
  //
  // **Pending codes are invalidated by this upgrade**, deliberately rather than as a
  // side effect: they survive a restart today because they live in SQLite, so this is
  // a fifteen-minute cost paid once, at a moment somebody chose.
  `
  -- The person this access key is, or NULL for a key a household shares. The UNIQUE
  -- index over it counts multiple NULLs as distinct, which is exactly "many unbound
  -- accounts, at most one account per person". The column may carry its REFERENCES
  -- clause because its default is NULL — the same restriction albums.connection_id
  -- met in migration 17 and could not satisfy (D260815g).
  --
  -- ON DELETE SET NULL rather than CASCADE: forgetting who somebody is must not
  -- delete the account, its album grants and everything written against its username.
  ALTER TABLE users ADD COLUMN commenter_id INTEGER REFERENCES commenters (id) ON DELETE SET NULL;
  CREATE UNIQUE INDEX idx_users_commenter ON users (commenter_id);

  CREATE TABLE verification_codes (
    -- The address the code was sent to. COLLATE NOCASE like commenters.email, so one
    -- inbox is one row whatever case somebody typed.
    target      TEXT    NOT NULL COLLATE NOCASE,
    -- Part of the key rather than a flag: a code minted for one flow is then not
    -- merely refused by another, it is not found by it.
    purpose     TEXT    NOT NULL CHECK (purpose IN ('identity', 'signin', 'invite')),
    -- HMAC of the six digits, never plaintext, for the reason D39 gives: a database
    -- dump must not validate an address or open a session.
    code_hash   TEXT    NOT NULL,
    -- Fifteen minutes for 'identity' and 'signin', seven days for 'invite', which has
    -- to survive somebody's weekend.
    expires_at  TEXT    NOT NULL,
    -- Last delivery, read across every purpose of one address: without it the routes
    -- become a way to send bursts of email to an inbox nobody proved they own.
    sent_at     TEXT    NOT NULL,
    -- Five attempts, whatever the purpose. Six digits fall to a million tries, and a
    -- seven-day life is why the ceiling matters more here than anywhere else.
    attempts    INTEGER NOT NULL DEFAULT 0,
    -- The account an invitation is for, NULL for every other purpose. COLLATE NOCASE
    -- is not decoration: users.username is NOCASE, and a child column left on the
    -- default would let 'Mamie' and 'mamie' both satisfy the partial index below and
    -- both be invitations to one account. ON DELETE CASCADE stops a deleted account
    -- leaving its code behind, where recreating the same username would let the
    -- original recipient bind an account that may now be an administrator.
    username    TEXT    COLLATE NOCASE REFERENCES users (username) ON DELETE CASCADE,
    -- Every column but username is stated NOT NULL: a composite primary key does
    -- not impose it in SQLite, where a rowid table accepts a null inside one.
    PRIMARY KEY (target, purpose),
    -- Two invariants nothing else states. The second is an equality rather than two
    -- implications: an invitation without an account has nothing to bind, and a
    -- sign-in code naming one would bind it without anybody proving the address.
    CHECK ((purpose = 'invite') = (username IS NOT NULL))
  );

  -- One invitation per address is not the invariant that matters; one invitation per
  -- **account** is. Without this index, inviting mamie at one address and then at
  -- another leaves two live codes racing to bind the same account, and reminting the
  -- pending invitation has no single row to work from.
  CREATE UNIQUE INDEX idx_verification_codes_invite
    ON verification_codes (username) WHERE purpose = 'invite';

  -- What is left on commenters is what a person is. Nothing indexes these four, so
  -- ALTER TABLE … DROP COLUMN applies without recreating the table.
  --
  -- pending_display_name **stays**: the rule it enforces is about the name, not
  -- about the code — requesting a code renames nobody (D42) — and dropping it would
  -- restore a rename this repository already closed.
  ALTER TABLE commenters DROP COLUMN code_hash;
  ALTER TABLE commenters DROP COLUMN code_expires_at;
  ALTER TABLE commenters DROP COLUMN code_sent_at;
  ALTER TABLE commenters DROP COLUMN code_attempts;
  `,

  // 19 — the language an invitation is written in.
  //
  // Every other message this instance sends goes to somebody whose browser has
  // already announced a language, recorded on `commenters.locale` (D260812d). An
  // invitation is the one message composed for a person nothing here has ever met,
  // so the choice belongs to whoever invites them — the only party who knows what
  // language the recipient reads. It sits on the code rather than in the request
  // because it has to outlive it: sending the invitation again must not arrive in
  // another language, and accepting it seeds the identity with the choice.
  //
  // Nullable rather than DEFAULT 'en': a row written before this column existed
  // carries no choice, and the instance's DEFAULT_LOCALE keeps applying to it. A
  // default would freeze the language of the day into rows nobody chose it for, and
  // "chosen" and "never asked" would stop being distinguishable.
  `
  ALTER TABLE verification_codes ADD COLUMN locale TEXT;
  `,

  // 20 — an album, or one photograph, opened by somebody with no account.
  //
  // A link is a **fourth** credential beside the owner's Google consent, the access
  // key and the person who comments (D260825). It is a row rather than a signed
  // token because it is defined by being revocable: the three tokens already minted
  // here carry no row, which is what makes them impossible to take back.
  //
  // Two existing tables are recreated, for one reason between them: both assumed the
  // only credential was an access key. SQLite can drop neither a NOT NULL nor a
  // foreign key in place.
  `
  CREATE TABLE share_links (
    -- Thirty-two bytes from randomBytes, base64url, exactly as a session identifier
    -- is. Never an HMAC over what it grants: the rights live in this row, so
    -- revoking is a write that lands on the next request (D260825).
    token       TEXT PRIMARY KEY,
    -- The album the link covers, or the album its photograph was taken from. Never
    -- sent to the recipient of a single photograph (D260825e); it is here because
    -- the thread still resolves through (album_id, media_id) like every other (D34).
    --
    -- ON DELETE CASCADE: a link to a deleted album grants nothing, and keeping the
    -- row would leave administration listing a credential for content that is gone.
    album_id    TEXT NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    -- NULL for an album link, the shared photograph otherwise. No foreign key, for
    -- the reason comments carry none: deleteStale removes a photo whenever a sync
    -- misses it, and an indexing incident must not silently destroy a link somebody
    -- has already sent.
    media_id    TEXT,
    -- What the issuer calls it. Administration only: nothing the recipient reads
    -- carries it, so it may name the person it was sent to.
    label       TEXT,
    created_at  TEXT NOT NULL,
    -- The account that issued it, retained because it says who let this content out.
    -- No foreign key, so a deleted account leaves the record true rather than blank —
    -- the argument D260809h already makes for album_visits.
    created_by  TEXT NOT NULL COLLATE NOCASE,
    -- NULL for a link that never expires. Evaluated against this row rather than
    -- baked into the token, so a date can be changed or removed after the link was
    -- sent (D260825b).
    expires_at  TEXT,
    -- Set rather than deleted: with the row gone, revoked and never-existed become
    -- the same state and the server has nothing left to tell them apart with
    -- (D260825b).
    revoked_at  TEXT
  );

  -- Supports administration's list, ordered newest first within an album, and the
  -- cascade above.
  CREATE INDEX idx_share_links_album ON share_links (album_id);

  -- One row per opening, carrying the link, the session and the time (D260825c).
  --
  -- Not album_visits: that table is WITHOUT ROWID on a key whose second column is a
  -- username, and a link has none. Its aggregation to the day was accepted on
  -- grounds of scale that are absent here — a link is opened by a handful of people
  -- a handful of times, and the question asked an hour after sending an album is
  -- whether it arrived.
  --
  -- The primary key **is** the once-per-session-per-hour rule, following the
  -- threshold sessions.last_seen_at already uses: a reader who refreshes the page
  -- does not turn one visit into six.
  --
  -- The boundary D260809h drew does not move: never the photograph looked at, never
  -- an address, never an IP. session_id is a bucket for telling two visitors apart,
  -- as it already is in album_visits, and not a link to anything.
  CREATE TABLE share_openings (
    -- ON DELETE CASCADE, unlike album_visits, which deliberately has no foreign key:
    -- deleting a link is the one gesture that must erase its history, and revoking
    -- keeps both because the history is what justified the decision (D260825b).
    token      TEXT NOT NULL REFERENCES share_links (token) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    -- 'YYYY-MM-DDTHH' in UTC, like every other date here.
    hour       TEXT NOT NULL,
    opened_at  TEXT NOT NULL,
    PRIMARY KEY (token, session_id, hour)
  ) WITHOUT ROWID;

  -- sessions: a session a link opened points at it and carries no username. Every
  -- column is carried over unchanged; only the NOT NULL goes.
  CREATE TABLE sessions_next (
    id           TEXT PRIMARY KEY,
    username     TEXT,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    commenter_id INTEGER REFERENCES commenters (id) ON DELETE SET NULL,
    last_seen_at TEXT,
    device       TEXT,
    -- ON DELETE CASCADE: deleting a link closes the sessions it opened, for the
    -- reason changing a password does. Revoking does the same through a DELETE the
    -- repository issues, since the row itself stays (D260825b).
    share_token  TEXT REFERENCES share_links (token) ON DELETE CASCADE,
    -- The invariant the rest of the server would otherwise only be trusted to keep:
    -- a session belongs to exactly one credential, never both and never neither.
    CHECK ((username IS NULL) <> (share_token IS NULL))
  );

  INSERT INTO sessions_next (id, username, created_at, expires_at, commenter_id,
                             last_seen_at, device, share_token)
    SELECT id, username, created_at, expires_at, commenter_id,
           last_seen_at, device, NULL
      FROM sessions;

  DROP TABLE sessions;
  ALTER TABLE sessions_next RENAME TO sessions;

  CREATE INDEX idx_sessions_expires ON sessions (expires_at);
  -- Supports closing a link's sessions when it is revoked, which is what revoking is
  -- for: an already-open browser has to stop.
  CREATE INDEX idx_sessions_share ON sessions (share_token);

  -- comments: account holds the credential that carried the message, which is now
  -- either an access key or a link (D38, D260825). It therefore loses its foreign
  -- key to users — a token is not a username — and with it the ON DELETE SET NULL
  -- that blanked the column when an account was removed.
  --
  -- Losing that is the right way round, and album_visits already made the argument:
  -- what wrote a comment stays true after the credential is gone, and moderation
  -- reads this column to answer "which invitation delivered this", which a blank
  -- cannot answer. Nothing dereferences it — it is displayed, never joined.
  --
  -- parent_id is declared against comments_next so the rename below rewrites it to
  -- the final name; declared against the live table it would point at the one this
  -- migration is replacing.
  CREATE TABLE comments_next (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id     TEXT NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    media_id     TEXT NOT NULL,
    parent_id    INTEGER REFERENCES comments_next (id) ON DELETE SET NULL,
    commenter_id INTEGER NOT NULL REFERENCES commenters (id) ON DELETE CASCADE,
    account      TEXT COLLATE NOCASE,
    body         TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    hidden_at    TEXT,
    hidden_by    TEXT COLLATE NOCASE
  );

  -- ORDER BY id so a reply never arrives before the comment it answers: this foreign
  -- key is immediate, not deferred, and rowid order is only incidentally the same.
  INSERT INTO comments_next (id, album_id, media_id, parent_id, commenter_id,
                             account, body, created_at, hidden_at, hidden_by)
    SELECT id, album_id, media_id, parent_id, commenter_id,
           account, body, created_at, hidden_at, hidden_by
      FROM comments ORDER BY id;

  -- The rows are copied; the **counter** is not, and it has to be. AUTOINCREMENT
  -- never reissues an identifier because a notification email links to one and
  -- sits in an inbox for months, where a recycled one would point an old message at
  -- somebody else's conversation (migration 4). The copy only ever reaches max(id),
  -- which is lower than the old counter whenever the newest comment had been
  -- deleted — measured on a moderated database: 5 became 3, and the next comment
  -- took 4 back.
  --
  -- The INSERT covers a table whose every comment had been deleted: nothing was
  -- copied, so comments_next has no counter of its own for the UPDATE to raise.
  INSERT INTO sqlite_sequence (name, seq)
    SELECT 'comments_next', 0
     WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'comments_next');

  UPDATE sqlite_sequence
     SET seq = MAX(seq, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'comments'), 0))
   WHERE name = 'comments_next';

  DROP TABLE comments;
  ALTER TABLE comments_next RENAME TO comments;

  CREATE INDEX idx_comments_thread ON comments (album_id, media_id, id);
  CREATE INDEX idx_comments_parent ON comments (parent_id);
  CREATE INDEX idx_comments_commenter ON comments (commenter_id);
  `,
];

export function openDb(dataDir: string): Db {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, 'lukarn.db'));

  // WAL: grid reads do not block background sync writes.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  // A concurrent write waits instead of returning SQLITE_BUSY.
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
      throw new Error(`Migration ${version + 1} failed: ${(error as Error).message}`);
    }
  }
}
