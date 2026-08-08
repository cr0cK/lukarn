import type { MediaDetail, MediaExif } from '@gdv/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { exifRows } from '../src/lib/exifRows';

/**
 * Les lignes du panneau d'informations.
 *
 * L'invariant tient à la position : elle se lit sans attendre le géocodage, et
 * son absence se dit — sur une photo seulement, parce que Drive ne rend jamais
 * de position pour une vidéo (D94).
 */

/** L'EXIF est le seul champ qu'on retouche partiellement — d'où son type à part. */
type DetailPatch = Partial<Omit<MediaDetail, 'exif'>> & { exif?: Partial<MediaExif> };

function detail(patch: DetailPatch = {}): MediaDetail {
  return {
    id: 'm1',
    albumId: 'vacances',
    name: 'IMG_0001.jpg',
    kind: 'photo',
    mimeType: 'image/jpeg',
    size: 4_200_000,
    width: 4032,
    height: 3024,
    takenAt: '2026-08-07T15:21:00.000Z',
    takenAtFromExif: true,
    durationMs: null,
    hasPreview: true,
    version: 'abc',
    description: null,
    commentCount: 0,
    ...patch,
    exif: {
      cameraMake: null,
      cameraModel: null,
      lens: null,
      isoSpeed: null,
      exposureTime: null,
      aperture: null,
      focalLength: null,
      latitude: null,
      longitude: null,
      ...patch.exif,
    },
  };
}

const position = (rows: ReturnType<typeof exifRows>): (typeof rows)[number] | undefined =>
  rows.find((row) => row.label === 'Position');

describe('lignes du panneau d’informations', () => {
  it('affiche la position sans attendre que la journée soit nommée', () => {
    const rows = exifRows(detail({ exif: { latitude: 41.3878, longitude: 9.1597 } }), {
      day: '2026-08-07',
      description: null,
      place: null,
      // Le géocodage inverse n'a encore rien rendu : la ligne « Lieu » manque,
      // la position se lit quand même.
      autoPlaces: [],
    });

    assert.equal(
      rows.find((row) => row.label === 'Lieu'),
      undefined,
    );
    assert.equal(position(rows)?.value, '41.38780° N, 9.15970° E');
    assert.match(position(rows)?.href ?? '', /openstreetmap\.org/);
  });

  it('dit qu’une photo n’a pas de position, au lieu de taire la ligne', () => {
    const row = position(exifRows(detail(), undefined));

    assert.equal(row?.value, 'Aucune donnée GPS');
    assert.equal(row?.absent, true);
    // Une absence ne se clique pas : sans coordonnées, il n'y a nulle part où
    // ouvrir une carte.
    assert.equal(row?.href, undefined);
  });

  it('ne dit rien de la position d’une vidéo, que Drive ne géolocalise jamais', () => {
    const rows = exifRows(detail({ kind: 'video', durationMs: 12_000 }), undefined);

    assert.equal(position(rows), undefined);
    // La ligne manquante n'emporte pas le reste du panneau avec elle.
    assert.equal(rows.find((row) => row.label === 'Durée')?.value, '0:12');
  });
});
