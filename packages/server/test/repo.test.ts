import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { DEFAULT_SORT_ORDER } from '@lukarn/shared';
import { openDb } from '../src/db.js';
import { MediaRepo, type MediaUpsert } from '../src/repo.js';

const dir = mkdtempSync(join(tmpdir(), 'lukarn-repo-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const db = openDb(dir);
const repo = new MediaRepo(db);

function media(albumId: string, id: string, takenAt: string): MediaUpsert {
  return {
    albumId,
    id,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    size: 1000,
    width: 4000,
    height: 3000,
    takenAt,
    takenAtFromExif: true,
    modifiedTime: takenAt,
    durationMs: null,
    cameraMake: 'Canon',
    cameraModel: 'EOS R6',
    lens: null,
    isoSpeed: 400,
    exposureTime: 0.004,
    aperture: 2.8,
    focalLength: 50,
    lat: null,
    lng: null,
    md5: null,
    hasThumbnail: true,
    videoCodec: null,
    sourcePath: null,
  };
}

const seenAt = '2025-01-01T00:00:00.000Z';

// 12 photos in "vacances", plus one photo present in two albums.
const items = Array.from({ length: 12 }, (_, index) =>
  media(
    'vacances',
    `v${String(index).padStart(2, '0')}`,
    `2024-0${(index % 9) + 1}-01T10:00:00.000Z`,
  ),
);
repo.upsertMany(items, seenAt);
repo.upsertMany([media('prive', 'p01', '2024-05-05T10:00:00.000Z')], seenAt);
// Nested folders: the same Drive file indexed under two albums.
repo.upsertMany([media('vacances', 'shared', '2024-06-06T10:00:00.000Z')], seenAt);
repo.upsertMany([media('prive', 'shared', '2024-06-06T10:00:00.000Z')], seenAt);

describe('cursor pagination', () => {
  it('applies the shared default order', () => {
    // The repository default is the contract, not a local choice: they diverged
    // when `DEFAULT_SORT_ORDER` moved to `asc` (D99), and a repository left at
    // `desc` would serve the opposite of what the route claims without failures.
    const page = repo.listItems('vacances', 100, null);
    assert.deepEqual(
      page.items.map((item) => item.id),
      repo.listItems('vacances', 100, null, DEFAULT_SORT_ORDER).items.map((item) => item.id),
    );
    assert.equal(page.nextCursor, null);
  });

  it('traverses every page without duplicates or omissions', () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const page = repo.listItems('vacances', 5, cursor);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages++;
      assert.ok(pages < 20, 'pagination does not terminate');
    } while (cursor);

    const total = repo.stats('vacances').itemCount;
    assert.equal(seen.length, total);
    assert.equal(new Set(seen).size, total);
  });

  it('returns media from oldest to newest in ascending order', () => {
    const page = repo.listItems('vacances', 100, null, 'asc');
    const dates = page.items.map((item) => item.takenAt);
    assert.deepEqual(dates, [...dates].sort());
    assert.equal(page.nextCursor, null);
  });

  it('returns ascending order as the exact reverse of descending', () => {
    // Several photos share a capture date: only reversing the `id` tie-breaker
    // too makes both directions the same list read backwards. Otherwise ties
    // keep their relative order and neighbours change with direction.
    const asc = repo.listItems('vacances', 100, null, 'asc').items.map((item) => item.id);
    const desc = repo.listItems('vacances', 100, null, 'desc').items.map((item) => item.id);

    assert.deepEqual(asc, [...desc].reverse());
  });

  it('traverses every ascending page without duplicates or omissions', () => {
    const expected = repo.listItems('vacances', 1000, null, 'asc').items.map((item) => item.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const page = repo.listItems('vacances', 5, cursor, 'asc');
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages++;
      assert.ok(pages < 20, 'pagination does not terminate');
    } while (cursor);

    // Compare the full list, not only its size: an incorrectly reversed cursor
    // comparison could return the right count in the wrong order across pages.
    assert.deepEqual(seen, expected);
    assert.equal(new Set(seen).size, expected.length);
  });

  it('ignores an unreadable cursor and restarts from the beginning', () => {
    const page = repo.listItems('vacances', 3, 'curseur-invalide');
    assert.equal(page.items.length, 3);
  });

  it('isolates albums', () => {
    const page = repo.listItems('prive', 100, null);
    assert.deepEqual(page.items.map((item) => item.id).sort(), ['p01', 'shared']);
  });
});

describe('pagination during synchronisation', () => {
  // Separate album: this case inserts media during traversal, which would
  // distort other test counts.
  const chrono = ['2024-02-01', '2024-04-01', '2024-06-01', '2024-08-01'].map((day, index) =>
    media('chrono', `c${index}`, `${day}T10:00:00.000Z`),
  );
  repo.upsertMany(chrono, seenAt);

  it('neither skips nor duplicates media when sync inserts rows in ascending order', () => {
    // This is why the cursor exists: OFFSET would shift every later page as
    // soon as a row is inserted before the current position.
    const first = repo.listItems('chrono', 2, null, 'asc');
    assert.deepEqual(
      first.items.map((item) => item.id),
      ['c0', 'c1'],
    );

    // Synchronisation adds one photo behind the cursor (already passed in
    // ascending order) and another ahead of it.
    repo.upsertMany(
      [media('chrono', 'ancienne', '2023-11-01T10:00:00.000Z')],
      '2025-03-01T00:00:00.000Z',
    );
    repo.upsertMany(
      [media('chrono', 'intercalee', '2024-07-01T10:00:00.000Z')],
      '2025-03-01T00:00:00.000Z',
    );

    const seen = [...first.items.map((item) => item.id)];
    let cursor = first.nextCursor;
    while (cursor) {
      const page = repo.listItems('chrono', 2, cursor, 'asc');
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    }

    // `ancienne` is legitimately absent: it appeared behind the cursor. What
    // matters is that served rows do not return and rows ahead do not disappear.
    assert.deepEqual(seen, ['c0', 'c1', 'c2', 'intercalee', 'c3']);
    assert.equal(new Set(seen).size, seen.length);
  });
});

describe('media → albums resolution', () => {
  it('returns every album containing the file', () => {
    assert.deepEqual(repo.albumsContaining('shared').sort(), ['prive', 'vacances']);
    assert.deepEqual(repo.albumsContaining('p01'), ['prive']);
    assert.deepEqual(repo.albumsContaining('inexistant'), []);
  });
});

describe('file metadata', () => {
  it('returns the most recently seen row when a file is in two albums', () => {
    // The same Drive file indexed under two albums has two rows, which diverge
    // until one synchronisation catches up with the other.
    const ancienne = { ...media('archives-a', 'double', '2024-03-03T10:00:00.000Z') };
    ancienne.md5 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    ancienne.size = 1000;
    repo.upsertMany([ancienne], '2025-01-01T00:00:00.000Z');

    const recente = { ...media('archives-b', 'double', '2024-03-03T10:00:00.000Z') };
    recente.md5 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    recente.size = 2000;
    repo.upsertMany([recente], '2025-06-01T00:00:00.000Z');

    // Serving the old row would derive from a stale hash under an immutable ETag:
    // the corrected photo would remain displayed in its previous version.
    const meta = repo.getFileMeta('double');
    assert.equal(meta?.md5, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    assert.equal(meta?.size, 2000);
  });

  it('returns the same result on consecutive calls', () => {
    assert.deepEqual(repo.getFileMeta('double'), repo.getFileMeta('double'));
  });
});

describe('statistics', () => {
  it('counts and bounds the album', () => {
    const stats = repo.stats('prive');
    assert.equal(stats.itemCount, 2);
    assert.equal(stats.newestAt, '2024-06-06T10:00:00.000Z');
    assert.equal(stats.oldestAt, '2024-05-05T10:00:00.000Z');
    assert.equal(stats.coverId, 'shared');
  });

  it('serves the chosen cover and falls back to the most recent without it', () => {
    // A photo that is neither newest nor oldest: nothing else would promote it.
    assert.equal(repo.stats('prive', 'p01').coverId, 'p01');

    // Fallback is permanent: a photo removed from the index by sync — Drive bin
    // or renamed folder — would otherwise leave the album without a home thumbnail.
    assert.equal(repo.stats('prive', 'disparue').coverId, 'shared');
    // A properly indexed photo in another album gets the same fallback.
    assert.equal(repo.stats('prive', 'v00').coverId, 'shared');
  });

  it('rejects a video cover whose preview belongs to Drive', () => {
    // Separate album: adding a row to "prive" would distort cleanup test counts.
    const clip: MediaUpsert = {
      ...media('fete', 'clip', '2024-07-07T10:00:00.000Z'),
      kind: 'video',
      mimeType: 'video/mp4',
      durationMs: 4000,
    };
    repo.upsertMany([media('fete', 'f01', '2024-07-06T10:00:00.000Z'), clip], seenAt);

    // Neither by explicit choice — the route already refuses it and the
    // repository does not trust that — nor by fallback despite being newest.
    // Videos have thumbnails since D92, but Drive supplies them and they may be
    // absent; a cover is the only image whose absence has no home-page fallback.
    assert.equal(repo.stats('fete', 'clip').coverId, 'f01');
    assert.equal(repo.stats('fete').coverId, 'f01');
  });
});

describe('preview availability', () => {
  it('is always true for a photo and follows Drive for a video', () => {
    const avec: MediaUpsert = {
      ...media('apercus', 'clip-avec', '2024-08-02T10:00:00.000Z'),
      kind: 'video',
      mimeType: 'video/mp4',
      durationMs: 4000,
      hasThumbnail: true,
      videoCodec: null,
      sourcePath: null,
    };
    const sans: MediaUpsert = { ...avec, id: 'clip-sans', hasThumbnail: false };
    repo.upsertMany([media('apercus', 'photo', '2024-08-03T10:00:00.000Z'), avec, sans], seenAt);

    const apercus = new Map(
      repo.listItems('apercus', 10, null).items.map((item) => [item.id, item.hasPreview]),
    );

    // The front end requests an image "when one exists" and does not repeat the
    // photo/video rule. A photo always has one through decode or Drive fallback;
    // a video only has one if Drive produced it.
    assert.equal(apercus.get('photo'), true);
    assert.equal(apercus.get('clip-avec'), true);
    assert.equal(apercus.get('clip-sans'), false);
  });

  it('carries the column into media details', () => {
    // Same rule on `/items/:mediaId` as in the list: the viewer derives its
    // `poster` from the item, and both paths must agree.
    assert.equal(repo.getDetail('apercus', 'clip-sans')?.hasPreview, false);
    assert.equal(repo.getDetail('apercus', 'clip-avec')?.hasPreview, true);
  });
});

describe('cleanup', () => {
  it('removes media not seen by the latest synchronisation', () => {
    const later = '2025-02-01T00:00:00.000Z';
    // Only one photo is seen again: the others disappeared from the Drive folder.
    repo.upsertMany([media('prive', 'p01', '2024-05-05T10:00:00.000Z')], later);
    const removed = repo.deleteStale('prive', later);

    assert.equal(removed, 1);
    assert.deepEqual(
      repo.listItems('prive', 10, null).items.map((item) => item.id),
      ['p01'],
    );
    // The shared file remains indexed in the other album.
    assert.deepEqual(repo.albumsContaining('shared'), ['vacances']);
  });

  it('deletes albums absent from configuration', () => {
    repo.pruneAlbums(['vacances']);
    assert.equal(repo.stats('prive').itemCount, 0);
    assert.ok(repo.stats('vacances').itemCount > 0);
  });
});
