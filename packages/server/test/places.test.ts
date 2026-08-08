import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrate, type Db } from '../src/db.js';
import { formatPlaceLabel } from '../src/geocoder.js';
import { AlbumDayRepo, PlacesPass, cellKey, clusterDay } from '../src/places.js';
import { MediaRepo, type MediaUpsert } from '../src/repo.js';

/**
 * Lieux d'une journée : l'agrégation des positions EXIF en grappes, et ce que
 * le géocodage en fait.
 *
 * Ce qui est vérifié, ce sont les invariants du module : deux lieux distants
 * ressortent dans l'ordre du déroulé, une journée sans GPS ne produit rien, et
 * **un recalcul n'écrase jamais une saisie** — c'est celui-là qui, s'il cassait,
 * effacerait toutes les notes de l'instance au ménage horaire suivant.
 */

const BONIFACIO = { lat: 41.3878, lng: 9.1597 };
/** Une vingtaine de kilomètres plus au nord : au-delà du rayon d'agglomération. */
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
  };
}

/** Un passage sans géocodeur : l'agrégation seule, celle qui doit rester pure. */
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

/** Nomme des cellules à la main, comme le ferait un géocodage abouti. */
function label(db: Db, cell: string, value: string | null): void {
  db.prepare('INSERT INTO geo_places (cell, label, fetched_at) VALUES (?, ?, ?)').run(
    cell,
    value,
    '2026-01-01T00:00:00.000Z',
  );
}

describe('cellKey', () => {
  it('arrondit à deux décimales, soit environ un kilomètre', () => {
    assert.equal(cellKey(41.38784, 9.15971), '41.39,9.16');
    // Deux photos à quelques centaines de mètres tombent dans la même cellule :
    // c'est ce qui fait qu'elles ne comptent qu'un appel au géocodeur.
    assert.equal(cellKey(41.3901, 9.1633), cellKey(41.3878, 9.1597));
  });

  it('ne produit jamais de zéro négatif', () => {
    // '-0.00' et '0.00' sont deux clés distinctes en SQL : le même endroit
    // s'écrirait de deux façons, et serait géocodé deux fois.
    assert.equal(cellKey(-0.001, -0.002), '0.00,0.00');
  });
});

describe('clusterDay', () => {
  it('rend un seul lieu pour une journée passée au même endroit', () => {
    const cells = clusterDay([BONIFACIO, { lat: 41.39, lng: 9.163 }, { lat: 41.385, lng: 9.158 }]);
    assert.equal(cells.length, 1);
  });

  it('sépare deux lieux distants et les rend dans l’ordre du déroulé', () => {
    // « Bonifacio, puis Porto-Vecchio » : l'ordre raconte la journée, il ne
    // doit pas dépendre du nombre de photos prises à chaque étape.
    const cells = clusterDay([BONIFACIO, BONIFACIO, PORTO_VECCHIO]);
    assert.equal(cells.length, 2);
    assert.equal(cells[0], cellKey(BONIFACIO.lat, BONIFACIO.lng));

    const inverse = clusterDay([PORTO_VECCHIO, BONIFACIO, BONIFACIO]);
    assert.deepEqual(inverse, [...cells].reverse());
  });

  it('ne garde que trois grappes, les plus fournies, sans les réordonner', () => {
    // Une journée de route produirait dix noms de lieu dans un en-tête, qui ne
    // se lisent pas. On garde là où on s'est arrêté.
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
    // La grappe d'une seule photo saute ; les trois autres restent dans leur
    // ordre d'apparition, pas dans l'ordre de leur effectif.
    assert.deepEqual(cells, [cellKey(42, 9), cellKey(43, 9), cellKey(44, 9)]);
  });

  it('ne rend rien sans position', () => {
    assert.deepEqual(clusterDay([]), []);
  });
});

describe('formatPlaceLabel', () => {
  it('compose ville et région à partir d’une adresse Nominatim', () => {
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

  it('retombe sur le village quand il n’y a pas de ville', () => {
    assert.equal(
      formatPlaceLabel({ village: 'Sant’Antonino', state: 'Corse', country: 'France' }),
      'Sant’Antonino, Corse',
    );
  });

  it('ne répète pas une ville-État', () => {
    // Nominatim rend la même chaîne en `city` et en `state` à Bruxelles ou à
    // Berlin : « Bruxelles, Bruxelles » n'apprend rien.
    assert.equal(
      formatPlaceLabel({ city: 'Bruxelles', state: 'Bruxelles', country: 'Belgique' }),
      'Bruxelles, Belgique',
    );
  });

  it('rend null sur une adresse vide ou absente', () => {
    assert.equal(formatPlaceLabel(undefined), null);
    assert.equal(formatPlaceLabel({}), null);
    assert.equal(formatPlaceLabel({ city: '   ' }), null);
  });
});

describe('passage des lieux', () => {
  it('agrège une journée en deux lieux, et n’en invente pas pour une journée sans GPS', async () => {
    const db = openDb();
    const { run, days } = pass(db);

    new MediaRepo(db).upsertMany(
      [
        photo('matin', '2026-07-14T09:00:00.000Z', BONIFACIO),
        photo('midi', '2026-07-14T12:00:00.000Z', BONIFACIO),
        photo('soir', '2026-07-14T18:00:00.000Z', PORTO_VECCHIO),
        // Le lendemain, aucune photo n'est géolocalisée.
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
      'le 15 ne porte aucune position : il n’a rien à montrer',
    );
    assert.deepEqual(listed[0]!.autoPlaces, ['Bonifacio, Corse', 'Porto-Vecchio, Corse']);

    db.close();
  });

  it('n’expose pas une cellule que le géocodage n’a pas encore nommée', async () => {
    const db = openDb();
    const { run, days } = pass(db);
    new MediaRepo(db).upsertMany(
      [photo('seule', '2026-07-14T09:00:00.000Z', BONIFACIO)],
      '2026-07-20T00:00:00.000Z',
    );

    await run();
    // La ligne existe en base, mais la journée n'a rien à afficher : la
    // transporter ajouterait une entrée vide par jour d'album.
    assert.equal(days.cells('corse').length, 1);
    assert.deepEqual(days.list('corse'), []);

    // Un géocodage abouti sans résultat — pleine mer — ne la fait pas
    // apparaître davantage.
    label(db, cellKey(BONIFACIO.lat, BONIFACIO.lng), null);
    assert.deepEqual(days.list('corse'), []);

    db.close();
  });

  it('préserve la note et le lieu saisis à travers un recalcul', async () => {
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

    // Le ménage horaire repasse : c'est l'invariant du module. Un
    // `excluded.description` glissé dans le ON CONFLICT effacerait ici toutes
    // les notes de l'instance, sans un mot.
    await run();

    const day = days.get('corse', '2026-07-14')!;
    assert.equal(day.description, 'Bonifacio, puis la plage');
    assert.equal(day.place, 'Les falaises');

    db.close();
  });

  it('retire une journée dont les photos ont disparu, sauf si elle porte une saisie', async () => {
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

    // Dossier Drive réorganisé : `deleteStale` a vidé l'album.
    media.clearAlbum('corse');
    await run();

    const rows = db
      .prepare('SELECT day, cells FROM album_days WHERE album_id = ? ORDER BY day')
      .all('corse') as { day: string; cells: string | null }[];
    assert.deepEqual(
      rows.map((row) => row.day),
      ['2026-07-15'],
      'la journée sans photo ni saisie part, celle qui porte une note reste',
    );
    assert.equal(rows[0]!.cells, '[]', 'ses lieux déduits, eux, sont bien retirés');

    db.close();
  });

  it('efface une note avec null, et rend la journée invisible si rien ne reste', async () => {
    const db = openDb();
    const { days } = pass(db);

    days.upsertNote('corse', '2026-07-14', { description: 'Une note', place: 'Un lieu' });
    // Un champ absent reste inchangé — c'est la règle des PATCH de ce dépôt.
    assert.equal(days.upsertNote('corse', '2026-07-14', { place: null }).description, 'Une note');

    const vide = days.upsertNote('corse', '2026-07-14', { description: null });
    assert.equal(vide.description, null);
    assert.equal(vide.place, null);
    assert.deepEqual(days.list('corse'), [], 'une journée vidée n’a plus rien à montrer');

    // Une chaîne vide venue d'un formulaire vaut la même chose que `null` :
    // sans quoi il y aurait deux façons de dire « rien ».
    assert.equal(days.upsertNote('corse', '2026-07-14', { description: '  ' }).description, null);

    db.close();
  });

  it('suit la suppression de l’album', async () => {
    const db = openDb();
    const { days } = pass(db);
    days.upsertNote('corse', '2026-07-14', { description: 'Une note' });

    db.prepare('DELETE FROM albums WHERE id = ?').run('corse');
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM album_days').get() as { n: number }).n,
      0,
      'ON DELETE CASCADE : une note orpheline réapparaîtrait sur un album recréé sous le même id',
    );

    db.close();
  });
});
