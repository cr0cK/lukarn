import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeZoomScale, HD_MAX_EDGE, zoomPercent } from '../src/lib/zoom';

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
