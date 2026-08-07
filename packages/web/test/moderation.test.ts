import type { AdminComment } from '@gdv/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { groupForModeration } from '../src/lib/moderation';

/**
 * Rangement de la file de modération.
 *
 * Deux invariants portent tout : rien ne se perd ni ne se duplique en passant
 * d'une liste plate à deux niveaux de groupes, et l'ordre antéchronologique
 * rendu par le serveur survit au rangement.
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

/** Tous les commentaires du résultat, à plat, dans l'ordre où ils s'affichent. */
function aplati(groupes: ReturnType<typeof groupForModeration>): AdminComment[] {
  return groupes.flatMap((jour) => jour.photos.flatMap((photo) => photo.comments));
}

describe('rangement de la file de modération', () => {
  it('ne perd ni ne duplique aucun commentaire', () => {
    const entree = [
      commentaire('2026-08-07T10:00:00.000Z'),
      commentaire('2026-08-07T09:00:00.000Z', { mediaId: 'phare', mediaName: 'phare.jpg' }),
      commentaire('2026-08-06T22:00:00.000Z'),
      commentaire('2026-08-06T08:00:00.000Z', { albumId: 'corse', albumTitle: 'Corse' }),
    ];

    const sortie = aplati(groupForModeration(entree));

    assert.equal(sortie.length, entree.length);
    assert.deepEqual(
      new Set(sortie.map((comment) => comment.id)),
      new Set(entree.map((comment) => comment.id)),
    );
  });

  it('regroupe les commentaires d’une même photo sous un seul en-tête', () => {
    const groupes = groupForModeration([
      commentaire('2026-08-07T12:00:00.000Z'),
      commentaire('2026-08-07T11:00:00.000Z', { mediaId: 'phare', mediaName: 'phare.jpg' }),
      commentaire('2026-08-07T10:00:00.000Z'),
    ]);

    assert.equal(groupes.length, 1, 'une seule journée attendue');
    const [plage, phare] = groupes[0]!.photos;
    // La photo apparaît là où son premier commentaire l'a placée, et ses autres
    // messages l'y rejoignent — ils ne rouvrent pas un second bloc.
    assert.equal(groupes[0]!.photos.length, 2);
    assert.equal(plage!.mediaId, 'plage');
    assert.equal(plage!.comments.length, 2);
    assert.equal(phare!.mediaId, 'phare');
  });

  it('ne mélange pas le même fichier indexé sous deux albums', () => {
    // Même média, deux albums : deux conversations séparées (D12), donc deux
    // blocs — les réunir montrerait ce qui s'est dit dans un album cloisonné.
    const groupes = groupForModeration([
      commentaire('2026-08-07T12:00:00.000Z', { albumId: 'vacances', albumTitle: 'Vacances' }),
      commentaire('2026-08-07T11:00:00.000Z', { albumId: 'corse', albumTitle: 'Corse' }),
    ]);

    assert.equal(groupes[0]!.photos.length, 2);
  });

  it('préserve l’ordre d’entrée, des journées jusqu’aux commentaires', () => {
    const entree = [
      commentaire('2026-08-07T12:00:00.000Z'),
      commentaire('2026-08-07T09:00:00.000Z'),
      commentaire('2026-08-05T18:00:00.000Z'),
    ];

    const sortie = aplati(groupForModeration(entree));

    assert.deepEqual(
      sortie.map((comment) => comment.id),
      entree.map((comment) => comment.id),
    );
  });

  it('range un commentaire dans sa journée locale, pas dans la veille UTC', () => {
    // 23 h 30 à Paris en août, c'est 21 h 30 UTC : la clé UTC et la clé locale
    // tombent le même jour. Le cas qui compte est l'inverse — un message écrit
    // après minuit heure locale mais encore la veille en UTC.
    const local = new Date(2026, 7, 7, 0, 30);
    const veilleUtc = new Date(2026, 7, 6, 23, 30);

    const groupes = groupForModeration([
      commentaire(local.toISOString()),
      commentaire(veilleUtc.toISOString()),
    ]);

    // Deux journées locales distinctes, quelle que soit la position d'UTC.
    assert.equal(groupes.length, 2);
    assert.equal(groupes[0]!.key, '2026-08-07');
    assert.equal(groupes[1]!.key, '2026-08-06');
  });
});
