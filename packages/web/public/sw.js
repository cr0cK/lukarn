/**
 * Service worker de la visionneuse.
 *
 * Il met en cache **la coquille** — l'HTML, le JS, le CSS — et rien d'autre.
 * Les photos restent servies par le réseau : elles sont déjà rapides grâce au
 * cache HTTP privé posé par le serveur, et un cache applicatif les ferait
 * survivre à un changement de compte sur un téléphone partagé (voir D71 dans
 * `specs/08-decisions.md`).
 *
 * Écrit à la main plutôt que généré : trois règles tiennent en un fichier
 * lisible, là où un générateur ajouterait une dépendance de build et une
 * couche à comprendre pour le prochain qui reprend le code.
 */

/**
 * Le nom porte une version : la changer met tout le cache au rebut d'un coup,
 * ce qui reste le seul moyen sûr de se sortir d'une coquille corrompue.
 */
const CACHE = 'coquille-v1';

/** L'HTML de l'application. Le serveur le rend sur toute URL de navigation. */
const COQUILLE = '/';

self.addEventListener('install', (event) => {
  // La coquille est mise en cache dès l'installation, sans attendre qu'une
  // navigation la traverse : sinon la première visite hors réseau, juste après
  // l'ajout à l'écran d'accueil, ne trouverait rien.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(COQUILLE)));
});

// Pas de `skipWaiting()` : un onglet ouvert continue de tourner sur les bundles
// qu'il a déjà chargés. Le remplacer à chaud le ferait demander des fichiers
// que le déploiement vient de supprimer, en plein milieu d'une session.
self.addEventListener('activate', (event) => {
  event.waitUntil(purger());
});

/**
 * Rafraîchit la coquille et jette les bundles qu'elle ne référence plus.
 *
 * Sans cette purge, le cache d'assets grossit d'un build à chaque déploiement,
 * indéfiniment — les noms portent un hash, donc rien n'écrase jamais rien.
 * Elle sert aussi à garder la coquille cohérente : gardée telle quelle, elle
 * finirait par désigner hors-ligne des bundles qu'on vient de supprimer.
 */
async function purger() {
  try {
    const reponse = await fetch(COQUILLE, { cache: 'no-store' });
    if (!reponse.ok) return;

    const html = await reponse.clone().text();
    const vivants = new Set([...html.matchAll(/\/assets\/[\w.-]+/g)].map((trouve) => trouve[0]));

    const cache = await caches.open(CACHE);
    await cache.put(COQUILLE, reponse);
    for (const requete of await cache.keys()) {
      const chemin = new URL(requete.url).pathname;
      if (chemin.startsWith('/assets/') && !vivants.has(chemin)) await cache.delete(requete);
    }
  } catch {
    // Activation hors réseau — au premier lancement de l'app depuis l'écran
    // d'accueil, par exemple. On ne purge simplement pas : mieux vaut un cache
    // qui garde un build de trop qu'une activation qui échoue.
  }
}

self.addEventListener('fetch', (event) => {
  const requete = event.request;

  // Tout le reste passe au réseau sans que le service worker s'en mêle : les
  // écritures, les autres origines, et surtout `/api/` — photos, albums,
  // session. Le cloisonnement entre comptes se joue là, et il se joue en
  // ne mettant rien en cache plutôt qu'en choisissant bien quoi purger.
  if (requete.method !== 'GET') return;

  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Réseau d'abord : l'HTML garde la même URL d'un déploiement à l'autre, le
  // servir depuis le cache figerait l'application sur une version passée.
  if (requete.mode === 'navigate') {
    event.respondWith(reseauPuisCoquille(requete));
    return;
  }

  // Cache d'abord : les bundles Vite portent un hash, leur contenu ne change
  // jamais à URL constante.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheDAbord(requete));
  }
});

/** Sert la navigation par le réseau, et retombe sur la coquille en cache. */
async function reseauPuisCoquille(requete) {
  try {
    return await fetch(requete);
  } catch {
    const coquille = await caches.match(COQUILLE, { cacheName: CACHE });
    return coquille ?? Response.error();
  }
}

/** Sert un bundle depuis le cache, et l'y met au premier passage. */
async function cacheDAbord(requete) {
  const cache = await caches.open(CACHE);
  const enCache = await cache.match(requete);
  if (enCache) return enCache;

  const reponse = await fetch(requete);
  // Une réponse en erreur ne se met pas en cache : elle y resterait pour
  // toujours, puisque plus rien ne viendrait la remplacer à URL constante.
  if (reponse.ok) await cache.put(requete, reponse.clone());
  return reponse;
}
