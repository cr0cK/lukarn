import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COMMIT_FRACTION,
  EDGE_RESISTANCE,
  FLICK_VELOCITY,
  decideSwipe,
  resistAtEdge,
  settleDuration,
} from '../src/lib/swipeTrack';

/**
 * Ce que devient un balayage une fois le doigt levé.
 *
 * Les seuils sont le cœur du geste : trop haut, il faut traverser l'écran pour
 * changer de photo ; trop bas, un défilement oblique fait sauter une image. Ces
 * tests portent sur les invariants du geste, pas sur les valeurs.
 */

/** Largeur type d'un téléphone en portrait. */
const WIDTH = 390;

describe('décision du balayage', () => {
  it("bascule sur la voisine dès qu'on a traversé la fraction attendue", () => {
    const dx = -(WIDTH * COMMIT_FRACTION + 1);
    const towards = decideSwipe({ dx, velocity: 0, width: WIDTH, canPrev: true, canNext: true });
    assert.equal(towards, 1);
  });

  it('rend son sens au geste : vers la droite, on revient en arrière', () => {
    const dx = WIDTH * COMMIT_FRACTION + 1;
    const towards = decideSwipe({ dx, velocity: 0, width: WIDTH, canPrev: true, canNext: true });
    assert.equal(towards, -1);
  });

  it("revient en place quand le doigt n'a pas assez avancé", () => {
    const dx = -(WIDTH * COMMIT_FRACTION - 1);
    const towards = decideSwipe({ dx, velocity: 0, width: WIDTH, canPrev: true, canNext: true });
    assert.equal(towards, 0);
  });

  it('accepte un lancer sec, qui ne parcourt pourtant presque rien', () => {
    // Le geste du pouce sur un téléphone : vif, court, et sans regarder. Le
    // refuser condamnerait le balayage à un glissement appliqué de bout en bout.
    const towards = decideSwipe({
      dx: -30,
      velocity: -(FLICK_VELOCITY + 0.1),
      width: WIDTH,
      canPrev: true,
      canNext: true,
    });
    assert.equal(towards, 1);
  });

  it('ignore une vitesse contraire au déplacement', () => {
    // Doigt parti à gauche puis revenu sur ses pas au dernier moment : c'est une
    // annulation, et la lire comme un lancer validerait exactement le contraire
    // de ce qui vient d'être fait.
    const towards = decideSwipe({
      dx: -30,
      velocity: FLICK_VELOCITY + 0.5,
      width: WIDTH,
      canPrev: true,
      canNext: true,
    });
    assert.equal(towards, 0);
  });

  it('ne prend pas un tremblement pour un lancer', () => {
    const towards = decideSwipe({
      dx: -4,
      velocity: -2,
      width: WIDTH,
      canPrev: true,
      canNext: true,
    });
    assert.equal(towards, 0);
  });

  it("ne sort jamais de l'album, quelle que soit l'ampleur du geste", () => {
    for (const velocity of [0, -3, 3]) {
      assert.equal(
        decideSwipe({ dx: -WIDTH, velocity, width: WIDTH, canPrev: true, canNext: false }),
        0,
        'pas de photo après la dernière',
      );
      assert.equal(
        decideSwipe({ dx: WIDTH, velocity, width: WIDTH, canPrev: false, canNext: true }),
        0,
        'pas de photo avant la première',
      );
    }
  });

  it('ne bascule sur rien quand le doigt est resté immobile', () => {
    const towards = decideSwipe({ dx: 0, velocity: 0, width: WIDTH, canPrev: true, canNext: true });
    assert.equal(towards, 0);
  });
});

describe('résistance aux extrémités', () => {
  it("laisse le rail suivre le doigt tant qu'il y a une photo de ce côté", () => {
    assert.equal(resistAtEdge(-120, true, true), -120);
    assert.equal(resistAtEdge(120, true, true), 120);
  });

  it('freine sans bloquer au premier et au dernier média', () => {
    // Le geste reste reçu — le bord se sent — mais il n'emmène nulle part.
    assert.equal(resistAtEdge(120, false, true), 120 * EDGE_RESISTANCE);
    assert.equal(resistAtEdge(-120, true, false), -120 * EDGE_RESISTANCE);
  });

  it('ne freine que le côté qui manque', () => {
    assert.equal(resistAtEdge(-120, false, true), -120);
    assert.equal(resistAtEdge(120, true, false), 120);
  });
});

describe('durée de la remise en place', () => {
  it('prolonge le geste plutôt que de lui substituer une durée fixe', () => {
    // À distance égale, un doigt lancé doit voir le rail finir plus vite.
    const lent = settleDuration(300, 0.2);
    const vif = settleDuration(300, 2);
    assert.ok(vif < lent, `${vif} devrait être plus court que ${lent}`);
  });

  it('reste dans des bornes tenables, même à vitesse extrême', () => {
    for (const velocity of [0, 0.01, 1, 50]) {
      for (const distance of [0, 40, 400, 4000]) {
        const duration = settleDuration(distance, velocity);
        assert.ok(duration >= 160 && duration <= 320, `durée hors bornes : ${duration}`);
      }
    }
  });

  it('ignore le signe du déplacement restant', () => {
    assert.equal(settleDuration(-250, 0.8), settleDuration(250, 0.8));
  });
});
