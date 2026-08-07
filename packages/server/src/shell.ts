/**
 * Le nom de l'instance, injecté dans les deux fichiers qui le portent.
 *
 * `APP_NAME` doit valoir au démarrage, pas au build : une seule image sert
 * toutes les installations, et personne ne reconstruit un conteneur pour
 * appeler sa galerie autrement. Les deux fichiers concernés sont donc écrits
 * avec « Photos » en dur — ce qui les rend justes tels quels en développement,
 * où Vite les sert sans passer par ici — et le serveur y substitue le nom
 * configuré à la volée.
 *
 * La substitution vise trois emplacements précis d'un fichier que ce dépôt
 * écrit lui-même. Ce n'est pas de l'analyse de HTML : c'est un gabarit dont on
 * connaît les trous.
 */

/**
 * Échappe ce qui, dans un nom, casserait le HTML autour.
 *
 * Le nom vient du `.env` de l'exploitant, pas d'un visiteur — mais un `"` suffit
 * à sortir d'un attribut et à disloquer la page, et personne ne relit son
 * `.env` en se demandant s'il est du HTML valide.
 */
function echapper(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Remplace le nom par défaut dans la coquille HTML.
 *
 * Trois emplacements, et chacun sert à quelque chose de différent : le `<title>`
 * nomme l'onglet, `apple-mobile-web-app-title` nomme l'icône d'accueil iOS —
 * Safari ne lit pas le manifeste pour ça — et `application-name` est celui que
 * le front relit pour son écran de connexion, ce qui lui évite un aller-retour
 * réseau pour afficher un titre.
 */
export function renderShell(html: string, appName: string): string {
  const nom = echapper(appName);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${nom}</title>`)
    .replace(/(<meta\s+name="apple-mobile-web-app-title"\s+content=")[^"]*(")/, `$1${nom}$2`)
    .replace(/(<meta\s+name="application-name"\s+content=")[^"]*(")/, `$1${nom}$2`);
}

/**
 * Remplace le nom dans le manifeste d'installation.
 *
 * Le fichier statique reste la source de vérité pour tout le reste — icônes,
 * couleurs, `display`. Ne surcharger que les deux champs de nom évite d'avoir
 * la liste des icônes déclarée à deux endroits, qui divergeraient au premier
 * ajout de taille.
 *
 * Un manifeste illisible fait échouer le démarrage : c'est un fichier du
 * dépôt, s'il ne parse pas c'est que le build est cassé, et servir un
 * manifeste vide rendrait l'application silencieusement non installable.
 */
export function renderManifest(raw: string, appName: string): string {
  const manifeste = JSON.parse(raw) as Record<string, unknown>;
  return JSON.stringify({ ...manifeste, name: appName, short_name: appName }, null, 2);
}
