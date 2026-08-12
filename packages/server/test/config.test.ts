import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseConfig } from '../src/config.js';

/**
 * `config/albums.yaml` now only bootstraps a fresh installation, but it must
 * still be read and validated exactly as before: live instances pass through
 * this parser on the first start after the update.
 */

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA';

function yaml(body: string): string {
  return body;
}

const VALID = yaml(`
users:
  - username: alexis
    passwordHash: "${HASH}"
    admin: true
    albums: ["*"]
  - username: famille
    passwordHash: "${HASH}"
    albums: ["vacances"]
albums:
  - id: vacances
    title: Vacances
    folderId: folder-1
  - id: prive
    title: Privé
    folderId: folder-2
`);

describe('parseConfig', () => {
  it('applies default values', () => {
    const config = parseConfig(VALID);
    assert.equal(config.sync.intervalMinutes, 30);
    assert.equal(config.sync.onStartup, true);
    assert.equal(config.cache.maxSizeGB, 20);
    // `recursive` defaults to true: a photo folder almost always contains subfolders.
    assert.equal(config.albums[0]!.recursive, true);
    // Grouping and sort order fall back to shared constants: bootstrap YAML has
    // no separate default, otherwise an album created from /admin and the same
    // album bootstrapped from a file would open differently.
    assert.equal(config.albums[0]!.groupBy, 'month');
    assert.equal(config.albums[0]!.sortOrder, 'asc');
    assert.equal(config.users[1]!.admin, false);
  });

  it('reads the sort order declared on an album', () => {
    const config = parseConfig(
      yaml(`
users:
  - username: alexis
    passwordHash: "${HASH}"
    albums: ["*"]
albums:
  - id: quotidien
    title: Quotidien
    folderId: folder-1
    sortOrder: desc
`),
    );
    assert.equal(config.albums[0]!.sortOrder, 'desc');
  });

  it('rejects an unknown sort order', () => {
    assert.throws(
      () =>
        parseConfig(
          yaml(`
users:
  - username: alexis
    passwordHash: "${HASH}"
    albums: ["*"]
albums:
  - id: quotidien
    title: Quotidien
    folderId: folder-1
    sortOrder: aleatoire
`),
        ),
      /Invalid configuration/,
    );
  });

  it('rejects malformed YAML', () => {
    assert.throws(() => parseConfig('users: [unclosed'), /Invalid YAML/);
  });

  it('rejects a configuration without users or albums', () => {
    assert.throws(() => parseConfig('users: []\nalbums: []'), /Invalid configuration/);
  });

  it('rejects a hash that is not argon2', () => {
    assert.throws(
      () =>
        parseConfig(`
users:
  - username: alexis
    passwordHash: "motdepasseenclair"
    albums: ["a"]
albums:
  - id: a
    title: A
    folderId: f
`),
      /argon2/,
    );
  });

  it('reports a reference to a missing album', () => {
    assert.throws(
      () =>
        parseConfig(`
users:
  - username: alexis
    passwordHash: "${HASH}"
    albums: ["fantome"]
albums:
  - id: reel
    title: Réel
    folderId: f
`),
      /unknown album: "fantome"/,
    );
  });

  it('reports duplicate identifiers', () => {
    assert.throws(
      () =>
        parseConfig(`
users:
  - username: alexis
    passwordHash: "${HASH}"
    albums: []
  - username: ALEXIS
    passwordHash: "${HASH}"
    albums: []
albums:
  - id: a
    title: A
    folderId: f
`),
      /duplicate user/,
    );
  });
});

describe('file reading', () => {
  it('returns access as-is, including the wildcard', () => {
    const config = parseConfig(VALID);
    assert.deepEqual(config.users[0]!.albums, ['*']);
    assert.deepEqual(config.users[1]!.albums, ['vacances']);
    assert.deepEqual(
      config.albums.map((album) => album.id),
      ['vacances', 'prive'],
    );
  });
});
