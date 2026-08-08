import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GRID_COLLAPSED_HEADER_HEIGHT,
  GRID_HEADER_HEIGHT,
  GRID_HEADER_LINE_HEIGHT,
  sectionHeaderHeight,
} from '../src/lib/useGridLayout';
import { measureLines } from '../src/lib/measureLines';

describe('hauteur réservée à un en-tête de section', () => {
  it('vaut la base quand la journée ne porte ni lieu ni note', () => {
    assert.equal(
      sectionHeaderHeight({ collapsed: false, hasPlace: false, descriptionLines: 0 }),
      GRID_HEADER_HEIGHT,
    );
  });

  it('ajoute une ligne pour le lieu, qui tient toujours sur une seule', () => {
    assert.equal(
      sectionHeaderHeight({ collapsed: false, hasPlace: true, descriptionLines: 0 }),
      GRID_HEADER_HEIGHT + GRID_HEADER_LINE_HEIGHT,
    );
  });

  it('réserve à la note exactement les lignes mesurées, sans majoration', () => {
    // L'invariant du calcul sans DOM : ce qui est réservé vaut ce qui sera
    // rendu. Majorer laisserait un blanc sous l'en-tête, minorer ferait passer
    // les vignettes sous le texte — et rien ne rattrape ni l'un ni l'autre.
    for (const lignes of [1, 2, 3, 5, 7]) {
      assert.equal(
        sectionHeaderHeight({ collapsed: false, hasPlace: false, descriptionLines: lignes }),
        GRID_HEADER_HEIGHT + lignes * GRID_HEADER_LINE_HEIGHT,
      );
    }
  });

  it('cumule le lieu et la note', () => {
    assert.equal(
      sectionHeaderHeight({ collapsed: false, hasPlace: true, descriptionLines: 3 }),
      GRID_HEADER_HEIGHT + 4 * GRID_HEADER_LINE_HEIGHT,
    );
  });

  it('repliée, perd sa respiration du bas mais garde ses textes', () => {
    assert.equal(
      sectionHeaderHeight({ collapsed: true, hasPlace: true, descriptionLines: 2 }),
      GRID_COLLAPSED_HEADER_HEIGHT + 3 * GRID_HEADER_LINE_HEIGHT,
    );
  });
});

describe('mesure du nombre de lignes', () => {
  it('ne compte aucune ligne pour un texte absent', () => {
    assert.equal(measureLines('', 800, 'text-sm', GRID_HEADER_LINE_HEIGHT), 0);
  });

  it('compte une ligne sans DOM à interroger, plutôt que zéro', () => {
    // Un test, un rendu serveur : pas de sonde à mesurer. Zéro réserverait une
    // hauteur nulle à un paragraphe qui, lui, en occuperait une.
    assert.equal(measureLines('une note', 800, 'text-sm', GRID_HEADER_LINE_HEIGHT), 1);
  });

  it("compte une ligne tant que la largeur n'est pas connue", () => {
    assert.equal(measureLines('une note', 0, 'text-sm', GRID_HEADER_LINE_HEIGHT), 1);
  });
});
