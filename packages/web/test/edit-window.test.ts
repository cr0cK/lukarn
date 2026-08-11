import { COMMENT_EDIT_WINDOW_MS, remainingEditMs } from '@nonni/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Fenêtre de correction d'un commentaire.
 *
 * Le calcul est partagé entre le serveur, qui refuse, et le front, qui cesse de
 * proposer. Deux implémentations séparées finiraient par diverger d'une seconde,
 * et c'est exactement l'écart où l'on clique sur un bouton qui répond non.
 */

const PUBLIE = '2026-08-07T12:00:00.000Z';
const publieA = Date.parse(PUBLIE);

describe('délai de correction restant', () => {
  it('laisse la fenêtre entière à la publication', () => {
    assert.equal(remainingEditMs(PUBLIE, publieA), COMMENT_EDIT_WINDOW_MS);
  });

  it('décompte le temps écoulé', () => {
    assert.equal(remainingEditMs(PUBLIE, publieA + 10_000), COMMENT_EDIT_WINDOW_MS - 10_000);
  });

  it('se ferme pile à l’échéance', () => {
    // La borne est fermée du côté du refus : à l'instant exact, il n'y a plus
    // rien à proposer, sinon le front afficherait « Modifier (0 s) ».
    assert.equal(remainingEditMs(PUBLIE, publieA + COMMENT_EDIT_WINDOW_MS), 0);
  });

  it('ne rend jamais de valeur négative', () => {
    // Sans ce plancher, le front afficherait un décompte à rebours dans le
    // passé sur tout commentaire ancien.
    assert.equal(remainingEditMs(PUBLIE, publieA + 3_600_000), 0);
  });

  it('ferme la fenêtre sur une date illisible', () => {
    // Une date que le serveur n'aurait pas su écrire ne doit pas ouvrir un droit
    // d'écriture : en cas de doute, on refuse.
    assert.equal(remainingEditMs('pas une date', publieA), 0);
  });

  it('tolère une horloge en retard sans dépasser la fenêtre', () => {
    // Décalage entre le navigateur et le serveur : le décompte peut être trop
    // généreux d'une poignée de secondes, jamais illimité — et c'est le serveur
    // qui tranche au bout du compte.
    const restant = remainingEditMs(PUBLIE, publieA - 5_000);
    assert.ok(restant > COMMENT_EDIT_WINDOW_MS);
    assert.equal(restant, COMMENT_EDIT_WINDOW_MS + 5_000);
  });
});
