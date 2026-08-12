import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrate, type Db } from '../src/db.js';
import { formatPlaceLabel } from '../src/geocoder.js';
import { AlbumDayRepo, PlacesPass, cellKey, clusterDay } from '../src/places.js';
import { MediaRepo, type MediaUpsert } from '../src/repo.js';

/**
 * Places for a day: grouping EXIF positions into clusters and geocoding them.
 *
 * The module invariants are verified: distant places follow itinerary order, a
 * day without GPS produces nothing, and **recalculation never overwrites user
 * input** — breaking this would erase every note at the next hourly cleanup.
 */

const BONIFACIO = { lat: 41.3878, lng: 9.1597 };
/** About twenty kilometres further north: beyond the urban area radius. */
const PORTO_VECCHIO = { lat: 41.5911, lng: 9.2795 };

function openDb(): Db {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  db.prepare(
    `INSERT INTO albums (id, title, folder_id, recursive, position, created_at, updated_at)
     VALUES ('corse', 'Corse', 'dossier', 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  ).run();
  return db;
}

function photo(id: string, takenAt: string, point?: { lat: number; lng: number }): MediaUpsert {
  return {
    albumId: 'corse',
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
    cameraMake: null,
    cameraModel: null,
    lens: null,
    isoSpeed: null,
    exposureTime: null,
    aperture: null,
    focalLength: null,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    md5: null,
    hasThumbnail: true,
    videoCodec: null,
  };
}

/** A pass without a geocoder: aggregation alone, which must remain pure. */
function pass(db: Db): { run: () => Promise<unknown>; days: AlbumDayRepo } {
  const days = new AlbumDayRepo(db);
  const places = new PlacesPass({
    albums: () => [{ id: 'corse' }],
    media: new MediaRepo(db),
    days,
    geocoder: null,
    log: { info: () => {}, debug: () => {} },
  });
  return { run: () => places.run(), days };
}

/** Names cells manually as completed geocoding would. */
function label(db: Db, cell: string, value: string | null): void {
  db.prepare('INSERT INTO geo_places (cell, label, fetched_at) VALUES (?, ?, ?)').run(
    cell,
    value,
    '2026-01-01T00:00:00.000Z',
  );
}

describe('cellKey', () => {
  it('rounds to two decimal places, about one kilometre', () => {
    assert.equal(cellKey(41.38784, 9.15971), '41.39,9.16');
    // Two photos a few hundred metres apart fall in the same cell, resulting in
    // only one geocoder call.
    assert.equal(cellKey(41.3901, 9.1633), cellKey(41.3878, 9.1597));
  });

  it('never produces negative zero', () => {
    // '-0.00' and '0.00' are distinct SQL keys: the same place would have two
    // spellings and be geocoded twice.
    assert.equal(cellKey(-0.001, -0.002), '0.00,0.00');
  });
});

describe('clusterDay', () => {
  it('returns one place for a day spent in the same location', () => {
    const cells = clusterDay([BONIFACIO, { lat: 41.39, lng: 9.163 }, { lat: 41.385, lng: 9.158 }]);
    assert.equal(cells.length, 1);
  });

  it('separates distant places and returns them in itinerary order', () => {
    // "Bonifacio, then Porto-Vecchio": order tells the day's story and must not
    // depend on how many photos were taken at each stop.
    const cells = clusterDay([BONIFACIO, BONIFACIO, PORTO_VECCHIO]);
    assert.equal(cells.length, 2);
    assert.equal(cells[0], cellKey(BONIFACIO.lat, BONIFACIO.lng));

    const inverse = clusterDay([PORTO_VECCHIO, BONIFACIO, BONIFACIO]);
    assert.deepEqual(inverse, [...cells].reverse());
  });

  it('keeps only the three largest clusters without reordering them', () => {
    // A day on the road would produce ten unreadable place names in a header.
    // Keep the places where people stopped.
    const points = [
      { lat: 41.0, lng: 9.0 }, // 1 photo
      { lat: 42.0, lng: 9.0 }, // 3 photos
      { lat: 42.0, lng: 9.0 },
      { lat: 42.0, lng: 9.0 },
      { lat: 43.0, lng: 9.0 }, // 2 photos
      { lat: 43.0, lng: 9.0 },
      { lat: 44.0, lng: 9.0 }, // 2 photos
      { lat: 44.0, lng: 9.0 },
    ];
    const cells = clusterDay(points);

    assert.equal(cells.length, 3);
    // The single-photo cluster is dropped; the other three retain appearance
    // order rather than size order.
    assert.deepEqual(cells, [cellKey(42, 9), cellKey(43, 9), cellKey(44, 9)]);
  });

  it('returns nothing without positions', () => {
    assert.deepEqual(clusterDay([]), []);
  });
});

describe('formatPlaceLabel', () => {
  it('combines city and region from a Nominatim address', () => {
    assert.equal(
      formatPlaceLabel({
        city: 'Bonifacio',
        county: 'Corse-du-Sud',
        state: 'Corse',
        country: 'France',
      }),
      'Bonifacio, Corse',
    );
  });

  it('falls back to the village when there is no city', () => {
    assert.equal(
      formatPlaceLabel({ village: 'Sant’Antonino', state: 'Corse', country: 'France' }),
      'Sant’Antonino, Corse',
    );
  });

  it('does not repeat a city-state', () => {
    // Nominatim returns the same string for `city` and `state` in Brussels or
    // Berlin: "Brussels, Brussels" adds nothing.
    assert.equal(
      formatPlaceLabel({ city: 'Bruxelles', state: 'Bruxelles', country: 'Belgique' }),
      'Bruxelles, Belgique',
    );
  });

  it('returns null for an empty or missing address', () => {
    assert.equal(formatPlaceLabel(undefined), null);
    assert.equal(formatPlaceLabel({}), null);
    assert.equal(formatPlaceLabel({ city: '   ' }), null);
  });
});

describe('places pass', () => {
  it('aggregates a day into two places without inventing one for a day without GPS', async () => {
    const db = openDb();
    const { run, days } = pass(db);

    new MediaRepo(db).upsertMany(
      [
        photo('matin', '2026-07-14T09:00:00.000Z', BONIFACIO),
        photo('midi', '2026-07-14T12:00:00.000Z', BONIFACIO),
        photo('soir', '2026-07-14T18:00:00.000Z', PORTO_VECCHIO),
        // The next day, no photo is geolocated.
        photo('lendemain', '2026-07-15T10:00:00.000Z'),
      ],
      '2026-07-20T00:00:00.000Z',
    );

    await run();
    label(db, cellKey(BONIFACIO.lat, BONIFACIO.lng), 'Bonifacio, Corse');
    label(db, cellKey(PORTO_VECCHIO.lat, PORTO_VECCHIO.lng), 'Porto-Vecchio, Corse');

    const listed = days.list('corse');
    assert.deepEqual(
      listed.map((day) => day.day),
      ['2026-07-14'],
      'the 15th has no position: it has nothing to show',
    );
    assert.deepEqual(listed[0]!.autoPlaces, ['Bonifacio, Corse', 'Porto-Vecchio, Corse']);

    db.close();
  });

  it('does not expose a cell geocoding has not named yet', async () => {
    const db = openDb();
    const { run, days } = pass(db);
    new MediaRepo(db).upsertMany(
      [photo('seule', '2026-07-14T09:00:00.000Z', BONIFACIO)],
      '2026-07-20T00:00:00.000Z',
    );

    await run();
    // The row exists, but the day has nothing to display: carrying it would add
    // an empty entry for every album day.
    assert.equal(days.cells('corse').length, 1);
    assert.deepEqual(days.list('corse'), []);

    // Completed geocoding with no result — open sea — does not expose it either.
    label(db, cellKey(BONIFACIO.lat, BONIFACIO.lng), null);
    assert.deepEqual(days.list('corse'), []);

    db.close();
  });

  it('preserves an entered note and place through recalculation', async () => {
    const db = openDb();
    const { run, days } = pass(db);
    new MediaRepo(db).upsertMany(
      [photo('matin', '2026-07-14T09:00:00.000Z', BONIFACIO)],
      '2026-07-20T00:00:00.000Z',
    );

    await run();
    days.upsertNote('corse', '2026-07-14', {
      description: 'Bonifacio, puis la plage',
      place: 'Les falaises',
    });

    // Hourly cleanup runs again: this is the module invariant. An
    // `excluded.description` slipped into ON CONFLICT would silently erase all
    // instance notes here.
    await run();

    const day = days.get('corse', '2026-07-14')!;
    assert.equal(day.description, 'Bonifacio, puis la plage');
    assert.equal(day.place, 'Les falaises');

    db.close();
  });

  it('removes a day whose photos disappeared unless it contains user input', async () => {
    const db = openDb();
    const media = new MediaRepo(db);
    const { run, days } = pass(db);

    media.upsertMany(
      [
        photo('anonyme', '2026-07-14T09:00:00.000Z', BONIFACIO),
        photo('annotee', '2026-07-15T09:00:00.000Z', BONIFACIO),
      ],
      '2026-07-20T00:00:00.000Z',
    );
    await run();
    days.upsertNote('corse', '2026-07-15', { description: 'Le jour du départ' });

    // Reorganised Drive folder: `deleteStale` emptied the album.
    media.clearAlbum('corse');
    await run();

    const rows = db
      .prepare('SELECT day, cells FROM album_days WHERE album_id = ? ORDER BY day')
      .all('corse') as { day: string; cells: string | null }[];
    assert.deepEqual(
      rows.map((row) => row.day),
      ['2026-07-15'],
      'the day without photos or input leaves; the day with a note remains',
    );
    assert.equal(rows[0]!.cells, '[]', 'its inferred places are removed');

    db.close();
  });

  it('clears a note with null and hides the day if nothing remains', async () => {
    const db = openDb();
    const { days } = pass(db);

    days.upsertNote('corse', '2026-07-14', { description: 'Une note', place: 'Un lieu' });
    // An absent field remains unchanged — the repository's PATCH rule.
    assert.equal(days.upsertNote('corse', '2026-07-14', { place: null }).description, 'Une note');

    const vide = days.upsertNote('corse', '2026-07-14', { description: null });
    assert.equal(vide.description, null);
    assert.equal(vide.place, null);
    assert.deepEqual(days.list('corse'), [], 'an emptied day has nothing left to show');

    // An empty form string means the same as `null`, avoiding two ways to say "nothing".
    assert.equal(days.upsertNote('corse', '2026-07-14', { description: '  ' }).description, null);

    db.close();
  });

  it('follows album deletion', async () => {
    const db = openDb();
    const { days } = pass(db);
    days.upsertNote('corse', '2026-07-14', { description: 'Une note' });

    db.prepare('DELETE FROM albums WHERE id = ?').run('corse');
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM album_days').get() as { n: number }).n,
      0,
      'ON DELETE CASCADE: an orphaned note would reappear on an album recreated with the same id',
    );

    db.close();
  });
});
