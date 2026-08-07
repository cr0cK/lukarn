/**
 * Enregistre le service worker qui rend l'application installable.
 *
 * **En production seulement.** En développement, Vite sert des modules non
 * groupés et remplace le code à chaud ; un service worker qui garde la coquille
 * rendrait des fichiers périmés à chaque rechargement, et il faudrait le
 * désinscrire à la main pour comprendre pourquoi une modification ne prend pas.
 *
 * L'enregistrement attend `load` : à l'ouverture, la bande passante appartient
 * aux vignettes de la grille, pas à la mise en cache de la coquille.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    // Un enregistrement qui échoue — navigateur en navigation privée, origine
    // non sécurisée — ne doit rien casser : le service worker n'apporte que
    // l'installation et la coquille hors-ligne, l'application marche sans lui.
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
