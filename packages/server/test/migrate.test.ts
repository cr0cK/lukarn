import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { MIGRATIONS, migrate } from '../src/db.js';

/**
 * Mise à jour d'une base existante. Une instance déjà en service porte un index
 * et un refresh token qu'aucune montée de version ne doit faire perdre : les
 * migrations sont donc rejouées depuis la version trouvée, jamais depuis zéro.
 */

/** Base figée à la version `version`, comme après un déploiement plus ancien. */
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
  it('amène une base neuve à la dernière version', () => {
    const db = databaseAtVersion(0);
    migrate(db);
    assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length);
    db.close();
  });

  it('ajoute revoked_at à une base en version 1 sans perdre le jeton', () => {
    const db = databaseAtVersion(1);

    // État d'une instance en service : un refresh token déjà autorisé.
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
    // Le jeton survit et n'est pas considéré comme révoqué : l'instance continue
    // de fonctionner après la mise à jour, sans nouveau consentement.
    assert.equal(token.account, 'photos@exemple.fr');
    assert.equal(token.ciphertext, 'chiffré');
    assert.equal(token.revoked_at, null);

    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM media').get() as { n: number }).n,
      1,
      "l'index doit être conservé",
    );

    db.close();
  });

  it('ajoute les tables de configuration à une base en version 2 sans toucher à l’index', () => {
    const db = databaseAtVersion(2);
    db.prepare(
      `INSERT INTO media (album_id, id, name, mime_type, kind, taken_at, modified_time, seen_at)
       VALUES ('vacances', 'abc', 'IMG.jpg', 'image/jpeg', 'photo',
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();

    migrate(db);

    for (const table of ['users', 'albums', 'user_albums', 'settings']) {
      assert.ok(columns(db, table).length > 0, `table ${table} manquante`);
      // Les tables arrivent vides : c'est `bootstrap.ts` qui les remplit, à
      // partir d'`albums.yaml` quand l'instance en avait un.
      assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, 0);
    }

    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM media').get() as { n: number }).n, 1);
    db.close();
  });

  it('ajoute les commentaires à une base en version 3 sans toucher aux comptes', () => {
    const db = databaseAtVersion(3);
    db.prepare(
      `INSERT INTO users (username, password_hash, admin, all_albums, created_at, updated_at)
       VALUES ('famille', 'empreinte', 0, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();

    migrate(db);

    // La clé d'accès est inchangée : l'identité des commentateurs vit ailleurs,
    // et confondre les deux ferait signer « famille » tous les messages du foyer.
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
    // La session mémorise l'identité, sans que les sessions ouvertes soient
    // invalidées par la mise à jour.
    assert.ok(columns(db, 'sessions').includes('commenter_id'));
    db.close();
  });

  it('ajoute les abonnements à une base en version 4 sans rien perdre', () => {
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
    // L'index, l'identité et l'état de sync traversent la mise à jour intacts,
    // et les deux colonnes ajoutées arrivent à NULL : c'est ce qui fait que la
    // première annonce ne parlera pas des photos déjà là.
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
      'les identités vérifiées doivent survivre',
    );

    db.close();
  });

  it('garde son nom à une identité vérifiée en version 5', () => {
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
    // La colonne arrive vide : un `COALESCE(pending, display_name)` au premier
    // code validé ne doit pas renommer qui que ce soit.
    assert.equal(identite.display_name, 'Mamie');
    assert.equal(identite.pending_display_name, null);

    db.close();
  });

  it('ajoute les journées et le découpage à une base en version 6', () => {
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
    // Les albums existants arrivent sur le découpage qu'ils avaient de fait :
    // `month` est le défaut que l'URL appliquait déjà faute de préférence.
    assert.equal(album.title, 'Vacances');
    assert.equal(album.group_by, 'month');

    db.close();
  });

  it('ajoute les descriptions de photo à une base en version 8', () => {
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
    // La table arrive vide et l'index est intact : une instance en service
    // traverse la mise à jour sans rien voir changer, jusqu'à ce que quelqu'un
    // décrive une photo.
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM media_notes').get() as { n: number }).n, 0);
    assert.equal(
      (db.prepare('SELECT name FROM media WHERE id = ?').get('abc') as { name: string }).name,
      'IMG.jpg',
    );

    // Aucune clé étrangère vers `media` : c'est tout l'intérêt de la table, et
    // c'est ce qu'une migration ultérieure ne doit pas « corriger » (D83).
    const references = (db.pragma('foreign_key_list(media_notes)') as { table: string }[]).map(
      (row) => row.table,
    );
    assert.deepEqual(references, ['albums']);

    db.close();
  });

  it('est idempotente', () => {
    const db = databaseAtVersion(0);
    migrate(db);
    const version = db.pragma('user_version', { simple: true });

    // Un redémarrage ne doit rien rejouer.
    migrate(db);
    assert.equal(db.pragma('user_version', { simple: true }), version);
    db.close();
  });

  it('laisse la base intacte si une migration échoue', () => {
    const db = databaseAtVersion(MIGRATIONS.length);
    const before = db.pragma('user_version', { simple: true }) as number;

    // Migration volontairement invalide, ajoutée le temps du test.
    MIGRATIONS.push('CECI N EST PAS DU SQL;');
    try {
      assert.throws(() => migrate(db), /Échec de la migration/);
      // La version n'a pas bougé : la reprise repartira de la même étape.
      assert.equal(db.pragma('user_version', { simple: true }), before);
    } finally {
      MIGRATIONS.pop();
      db.close();
    }
  });
});
