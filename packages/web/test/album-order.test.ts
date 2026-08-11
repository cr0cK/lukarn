import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { readStoredOrder, resolveOrder } from '../src/lib/albumOrder';

/**
 * Sens de lecture d'un album : trois sources, un ordre de priorité.
 *
 * C'est la seule partie du mécanisme qui a des cas, et la seule testable sans
 * DOM. Se tromper d'ordre ne casse rien de visible : l'album s'ouvre, à
 * l'envers de ce que son lecteur avait demandé.
 */

describe('résolution du sens de lecture', () => {
  it('suit l’URL avant tout le reste', () => {
    // Un lien partagé, ou reçu par email, restitue une vue exacte : ce que le
    // navigateur a retenu ne doit pas la contredire.
    assert.equal(resolveOrder('desc', 'asc', 'asc'), 'desc');
    assert.equal(resolveOrder('asc', 'desc', 'desc'), 'asc');
  });

  it('retombe sur ce que le navigateur a retenu', () => {
    assert.equal(resolveOrder(null, 'desc', 'asc'), 'desc');
  });

  it('retombe sur le défaut de l’album en dernier', () => {
    assert.equal(resolveOrder(null, null, 'desc'), 'desc');
    assert.equal(resolveOrder(null, null, 'asc'), 'asc');
  });

  it('ignore un paramètre d’URL bricolé à la main', () => {
    // Sans quoi la grille demanderait `?order=zigzag`, que l'API refuse par un
    // 400 — un album vide et une erreur, pour une URL mal recopiée.
    assert.equal(resolveOrder('zigzag', 'desc', 'asc'), 'desc');
    assert.equal(resolveOrder('DESC', null, 'asc'), 'asc');
  });

  it('ne tranche pas tant qu’aucune source n’a répondu', () => {
    // `null` fait attendre la grille. Un défaut de repli ici chargerait deux
    // cents éléments dans un sens rejeté à l'arrivée de l'album.
    assert.equal(resolveOrder(null, null, undefined), null);
  });
});

describe('mémoire par album', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  /** Pose un `window.localStorage` de test — il n'y a pas de DOM ici. */
  function stockage(getItem: (key: string) => string | null): void {
    (globalThis as { window?: unknown }).window = { localStorage: { getItem } };
  }

  it('lit le sens retenu sous une clé par album', () => {
    stockage((key) => (key === 'nonni:album-order:corse' ? 'desc' : null));

    assert.equal(readStoredOrder('corse'), 'desc');
    // Une clé par album : « Corse » se lit dans l'ordre du séjour et « Les
    // enfants » par les dernières photos, sans que l'un décide pour l'autre.
    assert.equal(readStoredOrder('enfants'), null);
  });

  it('ignore une valeur que ce code n’a pas écrite', () => {
    stockage(() => 'chronologique');
    assert.equal(readStoredOrder('corse'), null);
  });

  it('tient face à un localStorage refusé', () => {
    // Navigation privée sur d'anciens Safari : la lecture lève. L'album doit
    // s'ouvrir quand même, sur le sens que son administrateur a choisi.
    stockage(() => {
      throw new Error('accès au stockage refusé');
    });
    assert.equal(readStoredOrder('corse'), null);
    assert.equal(resolveOrder(null, readStoredOrder('corse'), 'desc'), 'desc');
  });
});
