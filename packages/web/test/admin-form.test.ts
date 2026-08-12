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
  it('takes the segment after /folders/ from the pasted URL', () => {
    assert.equal(
      extractFolderId('https://drive.google.com/drive/folders/1DVlkhk2mynYOiLdSOHgYPivnyn68DBwr'),
      '1DVlkhk2mynYOiLdSOHgYPivnyn68DBwr',
    );
  });

  it('ignores sharing parameters and the account in the path', () => {
    assert.equal(
      extractFolderId('https://drive.google.com/drive/u/0/folders/abc-123_XYZ?usp=sharing'),
      'abc-123_XYZ',
    );
  });

  it('accepts old ?id= links', () => {
    assert.equal(extractFolderId('https://drive.google.com/open?id=abc123&usp=drive_fs'), 'abc123');
  });

  it('accepts an identifier pasted on its own without the URL', () => {
    assert.equal(
      extractFolderId('  1DVlkhk2mynYOiLdSOHgYPivnyn68DBwr  '),
      '1DVlkhk2mynYOiLdSOHgYPivnyn68DBwr',
    );
  });

  it('rejects a readable path that is not a Drive identifier', () => {
    assert.equal(extractFolderId('Mon Drive/Photos/2026'), null);
    assert.equal(extractFolderId('https://drive.google.com/drive/my-drive'), null);
    assert.equal(extractFolderId('   '), null);
  });
});

describe('validateUsername', () => {
  it('accepts usernames matching the shared pattern', () => {
    for (const value of ['alexis', 'a.b_c-1', 'Famille2026']) {
      assert.equal(validateUsername(value), null, value);
    }
  });

  it('rejects emptiness, forbidden characters and a non-alphanumeric first character', () => {
    assert.ok(validateUsername(''));
    assert.ok(validateUsername('jean dupont'));
    assert.ok(validateUsername('_alexis'));
    assert.ok(validateUsername('éric'));
  });

  it('rejects values beyond the shared maximum length', () => {
    assert.equal(validateUsername('a'.repeat(64)), null);
    assert.ok(validateUsername('a'.repeat(65)));
  });
});

describe('validateAlbumId', () => {
  it('uses the same pattern as account usernames', () => {
    assert.equal(validateAlbumId('2026-07-allemagne'), null);
    assert.ok(validateAlbumId('-2026'));
    assert.ok(validateAlbumId('vacances été'));
  });
});

describe('validatePassword', () => {
  it('enforces the shared minimum length', () => {
    assert.ok(validatePassword('court'));
    assert.equal(validatePassword('assezlong'), null);
  });

  it('accepts an empty value when editing, where it means "do not change"', () => {
    assert.equal(validatePassword('', false), null);
    assert.ok(validatePassword('', true));
    // A password that is too short remains invalid even when optional.
    assert.ok(validatePassword('abc', false));
  });
});

describe('validateFolderInput', () => {
  it('accepts both a URL and a bare identifier', () => {
    assert.equal(validateFolderInput('https://drive.google.com/drive/folders/abc123'), null);
    assert.equal(validateFolderInput('abc123'), null);
  });

  it('explains where to find the identifier when the value is unreadable', () => {
    assert.ok(validateFolderInput('Mon Drive/Photos'));
    assert.ok(validateFolderInput(''));
  });
});

describe('slugifyAlbumId', () => {
  it('produces a valid identifier from a title with accents', () => {
    const slug = slugifyAlbumId('2026-07 - Allemagne / Forêt Noire');
    assert.equal(slug, '2026-07-allemagne-foret-noire');
    assert.equal(validateAlbumId(slug), null);
  });

  it('leaves neither an edge hyphen nor a disguised empty title', () => {
    assert.equal(slugifyAlbumId('  ***  '), '');
    assert.equal(slugifyAlbumId('Été 2026 !'), 'ete-2026');
  });
});

describe('parseNumber', () => {
  it('accepts the French decimal comma', () => {
    assert.equal(parseNumber('5,5'), 5.5);
    assert.equal(parseNumber(' 30 '), 30);
  });

  it('rejects values that are not clearly written positive numbers', () => {
    assert.equal(parseNumber('abc'), null);
    assert.equal(parseNumber('-2'), null);
    assert.equal(parseNumber(''), null);
  });
});

describe('validateIntervalMinutes and validateCacheSizeGB', () => {
  it('accept 0 minutes for disabled synchronisation but not a 0 GB cache', () => {
    assert.equal(validateIntervalMinutes('0'), null);
    assert.ok(validateCacheSizeGB('0'));
  });

  it('reject a non-integer interval and an unreadable size', () => {
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

  it('names the wildcard instead of confusing it with a complete list', () => {
    assert.equal(formatAlbumAccess([ALL_ALBUMS], titles), 'Every album, present and future');
    assert.notEqual(
      formatAlbumAccess(['a', 'b', 'c', 'd'], titles),
      formatAlbumAccess([ALL_ALBUMS], titles),
    );
  });

  it('states explicitly when no album is assigned', () => {
    assert.equal(formatAlbumAccess([], titles), 'No album');
  });

  it('abbreviates beyond three albums', () => {
    assert.equal(formatAlbumAccess(['a', 'b'], titles), 'Vacances, Famille');
    assert.equal(
      formatAlbumAccess(['a', 'b', 'c', 'd'], titles),
      'Vacances, Famille, Mariage and 1 other',
    );
  });

  it('falls back to the raw identifier of a missing album', () => {
    assert.equal(formatAlbumAccess(['z'], titles), 'z');
  });
});
