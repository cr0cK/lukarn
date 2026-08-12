import type { AdminComment } from '@lukarn/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { groupByDayAndPhoto, type DayGroup } from '../src/lib/commentGroups';
import { makeTranslate } from '../src/lib/i18n/translate';

/**
 * Grouping a comment list by day and then by photo, for both the moderation
 * queue and the activity drawer.
 *
 * Two invariants underpin everything: nothing is lost or duplicated when a
 * flat list becomes two levels of groups, and the reverse chronological order
 * returned by the server survives grouping.
 *
 * Cases use `AdminComment`, the richer of the two: the fields that distinguish
 * them — author address and hidden state — do not affect grouping, which reads
 * only the album, photo and date.
 */

let prochain = 1;

function commentaire(createdAt: string, overrides: Partial<AdminComment> = {}): AdminComment {
  const id = prochain++;
  return {
    id,
    parentId: null,
    author: { displayName: 'Mamie' },
    body: `Message ${id}`,
    createdAt,
    canDelete: true,
    canEdit: false,
    albumId: 'vacances',
    albumTitle: 'Vacances',
    mediaId: 'plage',
    mediaName: 'plage.jpg',
    authorEmail: 'mamie@exemple.fr',
    commenterId: 1,
    account: 'famille',
    hiddenAt: null,
    hiddenBy: null,
    ...overrides,
  };
}

/** All result comments flattened in display order. */
function aplati(groupes: DayGroup<AdminComment>[]): AdminComment[] {
  return groupes.flatMap((jour) => jour.photos.flatMap((photo) => photo.comments));
}

/**
 * The English catalogue, read without a provider: these functions produce text,
 * and a test that stubbed the translation would check its own stub.
 */
const t = makeTranslate('en');

describe('moderation queue grouping', () => {
  it('neither loses nor duplicates any comment', () => {
    const entree = [
      commentaire('2026-08-07T10:00:00.000Z'),
      commentaire('2026-08-07T09:00:00.000Z', { mediaId: 'phare', mediaName: 'phare.jpg' }),
      commentaire('2026-08-06T22:00:00.000Z'),
      commentaire('2026-08-06T08:00:00.000Z', { albumId: 'corse', albumTitle: 'Corse' }),
    ];

    const sortie = aplati(groupByDayAndPhoto(entree, t));

    assert.equal(sortie.length, entree.length);
    assert.deepEqual(
      new Set(sortie.map((comment) => comment.id)),
      new Set(entree.map((comment) => comment.id)),
    );
  });

  it('groups comments on the same photo under one heading', () => {
    const groupes = groupByDayAndPhoto(
      [
        commentaire('2026-08-07T12:00:00.000Z'),
        commentaire('2026-08-07T11:00:00.000Z', { mediaId: 'phare', mediaName: 'phare.jpg' }),
        commentaire('2026-08-07T10:00:00.000Z'),
      ],
      t,
    );

    assert.equal(groupes.length, 1, 'expected a single day');
    const [plage, phare] = groupes[0]!.photos;
    // The photo appears where its first comment placed it, and its other
    // messages join it there rather than opening a second block.
    assert.equal(groupes[0]!.photos.length, 2);
    assert.equal(plage!.mediaId, 'plage');
    assert.equal(plage!.comments.length, 2);
    assert.equal(phare!.mediaId, 'phare');
  });

  it('does not mix the same file indexed under two albums', () => {
    // The same media in two albums means two separate conversations (D12), and
    // therefore two blocks — combining them would expose what was said in an
    // isolated album.
    const groupes = groupByDayAndPhoto(
      [
        commentaire('2026-08-07T12:00:00.000Z', { albumId: 'vacances', albumTitle: 'Vacances' }),
        commentaire('2026-08-07T11:00:00.000Z', { albumId: 'corse', albumTitle: 'Corse' }),
      ],
      t,
    );

    assert.equal(groupes[0]!.photos.length, 2);
  });

  it('preserves input order from days through to comments', () => {
    const entree = [
      commentaire('2026-08-07T12:00:00.000Z'),
      commentaire('2026-08-07T09:00:00.000Z'),
      commentaire('2026-08-05T18:00:00.000Z'),
    ];

    const sortie = aplati(groupByDayAndPhoto(entree, t));

    assert.deepEqual(
      sortie.map((comment) => comment.id),
      entree.map((comment) => comment.id),
    );
  });

  it('groups a comment under its local day rather than the previous UTC day', () => {
    // 23:30 in Paris in August is 21:30 UTC, so the UTC and local keys fall on
    // the same day. The important case is the reverse — a message written after
    // local midnight while UTC is still on the previous day.
    const local = new Date(2026, 7, 7, 0, 30);
    const veilleUtc = new Date(2026, 7, 6, 23, 30);

    const groupes = groupByDayAndPhoto(
      [commentaire(local.toISOString()), commentaire(veilleUtc.toISOString())],
      t,
    );

    // Two distinct local days, regardless of UTC's position.
    assert.equal(groupes.length, 2);
    assert.equal(groupes[0]!.key, '2026-08-07');
    assert.equal(groupes[1]!.key, '2026-08-06');
  });
});
