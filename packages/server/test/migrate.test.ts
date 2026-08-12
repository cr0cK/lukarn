import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { MIGRATIONS, migrate } from '../src/db.js';

/**
 * Updating an existing database. A live instance contains an index and refresh
 * token that no upgrade may lose, so migrations resume from the detected
 * version, never from zero.
 */

/** Database frozen at `version`, as after an older deployment. */
function databaseAtVersion(version: number): Database.Database {
  const db = new Database(':memory:');
  for (let index = 0; index < version; index++) db.exec(MIGRATIONS[index]!);
  db.pragma(`user_version = ${version}`);
  return db;
}

function columns(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((row) => row.name);
}

describe('migrations', () => {
  it('brings a fresh database to the latest version', () => {
    const db = databaseAtVersion(0);
    migrate(db);
    assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length);
    db.close();
  });

  it('adds revoked_at to a version 1 database without losing the token', () => {
    const db = databaseAtVersion(1);

    // State of a live instance: an already authorised refresh token.
    db.prepare(
      `INSERT INTO oauth_token (id, ciphertext, account, scope, granted_at)
       VALUES (1, 'chiffré', 'photos@exemple.fr', 'drive.readonly', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO media (album_id, id, name, mime_type, kind, taken_at, modified_time, seen_at)
       VALUES ('vacances', 'abc', 'IMG.jpg', 'image/jpeg', 'photo',
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();

    migrate(db);

    assert.ok(columns(db, 'oauth_token').includes('revoked_at'));

    const token = db.prepare('SELECT * FROM oauth_token WHERE id = 1').get() as {
      account: string;
      ciphertext: string;
      revoked_at: string | null;
    };
    // The token survives and is not considered revoked: the instance continues
    // working after the update without new consent.
    assert.equal(token.account, 'photos@exemple.fr');
    assert.equal(token.ciphertext, 'chiffré');
    assert.equal(token.revoked_at, null);

    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM media').get() as { n: number }).n,
      1,
      'the index must be preserved',
    );

    db.close();
  });

  it('adds configuration tables to a version 2 database without touching the index', () => {
    const db = databaseAtVersion(2);
    db.prepare(
      `INSERT INTO media (album_id, id, name, mime_type, kind, taken_at, modified_time, seen_at)
       VALUES ('vacances', 'abc', 'IMG.jpg', 'image/jpeg', 'photo',
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();

    migrate(db);

    for (const table of ['users', 'albums', 'user_albums', 'settings']) {
      assert.ok(columns(db, table).length > 0, `missing table ${table}`);
      // Tables start empty: `bootstrap.ts` fills them from `albums.yaml` when
      // the instance had one.
      assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, 0);
    }

    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM media').get() as { n: number }).n, 1);
    db.close();
  });

  it('adds comments to a version 3 database without touching accounts', () => {
    const db = databaseAtVersion(3);
    db.prepare(
      `INSERT INTO users (username, password_hash, admin, all_albums, created_at, updated_at)
       VALUES ('famille', 'empreinte', 0, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();

    migrate(db);

    // The access key is unchanged: commenter identity lives elsewhere, and
    // mixing them would sign every household message as "famille".
    assert.deepEqual(columns(db, 'users'), [
      'username',
      'password_hash',
      'admin',
      'all_albums',
      'created_at',
      'updated_at',
    ]);
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get('famille') as {
      password_hash: string;
    };
    assert.equal(user.password_hash, 'empreinte');

    assert.ok(columns(db, 'comments').includes('commenter_id'));
    assert.ok(columns(db, 'commenters').includes('verified_at'));
    // The session records identity without the update invalidating open sessions.
    assert.ok(columns(db, 'sessions').includes('commenter_id'));
    db.close();
  });

  it('adds subscriptions to a version 4 database without losing anything', () => {
    const db = databaseAtVersion(4);
    db.prepare(
      `INSERT INTO albums (id, title, folder_id, recursive, position, created_at, updated_at)
       VALUES ('vacances', 'Vacances', 'dossier', 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO commenters (email, display_name, verified_at, created_at)
       VALUES ('mamie@exemple.fr', 'Mamie', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO media (album_id, id, name, mime_type, kind, taken_at, modified_time, seen_at)
       VALUES ('vacances', 'abc', 'IMG.jpg', 'image/jpeg', 'photo',
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO sync_state (album_id, last_sync_at, status)
       VALUES ('vacances', '2026-01-01T00:00:00.000Z', 'ok')`,
    ).run();

    migrate(db);

    assert.ok(columns(db, 'album_subscriptions').includes('state'));
    assert.ok(columns(db, 'sync_state').includes('notified_at'));
    assert.ok(columns(db, 'media').includes('added_at'));

    const photo = db.prepare('SELECT * FROM media WHERE id = ?').get('abc') as {
      name: string;
      seen_at: string;
      added_at: string | null;
    };
    // The index, identity and sync state survive intact, and both new columns
    // start as NULL so the first announcement excludes existing photos.
    assert.equal(photo.name, 'IMG.jpg');
    assert.equal(photo.seen_at, '2026-01-01T00:00:00.000Z');
    assert.equal(photo.added_at, null);

    const etat = db.prepare('SELECT * FROM sync_state WHERE album_id = ?').get('vacances') as {
      last_sync_at: string;
      status: string;
      notified_at: string | null;
    };
    assert.equal(etat.last_sync_at, '2026-01-01T00:00:00.000Z');
    assert.equal(etat.status, 'ok');
    assert.equal(etat.notified_at, null);

    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM commenters').get() as { n: number }).n,
      1,
      'verified identities must survive',
    );

    db.close();
  });

  it('keeps the name of a verified identity in version 5', () => {
    const db = databaseAtVersion(5);
    db.prepare(
      `INSERT INTO commenters (email, display_name, verified_at, created_at)
       VALUES ('mamie@exemple.fr', 'Mamie', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();

    migrate(db);

    assert.ok(columns(db, 'commenters').includes('pending_display_name'));
    const identite = db
      .prepare('SELECT * FROM commenters WHERE email = ?')
      .get('mamie@exemple.fr') as {
      display_name: string;
      pending_display_name: string | null;
    };
    // The column starts empty: `COALESCE(pending, display_name)` on the first
    // verified code must not rename anybody.
    assert.equal(identite.display_name, 'Mamie');
    assert.equal(identite.pending_display_name, null);

    db.close();
  });

  it('adds days and grouping to a version 6 database', () => {
    const db = databaseAtVersion(6);
    db.prepare(
      `INSERT INTO albums (id, title, folder_id, recursive, position, created_at, updated_at)
       VALUES ('vacances', 'Vacances', 'dossier', 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();

    migrate(db);

    assert.ok(columns(db, 'album_days').includes('cells'));
    assert.ok(columns(db, 'geo_places').includes('label'));

    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get('vacances') as {
      title: string;
      group_by: string;
    };
    // Existing albums receive their effective grouping: `month` is the default
    // the URL already applied without a preference.
    assert.equal(album.title, 'Vacances');
    assert.equal(album.group_by, 'month');

    db.close();
  });

  it('adds photo descriptions to a version 8 database', () => {
    const db = databaseAtVersion(8);
    db.prepare(
      `INSERT INTO albums (id, title, folder_id, recursive, position, created_at, updated_at)
       VALUES ('vacances', 'Vacances', 'dossier', 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO media (album_id, id, name, mime_type, kind, taken_at, modified_time, seen_at)
       VALUES ('vacances', 'abc', 'IMG.jpg', 'image/jpeg', 'photo',
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();

    migrate(db);

    assert.ok(columns(db, 'media_notes').includes('description'));
    // The table starts empty and the index stays intact: a live instance sees
    // nothing change until somebody describes a photo.
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM media_notes').get() as { n: number }).n, 0);
    assert.equal(
      (db.prepare('SELECT name FROM media WHERE id = ?').get('abc') as { name: string }).name,
      'IMG.jpg',
    );

    // No foreign key to `media`: this is the table's purpose, and a later
    // migration must not "fix" it (D83).
    const references = (db.pragma('foreign_key_list(media_notes)') as { table: string }[]).map(
      (row) => row.table,
    );
    assert.deepEqual(references, ['albums']);

    db.close();
  });

  it('adds the Drive preview to a version 9 database without promising one', () => {
    const db = databaseAtVersion(9);
    db.prepare(
      `INSERT INTO media (album_id, id, name, mime_type, kind, taken_at, modified_time, seen_at)
       VALUES ('vacances', 'clip', 'VID.mp4', 'video/mp4', 'video',
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();

    migrate(db);

    const clip = db.prepare('SELECT * FROM media WHERE id = ?').get('clip') as {
      name: string;
      has_thumbnail: number;
    };
    // The video keeps its row and the column starts at 0: only the next sync
    // knows whether Drive has a preview. Claiming otherwise would make the
    // entire library request a possibly missing image on first grid load (D92).
    assert.equal(clip.name, 'VID.mp4');
    assert.equal(clip.has_thumbnail, 0);

    db.close();
  });

  it('makes an already populated version 10 database searchable', () => {
    const db = databaseAtVersion(10);
    const date = '2026-01-01T00:00:00.000Z';
    db.prepare(
      `INSERT INTO albums (id, title, description, folder_id, recursive, position, created_at, updated_at)
       VALUES ('corse', 'Été en Corse', 'Bonifacio et la plage', 'dossier', 1, 0, ?, ?)`,
    ).run(date, date);
    db.prepare(
      `INSERT INTO album_days (album_id, day, description, place, cells, updated_at)
       VALUES ('corse', '2026-07-14', 'Marché du matin', 'Bonifacio', NULL, ?)`,
    ).run(date);
    db.prepare(
      `INSERT INTO media_notes (album_id, media_id, description, updated_at)
       VALUES ('corse', 'abc', 'Léa saute du ponton', ?)`,
    ).run(date);
    db.prepare('INSERT INTO geo_places (cell, label, fetched_at) VALUES (?, ?, ?)').run(
      '41.39,9.16',
      'Bonifacio, Corse-du-Sud',
      date,
    );

    migrate(db);

    // This verifies `rebuild`: without it, triggers would index only
    // **subsequent** writes, leaving a live instance silent about everything it
    // already contains in an album never touched again (D96).
    const count = (table: string, match: string): number =>
      (
        db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table} MATCH ?`).get(match) as {
          n: number;
        }
      ).n;

    assert.equal(count('albums_fts', '"ete"*'), 1);
    assert.equal(count('album_days_fts', '"marche"*'), 1);
    assert.equal(count('media_notes_fts', '"ponton"*'), 1);
    assert.equal(count('geo_places_fts', '"corse"*'), 1);

    db.close();
  });

  it('switches version 11 albums to the order in which they were lived', () => {
    const db = databaseAtVersion(11);
    db.prepare(
      `INSERT INTO albums (id, title, folder_id, recursive, position, created_at, updated_at)
       VALUES ('vacances', 'Vacances', 'dossier', 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();

    migrate(db);

    assert.ok(columns(db, 'albums').includes('sort_order'));

    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get('vacances') as {
      title: string;
      sort_order: string;
    };
    // Existing albums **change** order, unlike grouping: `desc` was the only
    // possible value, nobody chose it, and a trip opened on its last day (D99).
    assert.equal(album.title, 'Vacances');
    assert.equal(album.sort_order, 'asc');

    db.close();
  });

  it('adds pairing to a version 12 database without touching sessions', () => {
    const db = databaseAtVersion(12);
    const date = '2026-01-01T00:00:00.000Z';
    db.prepare(
      `INSERT INTO users (username, password_hash, admin, all_albums, created_at, updated_at)
       VALUES ('famille', '$argon2id$empreinte', 0, 1, ?, ?)`,
    ).run(date, date);
    db.prepare(
      `INSERT INTO sessions (id, username, created_at, expires_at)
       VALUES ('session-en-cours', 'famille', ?, '2027-01-01T00:00:00.000Z')`,
    ).run(date);

    migrate(db);

    // The table starts empty and grants no access: pairing delegates an existing
    // key rather than creating one (D260809c).
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM device_pairings').get() as { n: number }).n,
      0,
    );
    // A live instance crosses it without harming its sessions.
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n, 1);
    assert.deepEqual(columns(db, 'users'), [
      'username',
      'password_hash',
      'admin',
      'all_albums',
      'created_at',
      'updated_at',
    ]);

    db.close();
  });

  it('adds the reading language to a version 15 database without touching an identity', () => {
    const db = databaseAtVersion(15);
    const date = '2026-01-01T00:00:00.000Z';
    db.prepare(
      `INSERT INTO commenters (email, display_name, notify, verified_at, created_at)
       VALUES ('mamie@exemple.fr', 'Mamie', 1, ?, ?)`,
    ).run(date, date);

    migrate(db);

    const commenter = db
      .prepare('SELECT * FROM commenters WHERE email = ?')
      .get('mamie@exemple.fr') as {
      display_name: string;
      verified_at: string;
      locale: string | null;
    };

    // The identity survives verified, and its language arrives empty: inferring
    // one from past emails would be a guess, and the next request settles it
    // (D260812d).
    assert.equal(commenter.display_name, 'Mamie');
    assert.equal(commenter.verified_at, date);
    assert.equal(commenter.locale, null);

    db.close();
  });

  it('adds telemetry to a version 14 database without losing anything', () => {
    const db = databaseAtVersion(14);
    const date = '2026-01-01T00:00:00.000Z';
    db.prepare(
      `INSERT INTO users (username, password_hash, admin, all_albums, created_at, updated_at)
       VALUES ('famille', '$argon2id$empreinte', 0, 1, ?, ?)`,
    ).run(date, date);
    db.prepare(
      `INSERT INTO sessions (id, username, created_at, expires_at)
       VALUES ('session-en-cours', 'famille', ?, '2027-01-01T00:00:00.000Z')`,
    ).run(date);
    db.prepare(
      `INSERT INTO media (album_id, id, name, mime_type, kind, taken_at, modified_time, seen_at)
       VALUES ('corse', 'abc', 'IMG.jpg', 'image/jpeg', 'photo', ?, ?, ?)`,
    ).run(date, date, date);

    migrate(db);

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get('session-en-cours') as {
      username: string;
      expires_at: string;
      last_seen_at: string | null;
      device: string | null;
    };
    // The open session survives the update: no logout and no shortened expiry.
    // Both columns start empty — the device cannot be inferred afterwards, and
    // the first subsequent request dates the session.
    assert.equal(session.username, 'famille');
    assert.equal(session.expires_at, '2027-01-01T00:00:00.000Z');
    assert.equal(session.last_seen_at, null);
    assert.equal(session.device, null);

    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM album_visits').get() as { n: number }).n,
      0,
      'the table starts empty: nothing reconstructs past visits',
    );
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM media').get() as { n: number }).n, 1);

    // No foreign key to `sessions` or `albums`: this is the table's purpose and
    // what a later migration must not "fix" — logging out would otherwise erase
    // viewing history (D260809h).
    assert.deepEqual(db.pragma('foreign_key_list(album_visits)'), []);

    db.close();
  });

  it('is idempotent', () => {
    const db = databaseAtVersion(0);
    migrate(db);
    const version = db.pragma('user_version', { simple: true });

    // A restart must replay nothing.
    migrate(db);
    assert.equal(db.pragma('user_version', { simple: true }), version);
    db.close();
  });

  it('leaves the database intact if a migration fails', () => {
    const db = databaseAtVersion(MIGRATIONS.length);
    const before = db.pragma('user_version', { simple: true }) as number;

    // Deliberately invalid migration added for the duration of the test.
    MIGRATIONS.push('CECI N EST PAS DU SQL;');
    try {
      assert.throws(() => migrate(db), /Migration \d+ failed/);
      // The version did not move: resuming starts from the same step.
      assert.equal(db.pragma('user_version', { simple: true }), before);
    } finally {
      MIGRATIONS.pop();
      db.close();
    }
  });
});
