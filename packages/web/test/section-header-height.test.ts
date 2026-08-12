import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GRID_COLLAPSED_HEADER_HEIGHT,
  GRID_HEADER_HEIGHT,
  GRID_HEADER_LINE_HEIGHT,
  sectionHeaderHeight,
} from '../src/lib/useGridLayout';
import { measureLines } from '../src/lib/measureLines';

describe('height reserved for a section heading', () => {
  it('equals the base when the day has neither place nor note', () => {
    assert.equal(
      sectionHeaderHeight({ collapsed: false, hasPlace: false, descriptionLines: 0 }),
      GRID_HEADER_HEIGHT,
    );
  });

  it('adds one row for the place, which always fits on one line', () => {
    assert.equal(
      sectionHeaderHeight({ collapsed: false, hasPlace: true, descriptionLines: 0 }),
      GRID_HEADER_HEIGHT + GRID_HEADER_LINE_HEIGHT,
    );
  });

  it('reserves exactly the measured rows for the note without padding', () => {
    // This is the invariant of calculation without a DOM: reserved space equals
    // rendered space. Overestimating would leave a gap below the heading, while
    // underestimating would place thumbnails under the text, with no later correction.
    for (const lignes of [1, 2, 3, 5, 7]) {
      assert.equal(
        sectionHeaderHeight({ collapsed: false, hasPlace: false, descriptionLines: lignes }),
        GRID_HEADER_HEIGHT + lignes * GRID_HEADER_LINE_HEIGHT,
      );
    }
  });

  it('combines the place and note', () => {
    assert.equal(
      sectionHeaderHeight({ collapsed: false, hasPlace: true, descriptionLines: 3 }),
      GRID_HEADER_HEIGHT + 4 * GRID_HEADER_LINE_HEIGHT,
    );
  });

  it('when collapsed, loses bottom spacing but keeps its text', () => {
    assert.equal(
      sectionHeaderHeight({ collapsed: true, hasPlace: true, descriptionLines: 2 }),
      GRID_COLLAPSED_HEADER_HEIGHT + 3 * GRID_HEADER_LINE_HEIGHT,
    );
  });
});

describe('line count measurement', () => {
  it('counts no rows for absent text', () => {
    assert.equal(measureLines('', 800, 'text-sm', GRID_HEADER_LINE_HEIGHT), 0);
  });

  it('counts one row rather than zero when there is no DOM to query', () => {
    // A test or server render has no probe to measure. Zero would reserve no
    // height for a paragraph that will occupy one row.
    assert.equal(measureLines('une note', 800, 'text-sm', GRID_HEADER_LINE_HEIGHT), 1);
  });

  it('counts one row until the width is known', () => {
    assert.equal(measureLines('une note', 0, 'text-sm', GRID_HEADER_LINE_HEIGHT), 1);
  });
});
