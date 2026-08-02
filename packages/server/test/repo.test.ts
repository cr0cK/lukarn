import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { openDb } from '../src/db.js';
import { MediaRepo, type MediaUpsert } from '../src/repo.js';

const dir = mkdtempSync(join(tmpdir(), 'gdv-repo-'));
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
  };
}

const seenAt = '2025-01-01T00:00:00.000Z';

// 12 photos dans « vacances », plus une photo présente dans deux albums.
const items = Array.from({ length: 12 }, (_, index) =>
  media(
    'vacances',
    `v${String(index).padStart(2, '0')}`,
    `2024-0${(index % 9) + 1}-01T10:00:00.000Z`,
  ),
);
repo.upsertMany(items, seenAt);
repo.upsertMany([media('prive', 'p01', '2024-05-05T10:00:00.000Z')], seenAt);
// Dossiers imbriqués : le même fichier Drive indexé sous deux albums.
repo.upsertMany([media('vacances', 'shared', '2024-06-06T10:00:00.000Z')], seenAt);
repo.upsertMany([media('prive', 'shared', '2024-06-06T10:00:00.000Z')], seenAt);

describe('pagination par curseur', () => {
  it('rend les médias du plus récent au plus ancien', () => {
    const page = repo.listItems('vacances', 100, null);
    const dates = page.items.map((item) => item.takenAt);
    assert.deepEqual(dates, [...dates].sort().reverse());
    assert.equal(page.nextCursor, null);
  });

  it('parcourt toutes les pages sans doublon ni oubli', () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const page = repo.listItems('vacances', 5, cursor);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages++;
      assert.ok(pages < 20, 'pagination qui ne se termine pas');
    } while (cursor);

    const total = repo.stats('vacances').itemCount;
    assert.equal(seen.length, total);
    assert.equal(new Set(seen).size, total);
  });

  it('ignore un curseur illisible et repart du début', () => {
    const page = repo.listItems('vacances', 3, 'curseur-invalide');
    assert.equal(page.items.length, 3);
  });

  it('cloisonne les albums', () => {
    const page = repo.listItems('prive', 100, null);
    assert.deepEqual(page.items.map((item) => item.id).sort(), ['p01', 'shared']);
  });
});

describe('résolution média → albums', () => {
  it('rend tous les albums contenant le fichier', () => {
    assert.deepEqual(repo.albumsContaining('shared').sort(), ['prive', 'vacances']);
    assert.deepEqual(repo.albumsContaining('p01'), ['prive']);
    assert.deepEqual(repo.albumsContaining('inexistant'), []);
  });
});

describe('statistiques', () => {
  it("compte et borne l'album", () => {
    const stats = repo.stats('prive');
    assert.equal(stats.itemCount, 2);
    assert.equal(stats.newestAt, '2024-06-06T10:00:00.000Z');
    assert.equal(stats.oldestAt, '2024-05-05T10:00:00.000Z');
    assert.equal(stats.coverId, 'shared');
  });
});

describe('nettoyage', () => {
  it('retire les médias non revus par la dernière synchronisation', () => {
    const later = '2025-02-01T00:00:00.000Z';
    // Une seule photo est revue : les autres ont disparu du dossier Drive.
    repo.upsertMany([media('prive', 'p01', '2024-05-05T10:00:00.000Z')], later);
    const removed = repo.deleteStale('prive', later);

    assert.equal(removed, 1);
    assert.deepEqual(
      repo.listItems('prive', 10, null).items.map((item) => item.id),
      ['p01'],
    );
    // Le fichier partagé reste indexé dans l'autre album.
    assert.deepEqual(repo.albumsContaining('shared'), ['vacances']);
  });

  it('supprime les albums absents de la config', () => {
    repo.pruneAlbums(['vacances']);
    assert.equal(repo.stats('prive').itemCount, 0);
    assert.ok(repo.stats('vacances').itemCount > 0);
  });
});
