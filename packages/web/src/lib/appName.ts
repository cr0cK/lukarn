/**
 * Le nom de l'instance, tel que le serveur l'a posé dans la coquille.
 *
 * Lu dans le DOM plutôt que demandé à l'API : le nom est déjà là quand le
 * premier octet de JavaScript s'exécute, alors qu'un appel réseau ferait
 * afficher un titre vide — ou pire, un titre faux — le temps de la réponse.
 * C'est aussi le seul moyen d'en disposer sur l'écran de connexion, qui
 * s'affiche précisément quand aucune route authentifiée ne répond.
 *
 * `application-name` est la balise standard pour ça ; `shell.ts` la remplit
 * côté serveur à partir d'`APP_NAME`.
 */
export function appName(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="application-name"]');
  return meta?.content?.trim() || 'Photos';
}
