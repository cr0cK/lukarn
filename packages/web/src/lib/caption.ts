/**
 * La légende d'une photo ouverte : deux textes, deux portées.
 *
 * Ce qui explique une image se lisait ailleurs qu'elle — la note du jour dans
 * l'en-tête de sa section, et rien du tout sur la photo elle-même. Le bandeau
 * bas de la visionneuse les rassemble, du plus précis au plus général : ce qui
 * se passe ici, puis ce qu'on faisait ce jour-là (D84).
 *
 * **La description de l'album n'en fait pas partie** (D89). Elle y figurait en
 * troisième ligne, et c'est un texte qu'on a lu en ouvrant l'album, identique
 * sur les neuf cents photos qu'il contient : une ligne par photo pour le
 * relire. Le titre de l'album, lui, reste dans l'en-tête, où il situe sans
 * raconter.
 *
 * Le calcul de ce qu'il faut afficher est ici, hors de tout composant : c'est la
 * seule partie testable sans DOM, et c'est aussi la seule qui a des cas —
 * lignes vides, tout vide, ordre des portées.
 */

import { useCallback, useEffect, useState } from 'react';

/** Les deux textes candidats, tels que la visionneuse les tient. */
export interface CaptionSource {
  /** Description de la photo ouverte. */
  description?: string | null;
  /** Note de la journée qui la porte. */
  day?: string | null;
}

/** Portée d'une ligne de légende, du plus précis au plus général. */
export type CaptionScope = 'photo' | 'day';

export interface CaptionEntry {
  scope: CaptionScope;
  /**
   * Préfixe affiché devant le texte, `null` sur la ligne de la photo. La ligne
   * du dessous parle d'autre chose que de l'image qu'on regarde : sans ce mot,
   * « Bonifacio, la plage » se lirait comme une légende de la photo.
   */
  label: string | null;
  text: string;
}

/**
 * Les lignes non vides, dans l'ordre de portée. Un texte réduit à des espaces
 * ne compte pas : il ouvrirait une ligne vide dans le bandeau, et le bandeau
 * lui-même sur une photo qui n'a rien à dire.
 */
export function captionEntries(source: CaptionSource): CaptionEntry[] {
  const candidates: { scope: CaptionScope; label: string | null; value: string | null }[] = [
    { scope: 'photo', label: null, value: source.description ?? null },
    { scope: 'day', label: 'That day', value: source.day ?? null },
  ];

  return candidates
    .map((candidate) => ({ ...candidate, text: candidate.value?.trim() ?? '' }))
    .filter((candidate) => candidate.text !== '')
    .map(({ scope, label, text }) => ({ scope, label, text }));
}

/**
 * Préférence « légende masquée », d'une visite à l'autre.
 *
 * Persistée alors que le dépliement ne l'est pas, et la différence n'est pas
 * arbitraire : masquer est un choix sur la façon de regarder ses photos — on le
 * fait une fois et on n'a pas à le refaire —, déplier est une réponse à un texte
 * précis, qui n'a pas de sens sur la photo suivante.
 *
 * Une seule clé pour toute l'application, contrairement aux repères de lecture
 * des commentaires : c'est un réglage d'affichage, pas une donnée d'album.
 */
const STORAGE_KEY = 'nonni:caption-hidden';

/**
 * Lecture tolérante, sur le modèle de `lib/seenComments.ts` : un `localStorage`
 * refusé (navigation privée sur d'anciens Safari) ne doit pas empêcher la
 * visionneuse de s'ouvrir. Le repli est « visible », la lecture la moins
 * trompeuse d'une mémoire absente — un bandeau de trop se referme, un bandeau
 * manquant ne se devine pas.
 */
function load(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export interface CaptionHidden {
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
}

export function useCaptionHidden(): CaptionHidden {
  const [hidden, setHiddenState] = useState(load);

  // Un autre onglet a pu changer le réglage entre deux ouvertures ; et sur le
  // premier rendu, `load()` a déjà été appelé par l'initialiseur d'état.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === STORAGE_KEY) setHiddenState(load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setHidden = useCallback((next: boolean) => {
    setHiddenState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Quota dépassé ou écriture refusée : le bandeau réapparaîtra à la
      // prochaine visite, ce qui ne vaut pas de faire échouer un rendu.
    }
  }, []);

  return { hidden, setHidden };
}
