import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatUserCode, normalizeUserCode } from '@gdv/shared';
import { qrCode } from '../src/lib/qr';

/**
 * Le QR affiché par un écran sans clavier (D260809c).
 *
 * Ce qui se vérifie ici est ce qu'un rendu ne montrerait pas : le tracé décrit
 * bien la grille produite, et le code se recopie à la main sans que sa forme
 * lisible ne change ce qu'on envoie au serveur.
 */

describe('tracé du QR', () => {
  it('rend une grille carrée et un tracé non vide', () => {
    const qr = qrCode('https://photos.exemple.fr/pair?code=ABCD2345');

    // Les versions QR font 21, 25, 29… modules de côté : toujours 4n + 17.
    assert.equal((qr.size - 17) % 4, 0);
    assert.ok(qr.path.length > 0);
  });

  it('place le motif de repérage en haut à gauche', () => {
    const qr = qrCode('https://photos.exemple.fr/pair?code=ABCD2345');

    // Les trois motifs de repérage sont invariants : le coin haut-gauche
    // commence par sept modules noirs d'affilée, qui doivent apparaître comme
    // un seul rectangle — c'est ce que la fusion des séries produit.
    assert.match(qr.path, /^M0 0h7v1h-7z/);
  });

  it('grandit avec le texte encodé', () => {
    const court = qrCode('https://a.fr/pair?code=ABCD2345');
    const long = qrCode(`https://${'sous-domaine.'.repeat(8)}exemple.fr/pair?code=ABCD2345`);

    // Version choisie automatiquement : une taille figée casserait au premier
    // nom de domaine un peu long.
    assert.ok(long.size > court.size);
  });
});

describe('code affiché', () => {
  it('se recopie avec son tiret et en minuscules', () => {
    // Le code s'affiche groupé par quatre pour se lire de loin ; ce qui part au
    // serveur est la forme repliée, sinon un code recopié ne désignerait rien.
    assert.equal(normalizeUserCode('abcd-2345'), 'ABCD2345');
    assert.equal(normalizeUserCode('ABCD 2345'), 'ABCD2345');
    assert.equal(formatUserCode('ABCD2345'), 'ABCD-2345');
    assert.equal(normalizeUserCode(formatUserCode('ABCD2345')), 'ABCD2345');
  });
});
