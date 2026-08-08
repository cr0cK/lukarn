import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { unreadCount, unreadFeedCount } from '../src/lib/seenComments';

/**
 * Non-lus de la pastille.
 *
 * Le calcul est une soustraction, mais ses bords comptent : la pastille est le
 * seul endroit qui réclame de l'attention, et un chiffre faux y est bien pire
 * qu'un chiffre absent — soit on ouvre pour rien, soit on passe à côté d'un
 * message.
 */

describe('commentaires non lus', () => {
  it('compte l’écart avec ce qui a été lu', () => {
    assert.equal(unreadCount(5, 2), 3);
  });

  it('considère tout comme non lu sans repère', () => {
    // Premier passage, ou navigateur qui refuse le stockage : la pastille
    // annonce le fil entier plutôt que de le taire.
    assert.equal(unreadCount(4, undefined), 4);
  });

  it('ne descend pas sous zéro', () => {
    // Une suppression ou un masquage fait retomber le total sous le repère. Un
    // « -2 » s'afficherait tel quel.
    assert.equal(unreadCount(1, 3), 0);
  });

  it('ne signale rien sur un fil déjà lu en entier', () => {
    assert.equal(unreadCount(3, 3), 0);
  });

  it('ne signale rien sur une photo sans commentaire', () => {
    assert.equal(unreadCount(0, undefined), 0);
  });
});

/**
 * Non-lus du fil d'activité.
 *
 * Le repère y est un identifiant et non un compte : ce qui a été supprimé
 * depuis le dernier passage ne doit pas se faire passer pour du nouveau, et un
 * message ancien qui remonterait dans la page ne doit pas rallumer la pastille.
 */
describe('non-lus du fil d’activité', () => {
  it('ne compte que ce qui dépasse le repère', () => {
    assert.equal(unreadFeedCount([12, 11, 10, 9], 10), 2);
  });

  it('considère tout comme non lu sans repère', () => {
    assert.equal(unreadFeedCount([3, 2, 1], 0), 3);
  });

  it('ne signale rien quand la suppression a vidé le haut du fil', () => {
    // Le repère est à 20, les messages restants sont plus anciens : rien n'est
    // arrivé depuis, même si le fil a changé de contenu.
    assert.equal(unreadFeedCount([8, 7], 20), 0);
  });

  it('ne signale rien sur un fil vide', () => {
    assert.equal(unreadFeedCount([], 0), 0);
  });
});
