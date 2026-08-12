import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { openDb } from '../src/db.js';
import { MediaRepo, type MediaUpsert } from '../src/repo.js';

/**
 * Derived media versioning.
 *
 * Drive retains the identifier of a file whose content is replaced with a new
 * version ("Manage versions"). Since rendered media is served with
 * `Cache-Control: immutable`, the browser never revalidates: the URL itself
 * must change, or an edited photo would display its old version indefinitely.
 */

const dir = mkdtempSync(join(tmpdir(), 'lukarn-version-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const db = openDb(dir);
const repo = new MediaRepo(db);
after(() => db.close());

function media(id: string, md5: string | null): MediaUpsert {
  return {
    albumId: 'album',
    id,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    size: 1000,
    width: 4000,
    height: 3000,
    takenAt: '2026-01-01T10:00:00.000Z',
    takenAtFromExif: true,
    modifiedTime: '2026-01-01T10:00:00.000Z',
    durationMs: null,
    cameraMake: null,
    cameraModel: null,
    lens: null,
    isoSpeed: null,
    exposureTime: null,
    aperture: null,
    focalLength: null,
    lat: null,
    lng: null,
    md5,
    hasThumbnail: true,
    videoCodec: null,
  };
}

describe('version exposed to clients', () => {
  it('derives the version from the content hash', () => {
    repo.upsertMany([media('photo-a', '0123456789abcdef0123456789abcdef')], 'v1');

    const item = repo.listItems('album', 10, null).items.find((i) => i.id === 'photo-a');
    assert.equal(item?.version, '01234567');
  });

  it('changes version when the same file content is replaced', () => {
    repo.upsertMany([media('photo-b', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')], 'v1');
    const avant = repo.listItems('album', 10, null).items.find((i) => i.id === 'photo-b')?.version;

    // Same Drive identifier, different content: exactly the case the identifier
    // alone cannot distinguish.
    repo.upsertMany([media('photo-b', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')], 'v2');
    const apres = repo.listItems('album', 10, null).items.find((i) => i.id === 'photo-b')?.version;

    assert.notEqual(avant, apres);
    assert.equal(apres, 'bbbbbbbb');
  });

  it('tolerates a file without a hash', () => {
    repo.upsertMany([media('photo-c', null)], 'v1');

    const item = repo.listItems('album', 10, null).items.find((i) => i.id === 'photo-c');
    // No version in the URL: previous behaviour is preserved without an error.
    assert.equal(item?.version, null);

    const meta = repo.getFileMeta('photo-c');
    assert.equal(meta?.md5, null);
  });

  it('exposes the cover version for the album thumbnail', () => {
    const stats = repo.stats('album');
    assert.ok(stats.coverId);
    // A cover is a URL like any other: it must be invalidated in the same way.
    const cover = repo.getFileMeta(stats.coverId!);
    assert.equal(stats.coverVersion, cover?.md5 ? cover.md5.slice(0, 8) : null);
  });

  it('makes md5 available for the server cache key', () => {
    const meta = repo.getFileMeta('photo-a');
    assert.equal(meta?.md5, '0123456789abcdef0123456789abcdef');
  });
});
