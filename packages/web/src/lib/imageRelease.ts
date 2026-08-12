/**
 * Cancels loading an image nobody is viewing any more.
 *
 * Removing an `<img>` from the DOM **does not cancel** its request: the browser
 * completes it, and an unseen image continues occupying one of the six
 * connections HTTP/1.1 grants an origin. Clearing `src` actually stops the request.
 *
 * The `isConnected` check is not stylistic caution: `StrictMode` replays
 * mount/unmount without touching the DOM, and without it first-screen thumbnails
 * lost their `src` as they appeared — React does not rewrite it because its DOM
 * view considers it unchanged.
 *
 * This belongs in `lib/`, not the component where it arose: both the grid and
 * viewer depend on it for the same reason and at the same cost.
 */
export function releaseIfDetached(image: HTMLImageElement | null): void {
  if (image && !image.isConnected) image.removeAttribute('src');
}
