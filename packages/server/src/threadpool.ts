/**
 * Taille du pool de fils de libuv, à fixer **avant** toute entrée-sortie.
 *
 * Node exécute sur ce pool le décodage d'images de sharp, mais aussi les
 * lectures de fichiers et le hachage argon2. Sa taille par défaut est de quatre
 * fils : quatre photos en cours de traitement le remplissent entièrement, et
 * tout le reste attend derrière — y compris la lecture d'une vignette déjà en
 * cache, qui ne demande pourtant qu'un accès disque.
 *
 * Mesuré sur huit cœurs, vingt-quatre rendus simultanés, en interrogeant en
 * parallèle une vignette déjà en cache :
 *
 * | Pool | p95 de la requête servie depuis le cache |
 * | ---- | ---------------------------------------- |
 * | 4    | 2 124 ms                                 |
 * | 16   | 0,77 ms                                  |
 *
 * Le débit des rendus est le même dans les deux cas : ces fils supplémentaires
 * ne servent pas à traiter plus vite, mais à empêcher les traitements longs de
 * confisquer le pool aux requêtes courtes.
 *
 * Ce module doit être importé **en premier** par le point d'entrée. Node lit la
 * variable à la première utilisation du pool, pas au démarrage : la poser après
 * une lecture de fichier n'aurait plus aucun effet.
 */

/** Assez pour que les requêtes courtes ne fassent jamais la queue. */
const DEFAUT = 16;

function configurer(): number {
  const existant = Number(process.env.UV_THREADPOOL_SIZE);

  // Une valeur déjà posée par l'exploitant fait autorité : elle peut avoir été
  // choisie pour un hébergement contraint.
  if (Number.isInteger(existant) && existant > 0) return existant;

  process.env.UV_THREADPOOL_SIZE = String(DEFAUT);
  return DEFAUT;
}

/**
 * Le réglage a lieu au chargement du module, et non dans une fonction appelée
 * depuis le point d'entrée : en ESM, **tous** les imports sont évalués avant le
 * corps du module qui les déclare. Un appel placé entre deux imports
 * s'exécuterait donc après eux, et il suffirait qu'un seul ouvre un fichier
 * pour que la valeur soit déjà figée.
 */
export const threadPoolSize = configurer();
