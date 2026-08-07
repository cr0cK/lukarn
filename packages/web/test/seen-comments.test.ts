import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { unreadCount } from '../src/lib/seenComments';

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
