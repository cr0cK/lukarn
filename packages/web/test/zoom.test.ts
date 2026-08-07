import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeZoomScale,
  HD_MAX_EDGE,
  isTap,
  offsetForCenter,
  TAP_SLOP_PX,
  viewCenter,
  visibleFraction,
  zoomPercent,
} from '../src/lib/zoom';

const MAX_SCALE = 8;

/** Cadre de 1200 px de large, le cas courant d'une visionneuse sur portable. */
function scaleFor(overrides: Partial<Parameters<typeof computeZoomScale>[0]> = {}) {
  return computeZoomScale({
    sourceWidth: 6000,
    sourceHeight: 4000,
    renderedWidth: 0,
    hdLoaded: false,
    displayedWidth: 1200,
    maxScale: MAX_SCALE,
    ...overrides,
  });
}

describe('computeZoomScale', () => {
  it('plafonne la résolution disponible à celle du rendu hd, pas à celle du fichier', () => {
    // Le défaut corrigé : 6000 / 1200 donnerait 5, une échelle à laquelle il
    // faudrait peindre 6000 pixels avec les 4096 que le serveur a produits.
    const { availableWidth, pixelScale, limited } = scaleFor();
    assert.equal(availableWidth, HD_MAX_EDGE);
    assert.equal(pixelScale, HD_MAX_EDGE / 1200);
    assert.equal(limited, true);
  });

  it('applique le plafond au plus grand côté, pas à la largeur', () => {
    // Portrait 4000 × 6000 : c'est la hauteur qui touche le plafond, la largeur
    // disponible tombe donc à 2731 et non à 4000.
    const { availableWidth, limited } = scaleFor({ sourceWidth: 4000, sourceHeight: 6000 });
    assert.equal(availableWidth, Math.round((4000 * HD_MAX_EDGE) / 6000));
    assert.equal(limited, true);
  });

  it("n'annonce aucune limite quand le fichier tient sous le plafond", () => {
    const { availableWidth, pixelScale, limited } = scaleFor({
      sourceWidth: 3000,
      sourceHeight: 2000,
    });
    assert.equal(availableWidth, 3000);
    assert.equal(pixelScale, 3000 / 1200);
    assert.equal(limited, false);
  });

  it('préfère la mesure du rendu hd à toute estimation', () => {
    // Si le serveur changeait son plafond, la mesure reprend la main : c'est ce
    // qui empêche la constante mirroir de mentir durablement.
    const { availableWidth, pixelScale } = scaleFor({ hdLoaded: true, renderedWidth: 3000 });
    assert.equal(availableWidth, 3000);
    assert.equal(pixelScale, 3000 / 1200);
  });

  it("retombe sur le rendu reçu quand l'index ignore les dimensions", () => {
    const { availableWidth, pixelScale, limited } = scaleFor({
      sourceWidth: 0,
      sourceHeight: 0,
      renderedWidth: 2560,
    });
    assert.equal(availableWidth, 2560);
    assert.equal(pixelScale, 2560 / 1200);
    // Rien n'est connu du fichier : on ne prétend pas qu'il est plus grand.
    assert.equal(limited, false);
  });

  it("ne propose aucun zoom tant que rien n'est mesuré ni connu", () => {
    const { availableWidth, pixelScale } = scaleFor({ sourceWidth: 0, sourceHeight: 0 });
    assert.equal(availableWidth, 0);
    assert.equal(pixelScale, 1);
  });

  it('ne descend jamais sous 1 ni au-dessus du plafond de zoom', () => {
    // Cadre plus large que le rendu : l'agrandir n'ajouterait aucun détail.
    assert.equal(scaleFor({ displayedWidth: 5000 }).pixelScale, 1);
    assert.equal(scaleFor({ displayedWidth: 200 }).pixelScale, MAX_SCALE);
  });
});

describe('zoomPercent', () => {
  it("affiche 100 % exactement à un pixel de rendu par pixel d'écran", () => {
    const { pixelScale, availableWidth } = scaleFor();
    assert.equal(zoomPercent(1200, pixelScale, availableWidth), 100);
  });

  it('affiche moins de 100 % quand le plafond de zoom empêche de tout montrer', () => {
    // 4096 pixels disponibles, cadre de 200 px : il faudrait une échelle de
    // 20,5 pour les peindre tous, or le zoom s'arrête à 8.
    const { pixelScale, availableWidth } = scaleFor({ displayedWidth: 200 });
    assert.equal(pixelScale, MAX_SCALE);
    assert.equal(zoomPercent(200, pixelScale, availableWidth), 39);
  });

  it('dépasse 100 % dès que le navigateur interpole', () => {
    const { availableWidth } = scaleFor();
    assert.equal(zoomPercent(1200, MAX_SCALE, availableWidth), 234);
  });
});

describe('repère de position', () => {
  const displayed = { width: 1000, height: 800 };
  const container = { width: 500, height: 400 };

  it('rapporte la part visible de la photo', () => {
    // Échelle 2 : la fenêtre couvre la moitié de chaque côté.
    assert.equal(visibleFraction(displayed.width, container.width, 2), 0.25);
    assert.equal(visibleFraction(displayed.height, container.height, 2), 0.25);
  });

  it('ne dépasse jamais la photo entière', () => {
    // Image plus petite que la fenêtre : le cadre couvre tout le repère, il ne
    // déborde pas — sinon il désignerait une zone qui n'existe pas.
    assert.equal(visibleFraction(200, 500, 1), 1);
  });

  it('situe la vue au centre quand rien n’est déplacé', () => {
    assert.deepEqual(viewCenter({ x: 0, y: 0 }, displayed, 2), { x: 0.5, y: 0.5 });
  });

  it('fait un aller-retour fidèle entre déplacement et point visé', () => {
    // C'est l'invariant qui rend le repère manipulable : ce qu'il affiche et ce
    // qu'il commande doivent parler de la même chose.
    for (const scale of [1.5, 2, 4]) {
      for (const offset of [
        { x: 0, y: 0 },
        { x: 120, y: -80 },
        { x: -333, y: 210 },
      ]) {
        const center = viewCenter(offset, displayed, scale);
        const retour = offsetForCenter(center, displayed, scale);
        assert.ok(Math.abs(retour.x - offset.x) < 1e-9, `x à l'échelle ${scale}`);
        assert.ok(Math.abs(retour.y - offset.y) < 1e-9, `y à l'échelle ${scale}`);
      }
    }
  });

  it('déplace vers la gauche quand on vise la droite de la photo', () => {
    // L'image glisse sous une fenêtre fixe : viser la droite la fait reculer.
    const { x } = offsetForCenter({ x: 1, y: 0.5 }, displayed, 2);
    assert.ok(x < 0, 'le déplacement doit être négatif');
    assert.equal(x, -1000);
  });

  it('ne bouge pas pour un clic au centre', () => {
    assert.deepEqual(offsetForCenter({ x: 0.5, y: 0.5 }, displayed, 3), { x: 0, y: 0 });
  });
});

describe('clic ou glisser', () => {
  const origin = { x: 400, y: 300 };

  it('reconnaît un pointeur strictement immobile', () => {
    assert.equal(isTap(origin, { x: 400, y: 300 }), true);
  });

  it('tolère le tremblement de la main sous le seuil', () => {
    // Le défaut à corriger : sans cette tolérance, aucun clic ne serait jamais
    // reconnu au doigt ni au stylet, qui bougent toujours d'un pixel ou deux.
    assert.equal(isTap(origin, { x: 402, y: 299 }), true);
  });

  it('mesure la distance parcourue, pas chaque axe séparément', () => {
    // 3 et 4 pixels font 5 en diagonale : pile le seuil, donc encore un clic.
    // Pris axe par axe, un déplacement de 4 sur chaque axe passerait aussi,
    // alors qu'il fait 5,66 — un glisser.
    assert.equal(isTap(origin, { x: origin.x + 3, y: origin.y + 4 }), true);
    assert.equal(isTap(origin, { x: origin.x + 4, y: origin.y + 4 }), false);
  });

  it('tient un glisser court et lent pour un glisser', () => {
    // La durée n'entre pas en compte : seul le déplacement décide, sinon un
    // déplacement posément amorcé finirait par dézoomer.
    assert.equal(isTap(origin, { x: origin.x + TAP_SLOP_PX + 1, y: origin.y }), false);
  });

  it('accepte un seuil imposé par l’appelant', () => {
    assert.equal(isTap(origin, { x: origin.x + 10, y: origin.y }, 12), true);
    assert.equal(isTap(origin, { x: origin.x + 10, y: origin.y }, 8), false);
  });

  it('ignore le sens du déplacement', () => {
    for (const [dx, dy] of [
      [TAP_SLOP_PX + 1, 0],
      [-TAP_SLOP_PX - 1, 0],
      [0, TAP_SLOP_PX + 1],
      [0, -TAP_SLOP_PX - 1],
    ] as const) {
      assert.equal(isTap(origin, { x: origin.x + dx, y: origin.y + dy }), false, `${dx}, ${dy}`);
    }
  });
});
