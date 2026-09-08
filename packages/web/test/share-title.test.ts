import type { ShareView } from '@lukarn/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeTranslate } from '../src/lib/i18n/translate';
import { resolveShareTitle } from '../src/pages/SharePage';

const tEn = makeTranslate('en');
const tFr = makeTranslate('fr');

describe('resolveShareTitle', () => {
  it('returns null when view is undefined', () => {
    assert.equal(resolveShareTitle(undefined, tEn), null);
    assert.equal(resolveShareTitle(undefined, tFr), null);
  });

  it('returns album title for album shares', () => {
    const view: ShareView = {
      kind: 'album',
      title: 'Vacances 2026',
      description: null,
      itemCount: 10,
      coverId: null,
      coverVersion: null,
      groupBy: 'day',
      sortOrder: 'asc',
    };
    assert.equal(resolveShareTitle(view, tEn), 'Vacances 2026');
    assert.equal(resolveShareTitle(view, tFr), 'Vacances 2026');
  });

  it('returns null for single photo shares', () => {
    const view: ShareView = {
      kind: 'media',
      item: { id: 'photo-1' } as unknown as ShareView extends { kind: 'media'; item: infer I }
        ? I
        : never,
    };
    assert.equal(resolveShareTitle(view, tEn), null);
    assert.equal(resolveShareTitle(view, tFr), null);
  });

  it('returns custom trimmed label for multi-photo selections when provided', () => {
    const view: ShareView = {
      kind: 'selection',
      label: '  Summer Trip  ',
      items: [],
      itemCount: 0,
    };
    assert.equal(resolveShareTitle(view, tEn), 'Summer Trip');
    assert.equal(resolveShareTitle(view, tFr), 'Summer Trip');
  });

  it('falls back to localized title when selection label is empty, whitespace, or null', () => {
    const viewNull: ShareView = {
      kind: 'selection',
      label: null,
      items: [],
      itemCount: 0,
    };
    assert.equal(resolveShareTitle(viewNull, tEn), 'Shared photographs');
    assert.equal(resolveShareTitle(viewNull, tFr), 'Photographies partagées');

    const viewEmpty: ShareView = {
      kind: 'selection',
      label: '',
      items: [],
      itemCount: 0,
    };
    assert.equal(resolveShareTitle(viewEmpty, tEn), 'Shared photographs');
    assert.equal(resolveShareTitle(viewEmpty, tFr), 'Photographies partagées');

    const viewWhitespace: ShareView = {
      kind: 'selection',
      label: '   ',
      items: [],
      itemCount: 0,
    };
    assert.equal(resolveShareTitle(viewWhitespace, tEn), 'Shared photographs');
    assert.equal(resolveShareTitle(viewWhitespace, tFr), 'Photographies partagées');
  });
});
