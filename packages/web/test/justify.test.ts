import type { MediaItem } from '@gdv/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeLayout, monthKey, monthLabel, targetRowHeightFor } from '../src/lib/justify';

const OPTIONS = {
  containerWidth: 1200,
  targetRowHeight: 240,
  gap: 4,
  headerHeight: 56,
  sectionGap: 28,
};

function photo(id: string, takenAt: string, width = 4000, height = 3000): MediaItem {
  return {
    id,
    albumId: 'a',
    name: `${id}.jpg`,
    kind: 'photo',
    mimeType: 'image/jpeg',
    size: 1000,
    width,
    height,
    takenAt,
    takenAtFromExif: true,
    durationMs: null,
  };
}

/** 30 photos réparties sur trois mois consécutifs. */
const items = Array.from({ length: 30 }, (_, index) => {
  const month = String(3 + Math.floor(index / 10)).padStart(2, '0');
  const day = String((index % 10) + 1).padStart(2, '0');
  return photo(`p${index}`, `2024-${month}-${day}T10:00:00.000Z`);
});

describe('computeLayout', () => {
  it('ne rend rien sans largeur mesurée', () => {
    const layout = computeLayout(items, { ...OPTIONS, containerWidth: 0 });
    assert.equal(layout.totalHeight, 0);
    assert.deepEqual(layout.sections, []);
  });

  it('ne rend rien sans média', () => {
    const layout = computeLayout([], OPTIONS);
    assert.equal(layout.totalHeight, 0);
  });

  it("regroupe par mois dans l'ordre reçu", () => {
    const layout = computeLayout(items, OPTIONS);
    assert.deepEqual(
      layout.sections.map((section) => section.key),
      ['2024-03', '2024-04', '2024-05'],
    );
  });

  it('place chaque média une fois et une seule', () => {
    const layout = computeLayout(items, OPTIONS);
    const indexes = layout.rows.flatMap((row) => row.cells.map((cell) => cell.index));

    assert.equal(indexes.length, items.length);
    assert.deepEqual(
      [...indexes].sort((a, b) => a - b),
      items.map((_, index) => index),
    );
  });

  it('remplit exactement la largeur sur les lignes justifiées', () => {
    const layout = computeLayout(items, OPTIONS);

    for (const section of layout.sections) {
      // La dernière ligne d'une section n'est volontairement pas justifiée.
      for (const row of section.rows.slice(0, -1)) {
        const last = row.cells.at(-1)!;
        assert.equal(
          last.x + last.width,
          OPTIONS.containerWidth,
          'une ligne justifiée doit finir pile au bord droit',
        );
      }
    }
  });

  it("n'étire pas la dernière ligne d'une section", () => {
    // Deux photos seules ne peuvent pas remplir 1200 px sans devenir énormes.
    const layout = computeLayout(
      [photo('a', '2024-03-01T10:00:00.000Z'), photo('b', '2024-03-02T10:00:00.000Z')],
      OPTIONS,
    );
    const row = layout.rows[0]!;

    assert.equal(row.height, OPTIONS.targetRowHeight);
    assert.ok(row.cells.at(-1)!.x + row.cells.at(-1)!.width < OPTIONS.containerWidth);
  });

  it('respecte les proportions de chaque image', () => {
    const layout = computeLayout(
      [
        photo('paysage', '2024-03-01T10:00:00.000Z', 3000, 2000),
        photo('portrait', '2024-03-02T10:00:00.000Z', 2000, 3000),
      ],
      OPTIONS,
    );

    const [paysage, portrait] = layout.rows[0]!.cells;
    assert.ok(paysage!.width > portrait!.width, 'le paysage doit être plus large que le portrait');
    assert.ok(Math.abs(paysage!.width / paysage!.height - 1.5) < 0.05);
  });

  it('donne une proportion de repli aux médias sans dimensions', () => {
    const orphan: MediaItem = {
      ...photo('x', '2024-03-01T10:00:00.000Z'),
      width: null,
      height: null,
    };
    const layout = computeLayout([orphan], OPTIONS);
    const cell = layout.rows[0]!.cells[0]!;

    assert.ok(cell.width > 0 && cell.height > 0);
  });

  it('borne les images extrêmement panoramiques', () => {
    // Sans borne, un panorama 20:1 écraserait toute sa ligne.
    const panorama = photo('pano', '2024-03-01T10:00:00.000Z', 20000, 1000);
    const layout = computeLayout([panorama], OPTIONS);
    const cell = layout.rows[0]!.cells[0]!;

    assert.ok(cell.width / cell.height <= 3.6);
  });

  it('empile les sections sans chevauchement', () => {
    const layout = computeLayout(items, OPTIONS);

    for (let index = 1; index < layout.sections.length; index++) {
      const previous = layout.sections[index - 1]!;
      const current = layout.sections[index]!;
      assert.equal(current.y, previous.y + previous.height + OPTIONS.sectionGap);
    }

    const last = layout.sections.at(-1)!;
    assert.equal(layout.totalHeight, last.y + last.height);
  });

  it('produit des lignes plus courtes quand la fenêtre rétrécit', () => {
    const large = computeLayout(items, OPTIONS);
    const small = computeLayout(items, { ...OPTIONS, containerWidth: 480 });

    assert.ok(small.totalHeight > large.totalHeight);
    assert.ok(small.rows.length > large.rows.length);
  });
});

describe('regroupement par mois', () => {
  it('extrait la clé YYYY-MM', () => {
    assert.equal(monthKey('2024-07-14T18:32:10.000Z'), '2024-07');
  });

  it('rend un libellé lisible avec majuscule', () => {
    assert.equal(monthLabel('2024-07'), 'Juillet 2024');
  });
});

describe('targetRowHeightFor', () => {
  it('grandit avec la largeur disponible', () => {
    const widths = [400, 600, 1000, 1600, 2400];
    const heights = widths.map(targetRowHeightFor);
    assert.deepEqual(
      heights,
      [...heights].sort((a, b) => a - b),
    );
  });
});
