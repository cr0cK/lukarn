import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseConfig } from '../src/config.js';

/**
 * `config/albums.yaml` ne sert plus qu'à amorcer une installation neuve, mais
 * il doit toujours être lu et validé exactement comme avant : les instances en
 * service repassent par ce parseur au premier démarrage après la mise à jour.
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
  it('applique les valeurs par défaut', () => {
    const config = parseConfig(VALID);
    assert.equal(config.sync.intervalMinutes, 30);
    assert.equal(config.sync.onStartup, true);
    assert.equal(config.cache.maxSizeGB, 20);
    // `recursive` est vrai par défaut : un dossier de photos contient presque
    // toujours des sous-dossiers.
    assert.equal(config.albums[0]!.recursive, true);
    // Découpage et sens de lecture retombent sur les constantes partagées : le
    // YAML d'amorçage n'a pas son propre défaut, sinon un album créé depuis
    // /admin et le même album amorcé par fichier s'ouvriraient différemment.
    assert.equal(config.albums[0]!.groupBy, 'month');
    assert.equal(config.albums[0]!.sortOrder, 'asc');
    assert.equal(config.users[1]!.admin, false);
  });

  it('lit le sens de lecture déclaré sur un album', () => {
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

  it('rejette un sens de lecture inconnu', () => {
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

  it('rejette un YAML mal formé', () => {
    assert.throws(() => parseConfig('users: [unclosed'), /Invalid YAML/);
  });

  it('rejette une config sans utilisateur ni album', () => {
    assert.throws(() => parseConfig('users: []\nalbums: []'), /Invalid configuration/);
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

describe('lecture du fichier', () => {
  it('rend les droits tels quels, joker compris', () => {
    const config = parseConfig(VALID);
    assert.deepEqual(config.users[0]!.albums, ['*']);
    assert.deepEqual(config.users[1]!.albums, ['vacances']);
    assert.deepEqual(
      config.albums.map((album) => album.id),
      ['vacances', 'prive'],
    );
  });
});
