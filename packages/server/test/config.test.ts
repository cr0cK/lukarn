import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canSeeAlbum, parseConfig, visibleAlbums } from '../src/config.js';

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
  it('applique les valeurs par défaut', () => {
    const config = parseConfig(VALID);
    assert.equal(config.sync.intervalMinutes, 30);
    assert.equal(config.sync.onStartup, true);
    assert.equal(config.cache.maxSizeGB, 20);
    // `recursive` est vrai par défaut : un dossier de photos contient presque
    // toujours des sous-dossiers.
    assert.equal(config.albums[0]!.recursive, true);
    assert.equal(config.users[1]!.admin, false);
  });

  it('rejette un YAML mal formé', () => {
    assert.throws(() => parseConfig('users: [unclosed'), /YAML invalide/);
  });

  it('rejette une config sans utilisateur ni album', () => {
    assert.throws(() => parseConfig('users: []\nalbums: []'), /Configuration invalide/);
  });

  it("rejette un hash qui n'est pas de l'argon2", () => {
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

  it('signale une référence à un album inexistant', () => {
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
      /album inconnu : "fantome"/,
    );
  });

  it('signale les identifiants en double', () => {
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
      /utilisateur en double/,
    );
  });
});

describe('scoping des albums', () => {
  const config = parseConfig(VALID);

  it('donne tous les albums au joker', () => {
    assert.deepEqual(
      visibleAlbums(config, 'alexis').map((album) => album.id),
      ['vacances', 'prive'],
    );
  });

  it('limite un utilisateur à ses albums', () => {
    assert.deepEqual(
      visibleAlbums(config, 'famille').map((album) => album.id),
      ['vacances'],
    );
    assert.equal(canSeeAlbum(config, 'famille', 'vacances'), true);
    assert.equal(canSeeAlbum(config, 'famille', 'prive'), false);
  });

  it('ne donne rien à un utilisateur inconnu', () => {
    assert.deepEqual(visibleAlbums(config, 'intrus'), []);
    assert.equal(canSeeAlbum(config, 'intrus', 'vacances'), false);
  });

  it('ignore la casse du login', () => {
    assert.equal(canSeeAlbum(config, 'FaMiLlE', 'vacances'), true);
  });
});
