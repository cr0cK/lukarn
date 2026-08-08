import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrate, type Db } from '../src/db.js';
import { SearchRepo, toMatchExpression } from '../src/search.js';

/**
 * Recherche d'entités dans les textes de la bibliothèque.
 *
 * Ce qui est vérifié, ce sont les invariants — pas le SQL. Deux comptent plus
 * que les autres : **le cloisonnement**, parce qu'un résultat de trop montre le
 * texte d'un album qu'on n'a pas le droit d'ouvrir, et **la fraîcheur de
 * l'index**, parce qu'elle repose entièrement sur des déclencheurs SQL. Un
 * index périmé ne se voit pas : il rend simplement moins de résultats.
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

describe('expression de recherche', () => {
  it('met chaque mot en préfixe, et neutralise la syntaxe de FTS5', () => {
    assert.equal(toMatchExpression('mar pla'), '"mar"* "pla"*');
    // `AND`, `NEAR`, `-` et les guillemets seraient interprétés hors des
    // guillemets : une frappe légitime ferait alors répondre 500.
    assert.equal(toMatchExpression('a"b'), '"a""b"*');
    assert.equal(toMatchExpression('NEAR(x y)'), '"NEAR(x"* "y)"*');
  });

  it('rend null quand il ne reste rien à chercher', () => {
    // Le tokenizer ne tirerait aucun terme de ces saisies, et `""*` est une
    // expression que FTS5 accepte sans rien rendre : la liste se viderait sans
    // que rien ne dise pourquoi.
    assert.equal(toMatchExpression('   '), null);
    assert.equal(toMatchExpression('-- ??'), null);
  });
});

describe('recherche', () => {
  it('cloisonne : rien ne remonte d’un album non attribué', () => {
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
    // Ni par le titre, ni par la note, ni par le lieu saisi, ni par le lieu
    // géocodé — c'est ce dernier qui n'a pas d'album_id à lui, donc le plus
    // facile à laisser fuir.
    assert.deepEqual(repo.search([], 'marseille'), []);
    assert.deepEqual(repo.search(['autre'], 'marseille'), []);

    db.close();
  });

  it('ignore les accents et cherche par préfixe', () => {
    const db = openDb();
    album(db, 'corse', 'Été en Corse');
    day(db, 'corse', '2026-07-14', { place: 'Marseille' });

    const repo = new SearchRepo(db);
    // « ete » trouve « été » : c'est le tokenizer qui replie les diacritiques,
    // aucune colonne normalisée n'est tenue à la main.
    assert.deepEqual(
      repo.search(['corse'], 'ete').map((hit) => hit.label),
      ['Été en Corse'],
    );
    // « mar » trouve « Marseille » avant que le mot soit tapé en entier : sans
    // le préfixe, une suggestion au fil de la frappe n'aurait rien à suggérer.
    assert.deepEqual(
      repo.search(['corse'], 'mar').map((hit) => hit.label),
      ['Marseille'],
    );

    db.close();
  });

  it('rend la journée que porte un libellé géocodé, dans son album', () => {
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

  it('ne rend qu’une fois une journée qui correspond deux fois', () => {
    const db = openDb();
    album(db, 'corse', 'Corse');
    // La note **et** le lieu géocodé portent le même mot : deux requêtes
    // trouvent la même journée, et deux lignes mèneraient au même endroit.
    day(db, 'corse', '2026-07-14', {
      description: 'Marché de Bonifacio',
      place: 'Bonifacio',
      cells: ['41.39,9.16'],
    });
    place(db, '41.39,9.16', 'Bonifacio, Corse-du-Sud');

    const hits = new SearchRepo(db).search(['corse'], 'bonifacio');
    assert.equal(hits.length, 1);
    // La saisie l'emporte : elle est plus précise que le nom de la commune.
    assert.equal(hits[0]!.label, 'Bonifacio');
    assert.equal(hits[0]!.context, 'Marché de Bonifacio');

    db.close();
  });

  it('n’ouvre pas une visionneuse vide : la description d’un média disparu ne rend rien', () => {
    const db = openDb();
    album(db, 'corse', 'Corse');
    media(db, 'corse', 'present');
    note(db, 'corse', 'present', 'Le ponton au petit matin');
    // `deleteStale` retire une photo de l'index sans retirer sa description
    // (D83) : la note survit à un dossier Drive réorganisé, mais elle ne doit
    // pas rester cliquable.
    note(db, 'corse', 'disparu', 'Le ponton au coucher du soleil');

    const hits = new SearchRepo(db).search(['corse'], 'ponton');
    assert.deepEqual(
      hits.map((hit) => hit.mediaId),
      ['present'],
    );

    db.close();
  });

  it('suit les écritures sans qu’aucun code applicatif ne réindexe', () => {
    const db = openDb();
    album(db, 'corse', 'Été en Corse');
    day(db, 'corse', '2026-07-14', { description: 'Marché de Bonifacio' });
    media(db, 'corse', 'm1');
    note(db, 'corse', 'm1', 'Léa saute du ponton');
    const repo = new SearchRepo(db);

    // Renommer : l'ancien titre s'efface, le nouveau se trouve.
    db.prepare('UPDATE albums SET title = ? WHERE id = ?').run('Hiver en Corse', 'corse');
    assert.deepEqual(repo.search(['corse'], 'ete'), []);
    assert.equal(repo.search(['corse'], 'hiver').length, 1);

    // Effacer une note : `AlbumDayRepo.upsertNote` écrit NULL plutôt que de
    // supprimer la ligne, et l'index doit suivre cet UPDATE-là aussi.
    db.prepare('UPDATE album_days SET description = NULL WHERE album_id = ? AND day = ?').run(
      'corse',
      '2026-07-14',
    );
    assert.deepEqual(repo.search(['corse'], 'bonifacio'), []);

    // Supprimer l'album : la cascade emporte journées et descriptions, et les
    // déclencheurs `AFTER DELETE` se déclenchent bien sur une suppression que
    // personne n'a écrite en SQL.
    db.prepare('DELETE FROM albums WHERE id = ?').run('corse');
    assert.deepEqual(repo.search(['corse'], 'ponton'), []);
    assert.deepEqual(repo.search(['corse'], 'hiver'), []);

    // Et l'index n'est pas seulement vide de résultats : il est sain.
    for (const table of ['albums_fts', 'album_days_fts', 'media_notes_fts', 'geo_places_fts']) {
      db.exec(`INSERT INTO ${table}(${table}) VALUES ('integrity-check')`);
    }

    db.close();
  });

  it('groupe les résultats par type et borne chaque groupe', () => {
    const db = openDb();
    album(db, 'corse', 'Plage', 'La plage tous les jours');
    for (let index = 0; index < 7; index++) {
      day(db, 'corse', `2026-07-0${index + 1}`, { description: `Plage numéro ${index}` });
      media(db, 'corse', `m${index}`);
      note(db, 'corse', `m${index}`, `Plage, cliché ${index}`);
    }

    const hits = new SearchRepo(db).search(['corse'], 'plage');
    // L'ordre des groupes est celui de l'affichage : albums, journées, photos.
    assert.deepEqual(
      hits.map((hit) => hit.kind),
      ['album', ...Array<string>(5).fill('day'), ...Array<string>(5).fill('media')],
    );
    // Chaque résultat porte le titre de son album : la liste couvre plusieurs
    // albums, et un libellé seul ne dirait pas d'où il vient.
    assert.ok(hits.every((hit) => hit.albumTitle === 'Plage'));

    db.close();
  });

  it('exige que tous les mots correspondent', () => {
    const db = openDb();
    album(db, 'corse', 'Corse');
    day(db, 'corse', '2026-07-14', { description: 'Marché de Bonifacio', place: 'Bonifacio' });
    day(db, 'corse', '2026-07-15', { description: 'Plage de Palombaggia' });

    const repo = new SearchRepo(db);
    // ET implicite entre les mots : deux mots réduisent la liste, ils ne
    // l'élargissent pas.
    assert.equal(repo.search(['corse'], 'marche bonif').length, 1);
    assert.deepEqual(repo.search(['corse'], 'marche palombaggia'), []);

    db.close();
  });
});
