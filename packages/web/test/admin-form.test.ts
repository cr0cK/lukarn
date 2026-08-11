import { ALL_ALBUMS } from '@nonni/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractFolderId,
  formatAlbumAccess,
  parseNumber,
  slugifyAlbumId,
  validateAlbumId,
  validateCacheSizeGB,
  validateFolderInput,
  validateIntervalMinutes,
  validatePassword,
  validateUsername,
} from '../src/lib/adminForm';

describe('extractFolderId', () => {
  it("prend le segment qui suit /folders/ dans l'URL collée", () => {
    assert.equal(
      extractFolderId('https://drive.google.com/drive/folders/1DVlkhk2mynYOiLdSOHgYPivnyn68DBwr'),
      '1DVlkhk2mynYOiLdSOHgYPivnyn68DBwr',
    );
  });

  it('ignore les paramètres de partage et le compte dans le chemin', () => {
    assert.equal(
      extractFolderId('https://drive.google.com/drive/u/0/folders/abc-123_XYZ?usp=sharing'),
      'abc-123_XYZ',
    );
  });

  it('accepte les vieux liens en ?id=', () => {
    assert.equal(extractFolderId('https://drive.google.com/open?id=abc123&usp=drive_fs'), 'abc123');
  });

  it("laisse passer un identifiant collé seul, sans l'URL", () => {
    assert.equal(
      extractFolderId('  1DVlkhk2mynYOiLdSOHgYPivnyn68DBwr  '),
      '1DVlkhk2mynYOiLdSOHgYPivnyn68DBwr',
    );
  });

  it("refuse un chemin lisible, qui n'est pas un identifiant Drive", () => {
    assert.equal(extractFolderId('Mon Drive/Photos/2026'), null);
    assert.equal(extractFolderId('https://drive.google.com/drive/my-drive'), null);
    assert.equal(extractFolderId('   '), null);
  });
});

describe('validateUsername', () => {
  it('accepte les identifiants conformes au motif partagé', () => {
    for (const value of ['alexis', 'a.b_c-1', 'Famille2026']) {
      assert.equal(validateUsername(value), null, value);
    }
  });

  it('refuse le vide, les caractères interdits et un premier caractère non alphanumérique', () => {
    assert.ok(validateUsername(''));
    assert.ok(validateUsername('jean dupont'));
    assert.ok(validateUsername('_alexis'));
    assert.ok(validateUsername('éric'));
  });

  it('refuse au-delà de la longueur maximale partagée', () => {
    assert.equal(validateUsername('a'.repeat(64)), null);
    assert.ok(validateUsername('a'.repeat(65)));
  });
});

describe('validateAlbumId', () => {
  it('suit le même motif que les identifiants de compte', () => {
    assert.equal(validateAlbumId('2026-07-allemagne'), null);
    assert.ok(validateAlbumId('-2026'));
    assert.ok(validateAlbumId('vacances été'));
  });
});

describe('validatePassword', () => {
  it('impose la longueur minimale partagée', () => {
    assert.ok(validatePassword('court'));
    assert.equal(validatePassword('assezlong'), null);
  });

  it('accepte le vide en modification, où il signifie « ne pas changer »', () => {
    assert.equal(validatePassword('', false), null);
    assert.ok(validatePassword('', true));
    // Un mot de passe trop court reste refusé, même facultatif.
    assert.ok(validatePassword('abc', false));
  });
});

describe('validateFolderInput', () => {
  it('accepte une URL comme un identifiant nu', () => {
    assert.equal(validateFolderInput('https://drive.google.com/drive/folders/abc123'), null);
    assert.equal(validateFolderInput('abc123'), null);
  });

  it('explique où trouver l’identifiant quand la valeur est illisible', () => {
    assert.ok(validateFolderInput('Mon Drive/Photos'));
    assert.ok(validateFolderInput(''));
  });
});

describe('slugifyAlbumId', () => {
  it('produit un identifiant valide à partir d’un titre accentué', () => {
    const slug = slugifyAlbumId('2026-07 - Allemagne / Forêt Noire');
    assert.equal(slug, '2026-07-allemagne-foret-noire');
    assert.equal(validateAlbumId(slug), null);
  });

  it('ne laisse ni tiret en bordure ni titre vide déguisé', () => {
    assert.equal(slugifyAlbumId('  ***  '), '');
    assert.equal(slugifyAlbumId('Été 2026 !'), 'ete-2026');
  });
});

describe('parseNumber', () => {
  it('accepte la virgule décimale française', () => {
    assert.equal(parseNumber('5,5'), 5.5);
    assert.equal(parseNumber(' 30 '), 30);
  });

  it('refuse ce qui n’est pas un nombre positif écrit en clair', () => {
    assert.equal(parseNumber('abc'), null);
    assert.equal(parseNumber('-2'), null);
    assert.equal(parseNumber(''), null);
  });
});

describe('validateIntervalMinutes et validateCacheSizeGB', () => {
  it('acceptent 0 minute (synchronisation désactivée) mais pas 0 Go de cache', () => {
    assert.equal(validateIntervalMinutes('0'), null);
    assert.ok(validateCacheSizeGB('0'));
  });

  it('refusent un intervalle non entier et une taille illisible', () => {
    assert.ok(validateIntervalMinutes('30,5'));
    assert.equal(validateCacheSizeGB('2,5'), null);
    assert.ok(validateCacheSizeGB('beaucoup'));
  });
});

describe('formatAlbumAccess', () => {
  const titles = new Map([
    ['a', 'Vacances'],
    ['b', 'Famille'],
    ['c', 'Mariage'],
    ['d', 'Chats'],
  ]);

  it('nomme le joker au lieu de le confondre avec une liste complète', () => {
    assert.equal(formatAlbumAccess([ALL_ALBUMS], titles), 'Tous les albums, présents et à venir');
    assert.notEqual(
      formatAlbumAccess(['a', 'b', 'c', 'd'], titles),
      formatAlbumAccess([ALL_ALBUMS], titles),
    );
  });

  it('dit explicitement quand aucun album n’est attribué', () => {
    assert.equal(formatAlbumAccess([], titles), 'Aucun album');
  });

  it('abrège au-delà de trois albums', () => {
    assert.equal(formatAlbumAccess(['a', 'b'], titles), 'Vacances, Famille');
    assert.equal(
      formatAlbumAccess(['a', 'b', 'c', 'd'], titles),
      'Vacances, Famille, Mariage et 1 autre',
    );
  });

  it("retombe sur l'identifiant brut d'un album disparu", () => {
    assert.equal(formatAlbumAccess(['z'], titles), 'z');
  });
});
