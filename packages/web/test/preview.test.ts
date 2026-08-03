import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { previewOverlay } from '../src/lib/preview';

/**
 * Ce qui s'affiche pendant qu'une photo se prépare.
 *
 * Régression déjà survenue : l'aperçu flou était montré **sans** indicateur.
 * Rien ne signalait une attente, si bien que l'ouverture donnait l'impression
 * d'une photo floue plutôt que d'une photo qui charge — et le défaut passait
 * inaperçu dès que le rendu était déjà en cache, donc « aléatoirement ».
 */

describe('affichage pendant le chargement', () => {
  it("montre l'aperçu et l'indicateur ensemble", () => {
    // L'invariant qui avait cédé : jamais de flou muet.
    const overlay = previewOverlay({ loaded: false, failed: false, measured: true });

    assert.equal(overlay.placeholder, true);
    assert.equal(overlay.spinner, true);
    assert.equal(overlay.error, false);
  });

  it("signale l'attente même sans aperçu à montrer", () => {
    // Dimensions inconnues : rien à positionner, mais un écran noir muet serait
    // encore plus déroutant qu'un aperçu flou.
    const overlay = previewOverlay({ loaded: false, failed: false, measured: false });

    assert.equal(overlay.placeholder, false);
    assert.equal(overlay.spinner, true);
  });

  it('retire les deux dès que la photo est là', () => {
    const overlay = previewOverlay({ loaded: true, failed: false, measured: true });

    assert.equal(overlay.placeholder, false);
    assert.equal(overlay.spinner, false);
    assert.equal(overlay.error, false);
  });

  it("n'annonce pas une attente qui n'aura pas lieu", () => {
    // Échec : l'indicateur tournerait indéfiniment, et l'aperçu flou laisserait
    // croire que la photo finira par arriver.
    const overlay = previewOverlay({ loaded: false, failed: true, measured: true });

    assert.equal(overlay.error, true);
    assert.equal(overlay.spinner, false);
    assert.equal(overlay.placeholder, false);
  });

  it("laisse l'échec primer sur un chargement abouti", () => {
    // Le rendu `hd` peut échouer après l'affichage du rendu d'écran : mieux
    // vaut le dire que de laisser croire à une image complète.
    const overlay = previewOverlay({ loaded: true, failed: true, measured: true });
    assert.equal(overlay.error, true);
  });

  it('ne montre jamais deux états à la fois', () => {
    for (const loaded of [false, true]) {
      for (const failed of [false, true]) {
        for (const measured of [false, true]) {
          const { placeholder, spinner, error } = previewOverlay({ loaded, failed, measured });
          if (error) {
            assert.ok(!placeholder && !spinner, 'un échec exclut aperçu et indicateur');
          }
          if (placeholder) {
            assert.ok(spinner, 'un aperçu flou sans indicateur se lit comme un défaut');
          }
        }
      }
    }
  });
});
