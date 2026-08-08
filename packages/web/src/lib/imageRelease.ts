/**
 * Annule le chargement d'une image que plus personne ne regarde.
 *
 * Retirer un `<img>` du DOM **n'annule pas** sa requête : le navigateur la mène
 * à terme, et une image que plus personne ne regarde continue d'occuper une des
 * six connexions que HTTP/1.1 accorde à une origine. Effacer `src` est ce qui
 * coupe réellement la requête.
 *
 * Le contrôle sur `isConnected` n'est pas une précaution de style : `StrictMode`
 * rejoue montage/démontage sans jamais toucher au DOM, et sans lui les vignettes
 * du premier écran perdaient leur `src` à l'instant où elles s'affichaient —
 * React ne le réécrit pas, sa vue du DOM le croit inchangé.
 *
 * Dans `lib/` et non dans le composant qui l'a vu naître : la grille et la
 * visionneuse en dépendent toutes deux, pour la même raison et au même prix.
 */
export function releaseIfDetached(image: HTMLImageElement | null): void {
  if (image && !image.isConnected) image.removeAttribute('src');
}
