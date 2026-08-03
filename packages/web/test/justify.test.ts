import type { MediaItem } from '@gdv/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeLayout,
  dayKey,
  dayLabel,
  monthKey,
  monthLabel,
  targetRowHeightFor,
} from '../src/lib/justify';

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
    version: null,
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

  it('segmente aussi bien un album servi du plus ancien au plus récent', () => {
    // La grille ne trie rien : elle découpe la suite reçue en mois consécutifs.
    // Le tri ascendant de l'API doit donc lui suffire tel quel, en-têtes dans
    // l'ordre inverse et sans mois dédoublé.
    const layout = computeLayout([...items].reverse(), OPTIONS);

    assert.deepEqual(
      layout.sections.map((section) => section.key),
      ['2024-05', '2024-04', '2024-03'],
    );
    assert.equal(layout.rows.flatMap((row) => row.cells).length, items.length);
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

describe('regroupement par jour', () => {
  it('extrait la clé YYYY-MM-DD', () => {
    assert.equal(dayKey('2024-07-14T18:32:10.000Z'), '2024-07-14');
  });

  it('ne bascule pas de jour pour une prise de vue de fin de soirée', () => {
    // Le piège du fuseau : lue en Europe/Paris, une photo de 23 h 30 le 14
    // tomberait au 15. `taken_at` étant l'heure de l'appareil, elle doit rester
    // au 14 quel que soit le fuseau du navigateur.
    assert.equal(dayKey('2024-07-14T23:30:00.000Z'), '2024-07-14');
    assert.equal(dayKey('2024-07-15T00:30:00.000Z'), '2024-07-15');
  });

  it('rend une date lisible plutôt que la clé technique', () => {
    assert.equal(dayLabel('2026-07-14', '2026-08-01'), '14 juillet 2026');
  });

  it('nomme les deux jours les plus récents plutôt que de les dater', () => {
    // Dans un album qu'on vient d'alimenter, « Aujourd'hui » se repère d'un
    // coup d'œil là où deux quantièmes voisins demandent de lire les chiffres.
    assert.equal(dayLabel('2026-08-01', '2026-08-01'), "Aujourd'hui");
    assert.equal(dayLabel('2026-07-31', '2026-08-01'), 'Hier');
    assert.equal(dayLabel('2026-07-30', '2026-08-01'), '30 juillet 2026');
  });

  it('trouve la veille par-dessus un changement de mois et une année bissextile', () => {
    // Un décalage naïf sur le quantième daterait « Hier » au 0 mars.
    assert.equal(dayLabel('2026-07-31', '2026-08-01'), 'Hier');
    assert.equal(dayLabel('2024-02-29', '2024-03-01'), 'Hier');
    assert.equal(dayLabel('2025-12-31', '2026-01-01'), 'Hier');
  });
});

describe('computeLayout, découpage en sections', () => {
  /** Deux photos par jour sur quatre jours à cheval sur deux mois. */
  const acrossMonths = [
    photo('a', '2024-03-30T09:00:00.000Z'),
    photo('b', '2024-03-30T18:00:00.000Z'),
    photo('c', '2024-03-31T09:00:00.000Z'),
    photo('d', '2024-04-01T09:00:00.000Z'),
    photo('e', '2024-04-30T09:00:00.000Z'),
  ];

  it("découpe par mois quand rien n'est demandé", () => {
    // `month` est le défaut partagé : l'omettre ne doit pas changer la grille.
    const implicite = computeLayout(items, OPTIONS);
    const explicite = computeLayout(items, { ...OPTIONS, groupBy: 'month' });
    assert.deepEqual(
      implicite.sections.map((section) => section.key),
      explicite.sections.map((section) => section.key),
    );
  });

  it('produit une section par jour', () => {
    const layout = computeLayout(acrossMonths, { ...OPTIONS, groupBy: 'day' });
    assert.deepEqual(
      layout.sections.map((section) => section.key),
      ['2024-03-30', '2024-03-31', '2024-04-01', '2024-04-30'],
    );
  });

  it('sépare deux photos du même quantième mais de mois différents', () => {
    // Le 30 mars et le 30 avril partagent leur quantième : une clé qui ne
    // porterait que le jour les fusionnerait en une seule section.
    const layout = computeLayout(acrossMonths, { ...OPTIONS, groupBy: 'day' });
    const mars = layout.sections.find((section) => section.key === '2024-03-30')!;
    const avril = layout.sections.find((section) => section.key === '2024-04-30')!;

    assert.equal(mars.rows.flatMap((row) => row.cells).length, 2);
    assert.equal(avril.rows.flatMap((row) => row.cells).length, 1);
  });

  it('réunit dans un même mois des jours que le découpage par jour sépare', () => {
    // La réciproque : trois jours de mars, un seul en-tête « Mars 2024 ».
    const layout = computeLayout(acrossMonths, { ...OPTIONS, groupBy: 'month' });
    assert.deepEqual(
      layout.sections.map((section) => section.key),
      ['2024-03', '2024-04'],
    );
    assert.equal(layout.sections[0]!.rows.flatMap((row) => row.cells).length, 3);
  });

  it('ne fusionne jamais deux photos de jours différents dans la même section', () => {
    const layout = computeLayout(items, { ...OPTIONS, groupBy: 'day' });

    for (const section of layout.sections) {
      for (const cell of section.rows.flatMap((row) => row.cells)) {
        assert.equal(dayKey(cell.item.takenAt), section.key);
      }
    }
  });

  it('découpe par jour dans les deux sens de tri', () => {
    // La grille ne trie rien : le tri ascendant de l'API doit lui suffire tel
    // quel, en-têtes dans l'ordre inverse et sans jour dédoublé.
    const desc = computeLayout(acrossMonths, { ...OPTIONS, groupBy: 'day' });
    const asc = computeLayout([...acrossMonths].reverse(), { ...OPTIONS, groupBy: 'day' });

    assert.deepEqual(
      asc.sections.map((section) => section.key),
      [...desc.sections.map((section) => section.key)].reverse(),
    );
    assert.equal(asc.rows.flatMap((row) => row.cells).length, acrossMonths.length);
  });

  it('place chaque média une fois et une seule par jour aussi', () => {
    const layout = computeLayout(items, { ...OPTIONS, groupBy: 'day' });
    const indexes = layout.rows.flatMap((row) => row.cells.map((cell) => cell.index));

    assert.deepEqual(
      [...indexes].sort((a, b) => a - b),
      items.map((_, index) => index),
    );
  });

  it('empile les sections de jour sans chevauchement', () => {
    // Le découpage par jour multiplie les en-têtes : c'est là qu'une hauteur de
    // section mal calculée ferait se recouvrir deux grilles.
    const layout = computeLayout(items, { ...OPTIONS, groupBy: 'day' });

    for (let index = 1; index < layout.sections.length; index++) {
      const previous = layout.sections[index - 1]!;
      assert.equal(layout.sections[index]!.y, previous.y + previous.height + OPTIONS.sectionGap);
    }
    const last = layout.sections.at(-1)!;
    assert.equal(layout.totalHeight, last.y + last.height);
  });

  it('donne une grille plus haute par jour que par mois', () => {
    // Chaque jour ajoute un en-tête et une dernière ligne non justifiée : la
    // hauteur totale, dont dépend la barre de défilement, doit suivre.
    const parMois = computeLayout(items, { ...OPTIONS, groupBy: 'month' });
    const parJour = computeLayout(items, { ...OPTIONS, groupBy: 'day' });

    assert.equal(parJour.sections.length, 30);
    assert.ok(parJour.totalHeight > parMois.totalHeight);
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
