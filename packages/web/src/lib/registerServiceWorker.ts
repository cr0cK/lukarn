/**
 * Registers the service worker that makes the application installable.
 *
 * **Production only.** In development, Vite serves unbundled modules and hot
 * replaces code; a service worker retaining the shell would return stale files
 * on every reload and need manual unregistration before a change appeared.
 *
 * Registration waits for `load`: on opening, bandwidth belongs to grid
 * thumbnails, not shell caching.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    // Failed registration — private browsing or insecure origin — must break
    // nothing: the service worker adds only installation and an offline shell;
    // the application works without it.
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
