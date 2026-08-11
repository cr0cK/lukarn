/**
 * Sens de lecture d'un album : ce que l'URL demande, ce que ce navigateur en a
 * retenu, et ce que l'album propose à défaut.
 *
 * Trois sources parce qu'elles répondent à trois questions distinctes. L'URL est
 * une vue exacte, partagée ou reçue par email : elle prime, sinon un lien
 * n'ouvrirait pas ce que son expéditeur avait sous les yeux. Le navigateur porte
 * l'habitude de la personne qui l'utilise — rebasculer le sens à chaque visite
 * du même album est exactement le geste qu'une mémoire évite. L'album, enfin,
 * porte le sens de ce qu'il raconte, réglable dans /admin (D99).
 *
 * L'abonnement n'entre pas dans le calcul, alors qu'il semblerait distinguer un
 * album découvert d'un album suivi : il est automatique dès la première
 * ouverture (D41), donc vrai pour les deux. Le signal réellement discriminant
 * est « ce navigateur a déjà ouvert cet album », c'est-à-dire la mémoire locale
 * elle-même.
 */

import { isSortOrder, type SortOrder } from '@nonni/shared';
import { useCallback, useEffect, useState } from 'react';

function storageKey(albumId: string): string {
  return `nonni:album-order:${albumId}`;
}

/**
 * Ce que ce navigateur a retenu du sens de cet album, `null` s'il n'en a rien
 * retenu.
 *
 * Lecture tolérante, sur le modèle de `lib/seenComments.ts` : un `localStorage`
 * refusé (navigation privée sur d'anciens Safari) ou une valeur écrite par une
 * version précédente ne doit pas empêcher l'album de s'ouvrir. Le repli est
 * « rien de mémorisé », qui laisse simplement l'album décider.
 */
export function readStoredOrder(albumId: string): SortOrder | null {
  try {
    const raw = window.localStorage.getItem(storageKey(albumId));
    return isSortOrder(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Le sens à appliquer, ou `null` tant qu'aucune source n'a répondu — l'album
 * n'est pas chargé et rien n'est mémorisé.
 *
 * `null` n'est pas un défaut de repli : la grille attend plutôt que de charger
 * deux cents éléments dans un sens qu'elle rejetterait à l'arrivée de l'album.
 */
export function resolveOrder(
  urlParam: string | null,
  stored: SortOrder | null,
  albumDefault: SortOrder | undefined,
): SortOrder | null {
  if (isSortOrder(urlParam)) return urlParam;
  if (stored) return stored;
  return albumDefault ?? null;
}

export interface StoredOrder {
  /** Sens retenu pour cet album, `null` si ce navigateur n'en a pas encore vu. */
  stored: SortOrder | null;
  remember: (order: SortOrder) => void;
}

/**
 * Le sens mémorisé pour cet album, et de quoi le mettre à jour.
 *
 * Une clé par album, comme les repères de lecture des commentaires : « Corse »
 * se lit dans l'ordre du séjour et « Les enfants » par les dernières photos, et
 * une clé unique ferait que basculer l'un retourne l'autre.
 */
export function useStoredOrder(albumId: string): StoredOrder {
  const [stored, setStored] = useState<SortOrder | null>(() => readStoredOrder(albumId));

  useEffect(() => {
    setStored(readStoredOrder(albumId));

    // Un autre onglet a pu basculer le même album entre-temps ; sans cela, les
    // deux vues du même album divergeraient jusqu'au prochain rechargement.
    const onStorage = (event: StorageEvent): void => {
      if (event.key === storageKey(albumId)) setStored(readStoredOrder(albumId));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [albumId]);

  const remember = useCallback(
    (order: SortOrder) => {
      setStored(order);
      try {
        window.localStorage.setItem(storageKey(albumId), order);
      } catch {
        // Quota dépassé ou écriture refusée : l'album repartira de son défaut à
        // la prochaine visite, ce qui ne vaut pas de faire échouer un rendu.
      }
    },
    [albumId],
  );

  return { stored, remember };
}
