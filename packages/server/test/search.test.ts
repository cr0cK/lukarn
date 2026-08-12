import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrate, type Db } from '../src/db.js';
import { SearchRepo, toMatchExpression } from '../src/search.js';

/**
 * Entity search across the library's text.
 *
 * This verifies the invariants, not the SQL. Two matter more than the others:
 * **isolation**, because one result too many exposes text from an album the
 * visitor is not allowed to open, and **index freshness**, because it relies
 * entirely on SQL triggers. A stale index is invisible: it simply returns
 * fewer results.
 */

const DATE = '2026-01-01T00:00:00.000Z';

function openDb(): Db {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function album(db: Db, id: string, title: string, description: string | null = null): void {
  db.prepare(
    `INSERT INTO albums (id, title, description, folder_id, recursive, position, created_at, updated_at)
     VALUES (?, ?, ?, 'dossier', 1, 0, ?, ?)`,
  ).run(id, title, description, DATE, DATE);
}

function media(db: Db, albumId: string, id: string): void {
  db.prepare(
    `INSERT INTO media (album_id, id, name, mime_type, kind, taken_at, modified_time, seen_at)
     VALUES (?, ?, 'IMG.jpg', 'image/jpeg', 'photo', ?, ?, ?)`,
  ).run(albumId, id, DATE, DATE, DATE);
}

function note(db: Db, albumId: string, mediaId: string, description: string): void {
  db.prepare(
    `INSERT INTO media_notes (album_id, media_id, description, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(albumId, mediaId, description, DATE);
}

function day(
  db: Db,
  albumId: string,
  value: string,
  fields: { description?: string | null; place?: string | null; cells?: string[] } = {},
): void {
  db.prepare(
    `INSERT INTO album_days (album_id, day, description, place, cells, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    albumId,
    value,
    fields.description ?? null,
    fields.place ?? null,
    fields.cells ? JSON.stringify(fields.cells) : null,
    DATE,
  );
}

function place(db: Db, cell: string, label: string | null): void {
  db.prepare('INSERT INTO geo_places (cell, label, fetched_at) VALUES (?, ?, ?)').run(
    cell,
    label,
    DATE,
  );
}

describe('search expression', () => {
  it('turns each word into a prefix and neutralises FTS5 syntax', () => {
    assert.equal(toMatchExpression('mar pla'), '"mar"* "pla"*');
    // `AND`, `NEAR`, `-` and quotes would be interpreted outside the quotes:
    // legitimate input would then produce a 500 response.
    assert.equal(toMatchExpression('a"b'), '"a""b"*');
    assert.equal(toMatchExpression('NEAR(x y)'), '"NEAR(x"* "y)"*');
  });

  it('returns null when nothing remains to search for', () => {
    // The tokenizer would extract no term from these inputs, and `""*` is an
    // expression FTS5 accepts while returning nothing: the list would become
    // empty without explaining why.
    assert.equal(toMatchExpression('   '), null);
    assert.equal(toMatchExpression('-- ??'), null);
  });
});

describe('search', () => {
  it('isolates results: nothing surfaces from an unassigned album', () => {
    const db = openDb();
    album(db, 'prive', 'Album privé', 'Séjour à Marseille');
    day(db, 'prive', '2026-07-15', {
      description: 'Vieux-Port à Marseille',
      place: 'Marseille',
      cells: ['43.29,5.37'],
    });
    place(db, '43.29,5.37', 'Marseille, Bouches-du-Rhône');
    media(db, 'prive', 'm1');
    note(db, 'prive', 'm1', 'Le Vieux-Port de Marseille');

    const repo = new SearchRepo(db);
    // Neither through the title, the note, the entered place nor the geocoded
    // place — the latter has no album_id of its own, so is the easiest to leak.
    assert.deepEqual(repo.search([], 'marseille'), []);
    assert.deepEqual(repo.search(['autre'], 'marseille'), []);

    db.close();
  });

  it('ignores accents and searches by prefix', () => {
    const db = openDb();
    album(db, 'corse', 'Été en Corse');
    day(db, 'corse', '2026-07-14', { place: 'Marseille' });

    const repo = new SearchRepo(db);
    // "ete" finds "été": the tokenizer folds diacritics, so no normalised
    // column needs to be maintained by hand.
    assert.deepEqual(
      repo.search(['corse'], 'ete').map((hit) => hit.label),
      ['Été en Corse'],
    );
    // "mar" finds "Marseille" before the whole word is typed: without the
    // prefix, an incremental suggestion would have nothing to suggest.
    assert.deepEqual(
      repo.search(['corse'], 'mar').map((hit) => hit.label),
      ['Marseille'],
    );

    db.close();
  });

  it('returns the day associated with a geocoded label in its album', () => {
    const db = openDb();
    album(db, 'corse', 'Corse');
    day(db, 'corse', '2026-07-14', { cells: ['41.39,9.16'] });
    place(db, '41.39,9.16', 'Bonifacio, Corse-du-Sud');

    const hits = new SearchRepo(db).search(['corse'], 'bonif');
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.kind, 'day');
    assert.equal(hits[0]!.albumId, 'corse');
    assert.equal(hits[0]!.day, '2026-07-14');
    assert.equal(hits[0]!.label, 'Bonifacio, Corse-du-Sud');

    db.close();
  });

  it('returns a day only once when it matches twice', () => {
    const db = openDb();
    album(db, 'corse', 'Corse');
    // The note **and** the geocoded place contain the same word: two queries
    // find the same day, and two rows would lead to the same place.
    day(db, 'corse', '2026-07-14', {
      description: 'Marché de Bonifacio',
      place: 'Bonifacio',
      cells: ['41.39,9.16'],
    });
    place(db, '41.39,9.16', 'Bonifacio, Corse-du-Sud');

    const hits = new SearchRepo(db).search(['corse'], 'bonifacio');
    assert.equal(hits.length, 1);
    // The entered place takes precedence: it is more precise than the town name.
    assert.equal(hits[0]!.label, 'Bonifacio');
    assert.equal(hits[0]!.context, 'Marché de Bonifacio');

    db.close();
  });

  it('does not open an empty viewer: the description of missing media returns nothing', () => {
    const db = openDb();
    album(db, 'corse', 'Corse');
    media(db, 'corse', 'present');
    note(db, 'corse', 'present', 'Le ponton au petit matin');
    // `deleteStale` removes a photo from the index without removing its
    // description (D83): the note survives a reorganised Drive folder, but it
    // must not remain clickable.
    note(db, 'corse', 'disparu', 'Le ponton au coucher du soleil');

    const hits = new SearchRepo(db).search(['corse'], 'ponton');
    assert.deepEqual(
      hits.map((hit) => hit.mediaId),
      ['present'],
    );

    db.close();
  });

  it('tracks writes without application code rebuilding the index', () => {
    const db = openDb();
    album(db, 'corse', 'Été en Corse');
    day(db, 'corse', '2026-07-14', { description: 'Marché de Bonifacio' });
    media(db, 'corse', 'm1');
    note(db, 'corse', 'm1', 'Léa saute du ponton');
    const repo = new SearchRepo(db);

    // Renaming removes the old title and makes the new one searchable.
    db.prepare('UPDATE albums SET title = ? WHERE id = ?').run('Hiver en Corse', 'corse');
    assert.deepEqual(repo.search(['corse'], 'ete'), []);
    assert.equal(repo.search(['corse'], 'hiver').length, 1);

    // Clearing a note makes `AlbumDayRepo.upsertNote` write NULL instead of
    // deleting the row, and the index must track that UPDATE as well.
    db.prepare('UPDATE album_days SET description = NULL WHERE album_id = ? AND day = ?').run(
      'corse',
      '2026-07-14',
    );
    assert.deepEqual(repo.search(['corse'], 'bonifacio'), []);

    // Deleting the album cascades to days and descriptions, and the `AFTER
    // DELETE` triggers must run even when no caller issued their own SQL.
    db.prepare('DELETE FROM albums WHERE id = ?').run('corse');
    assert.deepEqual(repo.search(['corse'], 'ponton'), []);
    assert.deepEqual(repo.search(['corse'], 'hiver'), []);

    // The index must be healthy, not merely empty of results.
    for (const table of ['albums_fts', 'album_days_fts', 'media_notes_fts', 'geo_places_fts']) {
      db.exec(`INSERT INTO ${table}(${table}) VALUES ('integrity-check')`);
    }

    db.close();
  });

  it('groups results by type and limits each group', () => {
    const db = openDb();
    album(db, 'corse', 'Plage', 'La plage tous les jours');
    for (let index = 0; index < 7; index++) {
      day(db, 'corse', `2026-07-0${index + 1}`, { description: `Plage numéro ${index}` });
      media(db, 'corse', `m${index}`);
      note(db, 'corse', `m${index}`, `Plage, cliché ${index}`);
    }

    const hits = new SearchRepo(db).search(['corse'], 'plage');
    // Group order matches display order: albums, days, photos.
    assert.deepEqual(
      hits.map((hit) => hit.kind),
      ['album', ...Array<string>(5).fill('day'), ...Array<string>(5).fill('media')],
    );
    // Each result carries its album title: the list spans several albums, and
    // a label alone would not show where it came from.
    assert.ok(hits.every((hit) => hit.albumTitle === 'Plage'));

    db.close();
  });

  it('requires every word to match', () => {
    const db = openDb();
    album(db, 'corse', 'Corse');
    day(db, 'corse', '2026-07-14', { description: 'Marché de Bonifacio', place: 'Bonifacio' });
    day(db, 'corse', '2026-07-15', { description: 'Plage de Palombaggia' });

    const repo = new SearchRepo(db);
    // An implicit AND between words means two words narrow the list rather
    // than widening it.
    assert.equal(repo.search(['corse'], 'marche bonif').length, 1);
    assert.deepEqual(repo.search(['corse'], 'marche palombaggia'), []);

    db.close();
  });
});
