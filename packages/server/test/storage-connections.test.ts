import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { openDb, type Db } from '../src/db.js';
import { loadEnv } from '../src/env.js';
import { DEFAULT_CONNECTION_ID, StorageConnectionRepo } from '../src/storage/connections.js';
import { StorageKeyMismatchError } from '../src/storage/provider.js';
import { StorageRegistry } from '../src/storage/registry.js';

/**
 * Storage connections: what is stored, what is encrypted, and when a live
 * provider stops being the right one.
 *
 * The repository is the sole writer of `storage_connections` and the registry
 * caches one provider per row. Both properties are invisible until they break:
 * a stale provider keeps reading an endpoint nobody configured, and a secret
 * that fails to decrypt must not be mistaken for a connection that never had one.
 */

const root = mkdtempSync(join(tmpdir(), 'lukarn-connections-'));
after(() => rmSync(root, { recursive: true, force: true }));

const TOKEN_KEY = 'k'.repeat(48);

const env = loadEnv({
  NODE_ENV: 'test',
  SESSION_SECRET: 's'.repeat(48),
  TOKEN_KEY,
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  CONFIG_PATH: join(root, 'albums.yaml'),
  DATA_DIR: join(root, 'data'),
  CACHE_DIR: join(root, 'cache'),
  WEB_DIR: join(root, 'web'),
} as NodeJS.ProcessEnv);

const silencieux = { info: () => {}, warn: () => {} };

let db: Db;
let connections: StorageConnectionRepo;

beforeEach(() => {
  db?.close();
  rmSync(join(root, 'data'), { recursive: true, force: true });
  db = openDb(join(root, 'data'));
  connections = new StorageConnectionRepo(db, TOKEN_KEY);
});

after(() => db?.close());

describe('storage connections', () => {
  it('starts with the Drive connection every album defaults to', () => {
    const drive = connections.get(DEFAULT_CONNECTION_ID);

    // Migration 17 creates it whether or not anything was ever connected: an
    // album has always pointed at a storage, and there must be no state where
    // one points at none.
    assert.equal(drive?.kind, 'drive');
    assert.equal(drive?.ciphertext, null);
    assert.equal(connections.secret(DEFAULT_CONNECTION_ID), null);
  });

  it('encrypts a secret on the way in and returns it on the way out', () => {
    connections.create({ id: 'archives', kind: 's3', label: 'Archives', secret: 'clé-secrète' });

    const stored = connections.get('archives');
    // What lands in the database is not the secret: a dump must not be enough.
    assert.notEqual(stored?.ciphertext, 'clé-secrète');
    assert.ok(stored?.ciphertext);
    assert.equal(connections.secret('archives'), 'clé-secrète');
    // A secret dates the connection: this is what /admin shows as "granted".
    assert.ok(stored.grantedAt);
  });

  it('reports a wrong TOKEN_KEY as such, not as an absent secret', () => {
    connections.create({ id: 'archives', kind: 's3', label: 'Archives', secret: 'clé-secrète' });

    const avecMauvaiseCle = new StorageConnectionRepo(db, 'z'.repeat(48));

    // The two states are opposite: "never connected" invites a first
    // authorisation, while a mistyped key must be restored — deleting the row
    // would destroy something only new consent could replace (D14).
    assert.throws(() => avecMauvaiseCle.secret('archives'), StorageKeyMismatchError);
    assert.ok(connections.get('archives')?.ciphertext, 'the row is kept');
  });

  it('clears a secret without forgetting the connection', () => {
    connections.update(DEFAULT_CONNECTION_ID, { secret: 'jeton', account: 'photos@exemple.fr' });
    connections.clearSecret(DEFAULT_CONNECTION_ID);

    // Disconnecting is not deleting: the albums naming this connection by id
    // would otherwise point at nothing.
    const drive = connections.get(DEFAULT_CONNECTION_ID);
    assert.ok(drive);
    assert.equal(drive.ciphertext, null);
    assert.equal(drive.account, null);
  });

  it('clears a revocation when a new secret arrives', () => {
    connections.update(DEFAULT_CONNECTION_ID, { secret: 'jeton' });
    const used = connections.get(DEFAULT_CONNECTION_ID)!.ciphertext;

    assert.equal(connections.markRevoked(DEFAULT_CONNECTION_ID, used), true);
    assert.ok(connections.get(DEFAULT_CONNECTION_ID)?.revokedAt);

    // Reconnecting is exactly what the refusal asked for; leaving `revoked_at`
    // set would keep /admin asking for it again.
    connections.update(DEFAULT_CONNECTION_ID, { secret: 'jeton-neuf' });
    assert.equal(connections.get(DEFAULT_CONNECTION_ID)?.revokedAt, null);
  });

  it('refuses to revoke a secret that is no longer the stored one', () => {
    connections.update(DEFAULT_CONNECTION_ID, { secret: 'jeton' });
    const ancien = connections.get(DEFAULT_CONNECTION_ID)!.ciphertext;

    // A request still in flight when consent lands again: marking the brand-new
    // secret revoked would ask for the reconnection that just happened.
    connections.update(DEFAULT_CONNECTION_ID, { secret: 'jeton-neuf' });

    assert.equal(connections.markRevoked(DEFAULT_CONNECTION_ID, ancien), false);
    assert.equal(connections.get(DEFAULT_CONNECTION_ID)?.revokedAt, null);
  });
});

describe('the registry of live providers', () => {
  it('reuses one provider per connection', () => {
    const registry = new StorageRegistry(connections, env, silencieux);

    // Not stateless: a Drive service holds an authorised client whose access
    // token it renews. Rebuilding one per request would exchange the refresh
    // token for every thumbnail in a grid.
    assert.equal(registry.get(DEFAULT_CONNECTION_ID), registry.get(DEFAULT_CONNECTION_ID));
  });

  it('drops the cached provider when its connection is written to', () => {
    const registry = new StorageRegistry(connections, env, silencieux);
    const premier = registry.get(DEFAULT_CONNECTION_ID);

    connections.update(DEFAULT_CONNECTION_ID, { secret: 'jeton' });

    // Without this, a reconnection or a corrected endpoint would take effect
    // only at the next restart.
    assert.notEqual(registry.get(DEFAULT_CONNECTION_ID), premier);
  });

  it('refuses a connection it cannot build from, and still lists it', () => {
    // A bucket without an endpoint: the kind is supported, the row is not usable.
    // The refusal has to name what is missing — this is the text /admin shows.
    connections.create({ id: 'archives', kind: 's3', label: 'Archives' });
    const registry = new StorageRegistry(connections, env, silencieux);

    assert.throws(() => registry.get('archives'), /endpoint and a bucket/);
    // /admin still has to list it: hiding the connection would leave its albums
    // unexplained.
    assert.deepEqual(
      registry.all().map((entry) => [entry.connection.id, entry.provider === null]),
      [
        ['drive', false],
        ['archives', true],
      ],
    );
    assert.equal(registry.isConnected('archives'), false);
  });

  it('answers "not connected" for a WebDAV row with no password stored', () => {
    // `secret` is optional when a connection is created, so this row is reachable from
    // /admin. `isConnected` decides whether prewarming, transcoding and the startup
    // sync traverse an album at all, and it reads its answer from whether the factory
    // throws — a service that builds unconditionally would report "yes" and let each
    // pass fail file by file, which is the waste D61 exists to prevent.
    connections.create({ id: 'nextcloud', kind: 'webdav', label: 'Nextcloud' });
    const registry = new StorageRegistry(connections, env, silencieux);

    assert.throws(() => registry.get('nextcloud'), /no password stored/);
    assert.equal(registry.isConnected('nextcloud'), false);
  });

  it('answers "not connected" for a WebDAV row the server already refused', () => {
    connections.create({
      id: 'nextcloud-revoked',
      kind: 'webdav',
      label: 'Nextcloud',
      secret: JSON.stringify({ username: 'alexis', password: 'app-password' }),
    });
    const used = connections.get('nextcloud-revoked')!.ciphertext;
    assert.equal(connections.markRevoked('nextcloud-revoked', used), true);
    const registry = new StorageRegistry(connections, env, silencieux);

    // Re-presenting a password the server has already rejected is the specific waste
    // here: every pass would offer it again, on every file.
    assert.throws(() => registry.get('nextcloud-revoked'), /refused the stored app password/);
    assert.equal(registry.isConnected('nextcloud-revoked'), false);
  });

  it('says nothing is connected until something is', () => {
    const registry = new StorageRegistry(connections, env, silencieux);
    assert.equal(registry.anyConnected(), false);

    connections.update(DEFAULT_CONNECTION_ID, { secret: 'jeton' });
    // What prewarming and the startup sync ask before traversing an album: with
    // nothing connected each would fail file by file, keeping its pacing (D61).
    assert.equal(registry.anyConnected(), true);
  });
});
