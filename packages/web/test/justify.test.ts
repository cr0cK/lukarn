import type { MediaItem } from '@nonni/shared';
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
    hasPreview: true,
    size: 1000,
    width,
    height,
    takenAt,
    takenAtFromExif: true,
    durationMs: null,
    videoCodec: null,
    description: null,
    version: null,
  };
}

/** 30 photos spread across three consecutive months. */
const items = Array.from({ length: 30 }, (_, index) => {
  const month = String(3 + Math.floor(index / 10)).padStart(2, '0');
  const day = String((index % 10) + 1).padStart(2, '0');
  return photo(`p${index}`, `2024-${month}-${day}T10:00:00.000Z`);
});

describe('computeLayout', () => {
  it('returns nothing without a measured width', () => {
    const layout = computeLayout(items, { ...OPTIONS, containerWidth: 0 });
    assert.equal(layout.totalHeight, 0);
    assert.deepEqual(layout.sections, []);
  });

  it('returns nothing without media', () => {
    const layout = computeLayout([], OPTIONS);
    assert.equal(layout.totalHeight, 0);
  });

  it('groups by month in received order', () => {
    const layout = computeLayout(items, OPTIONS);
    assert.deepEqual(
      layout.sections.map((section) => section.key),
      ['2024-03', '2024-04', '2024-05'],
    );
  });

  it('also segments an album served from oldest to newest', () => {
    // The grid sorts nothing: it splits the received sequence into consecutive
    // months. The API's ascending order must therefore work as is, with headings
    // in reverse order and no duplicated month.
    const layout = computeLayout([...items].reverse(), OPTIONS);

    assert.deepEqual(
      layout.sections.map((section) => section.key),
      ['2024-05', '2024-04', '2024-03'],
    );
    assert.equal(layout.rows.flatMap((row) => row.cells).length, items.length);
  });

  it('places every media item exactly once', () => {
    const layout = computeLayout(items, OPTIONS);
    const indexes = layout.rows.flatMap((row) => row.cells.map((cell) => cell.index));

    assert.equal(indexes.length, items.length);
    assert.deepEqual(
      [...indexes].sort((a, b) => a - b),
      items.map((_, index) => index),
    );
  });

  it('fills the width exactly on justified rows', () => {
    const layout = computeLayout(items, OPTIONS);

    for (const section of layout.sections) {
      // The last row of a section is deliberately not justified.
      for (const row of section.rows.slice(0, -1)) {
        const last = row.cells.at(-1)!;
        assert.equal(
          last.x + last.width,
          OPTIONS.containerWidth,
          'a justified row must end exactly at the right edge',
        );
      }
    }
  });

  it('does not stretch the last row of a section', () => {
    // Two photos alone cannot fill 1200 px without becoming enormous.
    const layout = computeLayout(
      [photo('a', '2024-03-01T10:00:00.000Z'), photo('b', '2024-03-02T10:00:00.000Z')],
      OPTIONS,
    );
    const row = layout.rows[0]!;

    assert.equal(row.height, OPTIONS.targetRowHeight);
    assert.ok(row.cells.at(-1)!.x + row.cells.at(-1)!.width < OPTIONS.containerWidth);
  });

  it('preserves the proportions of every image', () => {
    const layout = computeLayout(
      [
        photo('paysage', '2024-03-01T10:00:00.000Z', 3000, 2000),
        photo('portrait', '2024-03-02T10:00:00.000Z', 2000, 3000),
      ],
      OPTIONS,
    );

    const [paysage, portrait] = layout.rows[0]!.cells;
    assert.ok(paysage!.width > portrait!.width, 'landscape must be wider than portrait');
    assert.ok(Math.abs(paysage!.width / paysage!.height - 1.5) < 0.05);
  });

  it('gives media without dimensions a fallback aspect ratio', () => {
    const orphan: MediaItem = {
      ...photo('x', '2024-03-01T10:00:00.000Z'),
      width: null,
      height: null,
    };
    const layout = computeLayout([orphan], OPTIONS);
    const cell = layout.rows[0]!.cells[0]!;

    assert.ok(cell.width > 0 && cell.height > 0);
  });

  it('bounds extremely panoramic images', () => {
    // Without a bound, a 20:1 panorama would flatten its entire row.
    const panorama = photo('pano', '2024-03-01T10:00:00.000Z', 20000, 1000);
    const layout = computeLayout([panorama], OPTIONS);
    const cell = layout.rows[0]!.cells[0]!;

    assert.ok(cell.width / cell.height <= 3.6);
  });

  it('stacks sections without overlap', () => {
    const layout = computeLayout(items, OPTIONS);

    for (let index = 1; index < layout.sections.length; index++) {
      const previous = layout.sections[index - 1]!;
      const current = layout.sections[index]!;
      assert.equal(current.y, previous.y + previous.height + OPTIONS.sectionGap);
    }

    const last = layout.sections.at(-1)!;
    assert.equal(layout.totalHeight, last.y + last.height);
  });

  it('produces shorter rows when the window narrows', () => {
    const large = computeLayout(items, OPTIONS);
    const small = computeLayout(items, { ...OPTIONS, containerWidth: 480 });

    assert.ok(small.totalHeight > large.totalHeight);
    assert.ok(small.rows.length > large.rows.length);
  });
});

describe('grouping by month', () => {
  it('extracts the YYYY-MM key', () => {
    assert.equal(monthKey('2024-07-14T18:32:10.000Z'), '2024-07');
  });

  it('returns a readable label with an initial capital', () => {
    assert.equal(monthLabel('2024-07'), 'July 2024');
  });
});

describe('grouping by day', () => {
  it('extracts the YYYY-MM-DD key', () => {
    assert.equal(dayKey('2024-07-14T18:32:10.000Z'), '2024-07-14');
  });

  it('does not change day for a late-evening photo', () => {
    // The time-zone trap: read in Europe/Paris, a photo taken at 23:30 on the
    // 14th would fall on the 15th. Because `taken_at` is device time, it must
    // remain on the 14th regardless of the browser's time zone.
    assert.equal(dayKey('2024-07-14T23:30:00.000Z'), '2024-07-14');
    assert.equal(dayKey('2024-07-15T00:30:00.000Z'), '2024-07-15');
  });

  it('returns a readable date rather than the technical key', () => {
    assert.equal(dayLabel('2026-07-14', '2026-08-01'), '14 July 2026');
  });

  it('names the two most recent days instead of dating them', () => {
    // In a newly updated album, "Today" is recognisable at a glance whereas two
    // neighbouring day numbers require reading the digits.
    assert.equal(dayLabel('2026-08-01', '2026-08-01'), 'Today');
    assert.equal(dayLabel('2026-07-31', '2026-08-01'), 'Yesterday');
    assert.equal(dayLabel('2026-07-30', '2026-08-01'), '30 July 2026');
  });

  it('finds yesterday across a month boundary and a leap year', () => {
    // Naively decrementing the day number would date "Yesterday" as 0 March.
    assert.equal(dayLabel('2026-07-31', '2026-08-01'), 'Yesterday');
    assert.equal(dayLabel('2024-02-29', '2024-03-01'), 'Yesterday');
    assert.equal(dayLabel('2025-12-31', '2026-01-01'), 'Yesterday');
  });
});

describe('computeLayout section splitting', () => {
  /** Two photos per day over four days spanning two months. */
  const acrossMonths = [
    photo('a', '2024-03-30T09:00:00.000Z'),
    photo('b', '2024-03-30T18:00:00.000Z'),
    photo('c', '2024-03-31T09:00:00.000Z'),
    photo('d', '2024-04-01T09:00:00.000Z'),
    photo('e', '2024-04-30T09:00:00.000Z'),
  ];

  it('splits by month when nothing is requested', () => {
    // `month` is the shared default, so omitting it must not change the grid.
    const implicite = computeLayout(items, OPTIONS);
    const explicite = computeLayout(items, { ...OPTIONS, groupBy: 'month' });
    assert.deepEqual(
      implicite.sections.map((section) => section.key),
      explicite.sections.map((section) => section.key),
    );
  });

  it('produces one section per day', () => {
    const layout = computeLayout(acrossMonths, { ...OPTIONS, groupBy: 'day' });
    assert.deepEqual(
      layout.sections.map((section) => section.key),
      ['2024-03-30', '2024-03-31', '2024-04-01', '2024-04-30'],
    );
  });

  it('separates two photos with the same day number in different months', () => {
    // 30 March and 30 April share their day number: a key containing only the
    // day would merge them into one section.
    const layout = computeLayout(acrossMonths, { ...OPTIONS, groupBy: 'day' });
    const mars = layout.sections.find((section) => section.key === '2024-03-30')!;
    const avril = layout.sections.find((section) => section.key === '2024-04-30')!;

    assert.equal(mars.rows.flatMap((row) => row.cells).length, 2);
    assert.equal(avril.rows.flatMap((row) => row.cells).length, 1);
  });

  it('combines days into one month when day splitting separates them', () => {
    // The converse: three March days under a single "March 2024" heading.
    const layout = computeLayout(acrossMonths, { ...OPTIONS, groupBy: 'month' });
    assert.deepEqual(
      layout.sections.map((section) => section.key),
      ['2024-03', '2024-04'],
    );
    assert.equal(layout.sections[0]!.rows.flatMap((row) => row.cells).length, 3);
  });

  it('never merges photos from different days into one section', () => {
    const layout = computeLayout(items, { ...OPTIONS, groupBy: 'day' });

    for (const section of layout.sections) {
      for (const cell of section.rows.flatMap((row) => row.cells)) {
        assert.equal(dayKey(cell.item.takenAt), section.key);
      }
    }
  });

  it('splits by day in both sort directions', () => {
    // The grid sorts nothing: the API's ascending order must work as is, with
    // headings in reverse order and no duplicated day.
    const desc = computeLayout(acrossMonths, { ...OPTIONS, groupBy: 'day' });
    const asc = computeLayout([...acrossMonths].reverse(), { ...OPTIONS, groupBy: 'day' });

    assert.deepEqual(
      asc.sections.map((section) => section.key),
      [...desc.sections.map((section) => section.key)].reverse(),
    );
    assert.equal(asc.rows.flatMap((row) => row.cells).length, acrossMonths.length);
  });

  it('also places every media item exactly once when grouping by day', () => {
    const layout = computeLayout(items, { ...OPTIONS, groupBy: 'day' });
    const indexes = layout.rows.flatMap((row) => row.cells.map((cell) => cell.index));

    assert.deepEqual(
      [...indexes].sort((a, b) => a - b),
      items.map((_, index) => index),
    );
  });

  it('stacks day sections without overlap', () => {
    // Splitting by day multiplies headings: this is where a miscalculated
    // section height would make two grids overlap.
    const layout = computeLayout(items, { ...OPTIONS, groupBy: 'day' });

    for (let index = 1; index < layout.sections.length; index++) {
      const previous = layout.sections[index - 1]!;
      assert.equal(layout.sections[index]!.y, previous.y + previous.height + OPTIONS.sectionGap);
    }
    const last = layout.sections.at(-1)!;
    assert.equal(layout.totalHeight, last.y + last.height);
  });

  it('produces a taller grid by day than by month', () => {
    // Every day adds a heading and an unjustified final row: the total height,
    // which controls the scrollbar, must follow.
    const parMois = computeLayout(items, { ...OPTIONS, groupBy: 'month' });
    const parJour = computeLayout(items, { ...OPTIONS, groupBy: 'day' });

    assert.equal(parJour.sections.length, 30);
    assert.ok(parJour.totalHeight > parMois.totalHeight);
  });
});

describe('variable heading height', () => {
  /** Six photos spread across three consecutive days. */
  const troisJours = Array.from({ length: 6 }, (_, index) =>
    photo(`j${index}`, `2024-03-0${Math.floor(index / 2) + 1}T10:00:00.000Z`),
  );

  it('shifts later sections by the heading height increase', () => {
    // This invariant supports the entire feature: height is an input to the
    // calculation, never a measurement. If the offset did not follow, the note
    // would sit beneath photos in its own section.
    const base = computeLayout(troisJours, { ...OPTIONS, groupBy: 'day' });
    const grandi = computeLayout(troisJours, {
      ...OPTIONS,
      groupBy: 'day',
      headerHeightFor: (key) => (key === '2024-03-01' ? OPTIONS.headerHeight + 60 : 0),
    });

    assert.equal(grandi.sections[0]!.headerHeight, OPTIONS.headerHeight + 60);
    assert.equal(grandi.sections[1]!.headerHeight, OPTIONS.headerHeight);
    assert.equal(grandi.sections[0]!.height, base.sections[0]!.height + 60);
    assert.equal(grandi.sections[1]!.y, base.sections[1]!.y + 60);
    assert.equal(grandi.totalHeight, base.totalHeight + 60);
  });

  it('moves the section rows down, not just its heading', () => {
    const grandi = computeLayout(troisJours, {
      ...OPTIONS,
      groupBy: 'day',
      headerHeightFor: () => OPTIONS.headerHeight + 60,
    });

    for (const section of grandi.sections) {
      assert.equal(section.rows[0]!.y, section.y + section.headerHeight);
    }
  });

  it('falls back to base height when the function is absent or returns zero', () => {
    const sans = computeLayout(troisJours, { ...OPTIONS, groupBy: 'day' });
    const nul = computeLayout(troisJours, {
      ...OPTIONS,
      groupBy: 'day',
      headerHeightFor: () => 0,
    });

    assert.equal(sans.sections[0]!.headerHeight, OPTIONS.headerHeight);
    assert.equal(nul.totalHeight, sans.totalHeight);
  });
});

describe('collapsed sections', () => {
  /** Six photos spread across three consecutive days. */
  const troisJours = Array.from({ length: 6 }, (_, index) =>
    photo(`j${index}`, `2024-03-0${Math.floor(index / 2) + 1}T10:00:00.000Z`),
  );
  const parJour = { ...OPTIONS, groupBy: 'day' as const };

  it('reduces the section to its heading height without subtracting a gap', () => {
    const layout = computeLayout(troisJours, {
      ...parJour,
      isCollapsed: (key) => key === '2024-03-01',
    });

    assert.equal(layout.sections[0]!.height, layout.sections[0]!.headerHeight);
    assert.deepEqual(layout.sections[0]!.rows, []);
  });

  it('moves later sections up by the space released by collapsing', () => {
    const base = computeLayout(troisJours, parJour);
    const replie = computeLayout(troisJours, {
      ...parJour,
      isCollapsed: (key) => key === '2024-03-01',
    });

    const libere = base.sections[0]!.height - base.sections[0]!.headerHeight;
    assert.ok(libere > 0);
    assert.equal(replie.sections[1]!.y, base.sections[1]!.y - libere);
    assert.equal(replie.totalHeight, base.totalHeight - libere);
  });

  it('removes collapsed cells from every layout row', () => {
    // Keyboard navigation depends on this invariant: it moves through
    // `layout.rows` and has no other way to know that a thumbnail is hidden.
    const layout = computeLayout(troisJours, {
      ...parJour,
      isCollapsed: (key) => key === '2024-03-01',
    });

    const places = layout.rows.flatMap((row) => row.cells).map((cell) => cell.item.id);
    assert.deepEqual(places, ['j2', 'j3', 'j4', 'j5']);
  });

  it('keeps the section count as the only sign of what it hides', () => {
    const layout = computeLayout(troisJours, { ...parJour, isCollapsed: () => true });

    assert.deepEqual(
      layout.sections.map((section) => section.count),
      [2, 2, 2],
    );
    assert.deepEqual(layout.rows, []);
  });

  it('stacks three collapsed headings without overlap', () => {
    const layout = computeLayout(troisJours, { ...parJour, isCollapsed: () => true });

    layout.sections.forEach((section, position) => {
      assert.equal(section.collapsed, true);
      const precedente = layout.sections[position - 1];
      if (precedente) assert.ok(section.y >= precedente.y + precedente.height);
    });
  });

  it('leaves the layout intact when the function is absent', () => {
    const layout = computeLayout(troisJours, parJour);

    assert.equal(layout.sections[0]!.collapsed, false);
    assert.equal(layout.sections[0]!.count, 2);
  });
});

describe('targetRowHeightFor', () => {
  it('grows with the available width', () => {
    const widths = [400, 600, 1000, 1600, 2400];
    const heights = widths.map(targetRowHeightFor);
    assert.deepEqual(
      heights,
      [...heights].sort((a, b) => a - b),
    );
  });
});
