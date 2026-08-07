/**
 * Ce qu'on a déjà lu, par photo.
 *
 * On mémorise **un nombre de commentaires vus**, pas une date. Comparer deux
 * entiers suffit à répondre à la seule question posée — « y a-t-il du nouveau
 * depuis mon dernier passage ? » — là où une date obligerait le serveur à
 * transporter l'horodatage de chaque fil pour qu'on puisse le comparer.
 *
 * Le repère vit dans le navigateur et non en base, alors que le compte, lui,
 * vient du serveur. Une table côté serveur devrait être indexée par la clé
 * d'accès, or une clé est partagée par tout un foyer (D38) : le premier à
 * ouvrir une photo effacerait la pastille des autres. Le navigateur, lui, est
 * bien celui d'une personne. Le prix assumé est qu'un changement d'appareil
 * repart de zéro : on voit alors ses propres commentaires comme non lus une
 * fois, jamais l'inverse.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** Nombre de commentaires vus, par identifiant de média. */
export type SeenCounts = Record<string, number>;

/**
 * Commentaires arrivés depuis le dernier passage.
 *
 * Le plancher à zéro n'est pas de la coquetterie : une suppression ou un
 * masquage fait baisser le total sous ce qu'on avait lu, et un nombre négatif
 * s'afficherait tel quel sur la pastille.
 */
export function unreadCount(total: number, seen: number | undefined): number {
  return Math.max(0, total - (seen ?? 0));
}

function storageKey(albumId: string): string {
  return `gdv:comments-seen:${albumId}`;
}

/**
 * Lecture tolérante : un `localStorage` refusé (navigation privée sur d'anciens
 * Safari) ou une valeur corrompue par une version précédente ne doit pas empêcher
 * d'afficher les commentaires. Tout est alors considéré comme non lu, ce qui est
 * la lecture la moins trompeuse d'une mémoire absente.
 */
function load(albumId: string): SeenCounts {
  try {
    const raw = window.localStorage.getItem(storageKey(albumId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

    const counts: SeenCounts = {};
    for (const [mediaId, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        counts[mediaId] = value;
      }
    }
    return counts;
  } catch {
    return {};
  }
}

function save(albumId: string, counts: SeenCounts): void {
  try {
    window.localStorage.setItem(storageKey(albumId), JSON.stringify(counts));
  } catch {
    // Quota dépassé ou écriture refusée : la pastille redeviendra bavarde à la
    // prochaine visite, ce qui ne vaut pas de faire échouer un rendu.
  }
}

export interface SeenComments {
  seen: SeenCounts;
  /** Marque cette photo comme lue jusqu'à `count` commentaires. */
  markSeen: (mediaId: string, count: number) => void;
}

/**
 * Repères de lecture de l'album, mémorisés d'une visite à l'autre.
 *
 * Un objet par album plutôt qu'une clé par photo : effacer les repères d'un
 * album supprimé ou inspecter ce qui est stocké reste faisable à la main, et le
 * nombre d'entrées de `localStorage` ne suit pas le nombre de photos regardées.
 */
export function useSeenComments(albumId: string): SeenComments {
  const [seen, setSeen] = useState<SeenCounts>(() => load(albumId));

  /**
   * Miroir de l'état, lu sans créer de dépendance. Il évite surtout d'écrire
   * depuis l'updater de `setSeen` : React y rejoue la fonction en mode strict,
   * et un effet de bord n'y a rien à faire.
   */
  const seenRef = useRef(seen);

  useEffect(() => {
    const loaded = load(albumId);
    seenRef.current = loaded;
    setSeen(loaded);
  }, [albumId]);

  const markSeen = useCallback(
    (mediaId: string, count: number) => {
      const current = seenRef.current;
      if ((current[mediaId] ?? 0) === Math.max(0, count)) return;

      const next = { ...current };
      // Une photo revenue à zéro commentaire quitte la table : garder un repère
      // qui ne peut plus rien masquer ferait grossir le stockage sans fin.
      if (count > 0) next[mediaId] = count;
      else delete next[mediaId];

      seenRef.current = next;
      save(albumId, next);
      setSeen(next);
    },
    [albumId],
  );

  return { seen, markSeen };
}
