/**
 * Viewer service worker.
 *
 * It caches **the shell** — HTML, JS and CSS — and nothing else. Photos remain
 * served over the network: the private HTTP cache set by the server already
 * makes them fast, while an application cache would preserve them across an
 * account change on a shared phone (see D71 in
 * `specs/08-decisions.md`).
 *
 * Written by hand rather than generated: three rules fit in a readable file,
 * whereas a generator would add a build dependency and another layer for the
 * next person taking over the code to understand.
 */

/**
 * The name carries a version: changing it discards the whole cache at once,
 * which remains the only safe way out of a corrupted shell.
 */
const CACHE = 'coquille-v1';

/** The application HTML. The server renders it for every navigation URL. */
const COQUILLE = '/';

self.addEventListener('install', (event) => {
  // Cache the shell during installation rather than waiting for navigation to
  // pass through it: otherwise the first offline visit, just after adding the
  // app to the home screen, would find nothing.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(COQUILLE)));
});

// No `skipWaiting()`: an open tab keeps running the bundles it has already
// loaded. Replacing it live would make it request files the deployment has just
// removed, midway through a session.
self.addEventListener('activate', (event) => {
  event.waitUntil(purger());
});

/**
 * Refreshes the shell and discards bundles it no longer references.
 *
 * Without this purge, the asset cache grows by one build on every deployment,
 * indefinitely — names carry a hash, so nothing ever overwrites anything. It
 * also keeps the shell consistent: left untouched, its offline copy would
 * eventually refer to bundles that have just been removed.
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
    // Offline activation — when the app is first launched from the home screen,
    // for example. Simply skip the purge: keeping one build too many is better
    // than a failed activation.
  }
}

self.addEventListener('fetch', (event) => {
  const requete = event.request;

  // Everything else reaches the network without service-worker involvement:
  // writes, other origins and, above all, `/api/` — photos, albums and session.
  // Account isolation depends on this boundary, and is achieved by caching
  // nothing rather than trying to choose what to purge.
  if (requete.method !== 'GET') return;

  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Network first: HTML keeps the same URL across deployments, so serving it
  // from the cache would freeze the application on an older version.
  if (requete.mode === 'navigate') {
    event.respondWith(reseauPuisCoquille(requete));
    return;
  }

  // Cache first: Vite bundles carry a hash, so their content never changes at a
  // given URL.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheDAbord(requete));
  }
});

/** Serves navigation from the network, falling back to the cached shell. */
async function reseauPuisCoquille(requete) {
  try {
    return await fetch(requete);
  } catch {
    const coquille = await caches.match(COQUILLE, { cacheName: CACHE });
    return coquille ?? Response.error();
  }
}

/** Serves a bundle from the cache, adding it on first access. */
async function cacheDAbord(requete) {
  const cache = await caches.open(CACHE);
  const enCache = await cache.match(requete);
  if (enCache) return enCache;

  const reponse = await fetch(requete);
  // Do not cache an error response: it would remain forever because nothing
  // would replace it at a stable URL.
  if (reponse.ok) await cache.put(requete, reponse.clone());
  return reponse;
}
