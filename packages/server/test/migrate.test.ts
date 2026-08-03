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
       VALUES ('mamie', 'empreinte', 0, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();

    migrate(db);

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get('mamie') as {
      password_hash: string;
      display_name: string | null;
      email: string | null;
      notify: number;
    };
    // Le compte existant garde son empreinte et hérite des défauts : pas de nom
    // affiché, pas d'adresse, mais abonné — sans quoi renseigner une adresse
    // plus tard n'enverrait toujours rien.
    assert.equal(user.password_hash, 'empreinte');
    assert.equal(user.display_name, null);
    assert.equal(user.email, null);
    assert.equal(user.notify, 1);

    assert.ok(columns(db, 'comments').includes('hidden_at'));
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
