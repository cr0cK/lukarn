import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { ConfigRepo } from '../src/config-repo.js';
import { openDb, type Db } from '../src/db.js';

/**
 * Writes from another process.
 *
 * `ConfigRepo` keeps an in-memory snapshot so `canSee()` remains a `Map` read —
 * it is called for every thumbnail in a grid. Writes from the repository itself
 * invalidate this snapshot, but command-line tools (`reset-password`,
 * `create-admin`) write from **another** process while the server is running.
 *
 * Without detection, the server would keep authenticating against the old hash
 * until restart — defeating a command intended precisely to regain control
 * after losing a password.
 */

const root = mkdtempSync(join(tmpdir(), 'lukarn-externe-'));
after(() => rmSync(root, { recursive: true, force: true }));

let serveur: Db;
let commande: Db;
let config: ConfigRepo;

beforeEach(() => {
  serveur?.close();
  commande?.close();
  rmSync(join(root, 'data'), { recursive: true, force: true });

  // Two separate connections to the same file: the running server and the
  // command launched alongside it.
  serveur = openDb(join(root, 'data'));
  commande = openDb(join(root, 'data'));
  config = new ConfigRepo(serveur);

  new ConfigRepo(commande).createUser({
    username: 'alexis',
    passwordHash: 'empreinte-initiale',
    admin: true,
    albums: ['*'],
  });
});

after(() => {
  serveur?.close();
  commande?.close();
});

describe('writes from another process', () => {
  it('sees an account created alongside it', () => {
    assert.equal(config.user('alexis')?.passwordHash, 'empreinte-initiale');
  });

  it('sees a password changed alongside it without restarting', () => {
    // The snapshot is loaded before the change: this is the case that catches mistakes.
    assert.ok(config.user('alexis'));

    new ConfigRepo(commande).updateUser('alexis', { passwordHash: 'empreinte-remplacée' });

    assert.equal(config.user('alexis')?.passwordHash, 'empreinte-remplacée');
  });

  it('sees an album created alongside it', () => {
    assert.deepEqual(config.albums(), []);

    new ConfigRepo(commande).createAlbum({
      id: 'vacances',
      title: 'Vacances',
      folderId: 'dossier-1',
      recursive: true,
    });

    assert.deepEqual(
      config.albums().map((album) => album.id),
      ['vacances'],
    );
  });

  it('sees access removed alongside it', () => {
    const externe = new ConfigRepo(commande);
    externe.createAlbum({ id: 'prive', title: 'Privé', folderId: 'd', recursive: true });
    assert.equal(config.canSee('alexis', 'prive'), true);

    externe.updateUser('alexis', { albums: [] });

    assert.equal(config.canSee('alexis', 'prive'), false);
  });

  it('does not rebuild its snapshot without cause', () => {
    // Detection must not degrade the hot path: without external writes,
    // successive reads reuse the same snapshot.
    const premier = config.albums();
    const second = config.albums();
    assert.equal(premier, second, 'the snapshot must be reused as-is');
  });
});
