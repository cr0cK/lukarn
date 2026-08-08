import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickThumbSize } from '../src/components/Thumb';
import { releaseIfDetached } from '../src/lib/imageRelease';

/** Le strict minimum d'un `<img>` pour ce que la libération en observe. */
function vignette(isConnected: boolean) {
  const supprimes: string[] = [];
  return {
    supprimes,
    node: { isConnected, removeAttribute: (nom: string) => supprimes.push(nom) },
  };
}

describe('releaseIfDetached', () => {
  it('coupe la requête de la vignette qui a quitté la grille', () => {
    // L'invariant protégé : une vignette démontée ne doit plus rien demander au
    // réseau. Retirer un `<img>` du DOM n'y suffit pas — le navigateur termine
    // le transfert — et la connexion ainsi retenue est l'une des six d'une
    // origine HTTP/1.1. Inverser le tri d'un album froid en abandonnait
    // plusieurs dizaines d'un coup, derrière lesquelles le `/items` du nouveau
    // tri attendait, écran bloqué sur « Chargement des photos ».
    const { node, supprimes } = vignette(false);

    releaseIfDetached(node as unknown as HTMLImageElement);

    assert.deepEqual(supprimes, ['src'], "seul `src` est effacé : c'est lui qui porte la requête");
  });

  it('laisse intacte une vignette toujours à l’écran', () => {
    // `StrictMode` rejoue montage puis démontage sans toucher au DOM : sans
    // cette garde, les vignettes du premier écran perdaient leur `src` à
    // l'instant où elles s'affichaient, et React ne le réécrit jamais.
    const { node, supprimes } = vignette(true);

    releaseIfDetached(node as unknown as HTMLImageElement);

    assert.deepEqual(supprimes, []);
  });

  it('tolère l’absence de nœud', () => {
    // Tuile vidéo ou vignette en échec : il n'y a pas d'`<img>` du tout.
    assert.doesNotThrow(() => releaseIfDetached(null));
  });
});

describe('pickThumbSize', () => {
  it('couvre la taille d’affichage, densité comprise', () => {
    assert.equal(pickThumbSize(300, 1), 320);
    assert.equal(pickThumbSize(300, 2), 640);
  });

  it('plafonne la densité prise en compte à 2', () => {
    // Au-delà, on paierait quatre fois le poids pour un gain que l'œil ne voit
    // pas sur une vignette de grille.
    assert.equal(pickThumbSize(300, 3), pickThumbSize(300, 2));
  });
});
