import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { AdminStatus, AdminUser } from '@gdv/shared';
import argon2 from 'argon2';
import Database from 'better-sqlite3';
import { buildApp } from '../src/app.js';
import { ConfigRepo } from '../src/config-repo.js';
import type { AppContext } from '../src/context.js';
import { MIGRATIONS, openDb } from '../src/db.js';
import { loadEnv } from '../src/env.js';

/**
 * Amorçage depuis `config/albums.yaml`.
 *
 * Le cas qui compte est celui d'une instance **déjà en service** : elle tourne
 * sur un YAML réel, avec un index de médias, un jeton OAuth et des sessions
 * ouvertes. La mise à jour doit reprendre sa configuration telle quelle, sans
 * perte d'accès ni réindexation — puis ne plus jamais relire le fichier, sans
 * quoi toute modification faite depuis l'application serait écrasée au
 * redémarrage suivant.
 */

const PASSWORD = 'mot-de-passe-de-test';
const INDEXED = 471;

const root = mkdtempSync(join(tmpdir(), 'gdv-bootstrap-'));
let hash: string;

function env(dir: string, configPath: string): ReturnType<typeof loadEnv> {
  return loadEnv({
    NODE_ENV: 'test',
    SESSION_SECRET: 's'.repeat(48),
    TOKEN_KEY: 't'.repeat(48),
    CONFIG_PATH: configPath,
    DATA_DIR: join(dir, 'data'),
    CACHE_DIR: join(dir, 'cache'),
    WEB_DIR: join(dir, 'web-absent'),
    LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);
}

/** Le YAML de l'instance en service : un admin, un compte restreint, un album. */
function yamlInUse(): string {
  return `
users:
  - username: Alexis
    passwordHash: "${hash}"
    admin: true
    albums: ["*"]
  - username: famille
    passwordHash: "${hash}"
    albums: ["2026-07-Allemagne"]

albums:
  - id: 2026-07-Allemagne
    title: '2026-07 - Allemagne / Forêt Noire'
    description: 'Photos de vacances en Allemagne, juillet 2026'
    folderId: '1DVlkhk2mynYOiLdSOHgYPivnyn68DBwr'
    sortOrder: desc

sync:
  intervalMinutes: 0
  onStartup: false
cache:
  maxSizeGB: 5
`;
}

/**
 * Base d'une instance en service **avant** la migration : schéma en version 2,
 * un index de 471 médias et un refresh token autorisé.
 */
function databaseInUse(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, 'gdv.db'));
  for (let index = 0; index < 2; index++) db.exec(MIGRATIONS[index]!);
  db.pragma('user_version = 2');

  db.prepare(
    `INSERT INTO oauth_token (id, ciphertext, account, scope, granted_at)
     VALUES (1, 'chiffré', 'photos@exemple.fr', 'drive.readonly', '2026-06-01T00:00:00.000Z')`,
  ).run();

  const insert = db.prepare(
    `INSERT INTO media (album_id, id, name, mime_type, kind, taken_at, modified_time, seen_at)
     VALUES (?, ?, ?, 'image/jpeg', 'photo', ?, ?, '2026-07-01T00:00:00.000Z')`,
  );
  for (let index = 0; index < INDEXED; index++) {
    const takenAt = new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString();
    insert.run('2026-07-Allemagne', `drive-${index}`, `IMG_${index}.jpg`, takenAt, takenAt);
  }

  db.prepare(
    `INSERT INTO sync_state (album_id, last_sync_at, status, error)
     VALUES ('2026-07-Allemagne', '2026-07-20T08:00:00.000Z', 'ok', NULL)`,
  ).run();

  db.close();
}

before(async () => {
  hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('mise à jour d’une instance en service', () => {
  const dir = join(root, 'en-service');
  const configPath = join(dir, 'albums.yaml');

  it("reprend le YAML sans perdre l'accès ni l'index", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, yamlInUse(), 'utf8');
    databaseInUse(join(dir, 'data'));

    const { server, context } = await buildApp(env(dir, configPath));

    try {
      // L'index n'a pas bougé : aucune réindexation n'est nécessaire.
      assert.equal(context.media.stats('2026-07-Allemagne').itemCount, INDEXED);
      assert.equal(
        context.syncState.get('2026-07-Allemagne').lastSyncAt,
        '2026-07-20T08:00:00.000Z',
      );

      // Le jeton OAuth est intact : pas de nouveau consentement à demander.
      const token = context.db.prepare('SELECT account, revoked_at FROM oauth_token').get() as {
        account: string;
        revoked_at: string | null;
      };
      assert.equal(token.account, 'photos@exemple.fr');
      assert.equal(token.revoked_at, null);

      // Les deux comptes se connectent avec leur mot de passe d'avant, et la
      // casse du login reste indifférente.
      for (const username of ['alexis', 'ALEXIS', 'famille']) {
        const response = await server.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username, password: PASSWORD },
        });
        assert.equal(response.statusCode, 200, username);
      }

      // La casse saisie dans le fichier est conservée telle quelle.
      assert.equal(context.config.user('alexis')!.username, 'Alexis');

      // Les droits sont repris : joker pour l'administrateur, album unique
      // pour l'autre.
      assert.deepEqual(
        context.albumsFor('Alexis').map((album) => album.id),
        ['2026-07-Allemagne'],
      );
      assert.equal(context.canSee('famille', '2026-07-Allemagne'), true);
      assert.equal(context.canSee('famille', 'inexistant'), false);

      // Les réglages du fichier s'appliquent, y compris la limite de cache.
      assert.deepEqual(context.settings, {
        syncIntervalMinutes: 0,
        syncOnStartup: false,
        cacheMaxSizeGB: 5,
        // Le YAML d'amorçage n'en connaît aucun : ils restent au défaut.
        prewarmCache: true,
        transcodeVideos: true,
        videoCacheMaxSizeGB: 5,
        moderationEmail: null,
      });
      assert.equal(context.cache.stats().maxBytes, 5 * 1024 ** 3);

      // L'album garde son titre, sa description et son dossier Drive.
      const album = context.findAlbum('2026-07-Allemagne')!;
      assert.equal(album.title, '2026-07 - Allemagne / Forêt Noire');
      assert.equal(album.folderId, '1DVlkhk2mynYOiLdSOHgYPivnyn68DBwr');
      assert.equal(album.recursive, true);
      // Les préférences d'affichage déclarées dans le fichier atteignent la
      // colonne : sans ce passage, l'amorçage les perdrait en silence, et le
      // seul moyen de les retrouver serait de rouvrir /admin.
      assert.equal(album.groupBy, 'month');
      assert.equal(album.sortOrder, 'desc');
    } finally {
      await server.close();
      context.close();
    }
  });

  it('ne relit plus le fichier une fois la base peuplée', async () => {
    // Le YAML est modifié après coup, comme le ferait quelqu'un qui aurait
    // gardé l'habitude d'éditer le fichier : il ne doit plus rien changer.
    writeFileSync(
      configPath,
      `
users:
  - username: intrus
    passwordHash: "${hash}"
    admin: true
    albums: ["*"]
albums:
  - id: ajoute-tardivement
    title: Ajouté tardivement
    folderId: folder-tardif
`,
      'utf8',
    );

    const { server, context } = await buildApp(env(dir, configPath));
    try {
      assert.equal(context.config.user('intrus'), undefined);
      assert.equal(context.findAlbum('ajoute-tardivement'), undefined);
      const response = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'intrus', password: PASSWORD },
      });
      assert.equal(response.statusCode, 401);
    } finally {
      await server.close();
      context.close();
    }
  });

  it('conserve les modifications faites dans l’application', async () => {
    const first = await buildApp(env(dir, configPath));
    const cookie = await login(first.server, 'Alexis');
    const created = await first.server.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { cookie },
      payload: { username: 'invite', password: 'un-mot-de-passe', albums: [] },
    });
    assert.equal(created.statusCode, 201);
    await first.server.close();
    first.context.close();

    // Redémarrage : le compte créé dans l'application survit, le fichier ne le
    // remplace pas.
    const second = await buildApp(env(dir, configPath));
    try {
      assert.ok(second.context.config.user('invite'));
    } finally {
      await second.server.close();
      second.context.close();
    }
  });
});

describe('installation neuve sans fichier', () => {
  const dir = join(root, 'neuve');
  const configPath = join(dir, 'albums-absent.yaml');

  it('démarre sans compte et refuse toute administration', async () => {
    mkdirSync(dir, { recursive: true });
    const { server, context } = await buildApp(env(dir, configPath));

    try {
      const health = await server.inject({ method: 'GET', url: '/api/health' });
      assert.equal(health.statusCode, 200);
      assert.equal(context.config.userCount(), 0);

      const users = await server.inject({ method: 'GET', url: '/api/admin/users' });
      assert.equal(users.statusCode, 401);
    } finally {
      await server.close();
      context.close();
    }
  });

  it('laisse créer le premier administrateur en base, comme le fait la commande', async () => {
    // Ce que fait `pnpm create-admin` : ouvrir la base et y écrire un compte.
    const db = openDb(join(dir, 'data'));
    new ConfigRepo(db).createUser({
      username: 'proprietaire',
      passwordHash: hash,
      admin: true,
      albums: ['*'],
    });
    db.close();

    const { server, context } = await buildApp(env(dir, configPath));
    try {
      const cookie = await login(server, 'proprietaire');
      const response = await server.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { cookie },
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(
        (response.json() as AdminUser[]).map((user) => user.username),
        ['proprietaire'],
      );

      // Les réglages retombent sur leurs défauts, faute de fichier.
      const status = await server.inject({
        method: 'GET',
        url: '/api/admin/status',
        headers: { cookie },
      });
      assert.equal((status.json() as AdminStatus).cache.maxBytes, 20 * 1024 ** 3);
    } finally {
      await server.close();
      context.close();
    }
  });
});

describe('fichier invalide', () => {
  it('refuse de démarrer sur une base vide plutôt que sans aucun compte', async () => {
    const dir = join(root, 'invalide');
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, 'albums.yaml');
    writeFileSync(configPath, 'users: [unclosed', 'utf8');

    let context: AppContext | null = null;
    await assert.rejects(async () => {
      const built = await buildApp(env(dir, configPath));
      context = built.context;
    }, /YAML invalide/);
    (context as AppContext | null)?.close();
  });
});

async function login(
  server: Awaited<ReturnType<typeof buildApp>>['server'],
  username: string,
): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: PASSWORD },
  });
  assert.equal(response.statusCode, 200, `connexion de ${username} refusée`);
  const cookie = response.cookies.find((entry) => entry.name === 'gdv_session');
  assert.ok(cookie, 'cookie de session absent');
  return `gdv_session=${cookie.value}`;
}
