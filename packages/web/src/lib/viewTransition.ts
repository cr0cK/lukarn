/**
 * The name both halves of the shared element carry, one at a time.
 *
 * A view transition name must be **unique in the document** while a snapshot is
 * taken: two elements holding it produce no animation at all, silently. The grid
 * stays mounted behind the viewer, so the thumbnail wears the name only for the
 * old snapshot and the viewer takes it for the new one.
 */
export const SHARED_MEDIA = 'lukarn-open-media';

/**
 * Attribute marking a thumbnail with the media it shows, so the element to
 * animate from can be found without threading a ref through the virtualiser.
 */
export const MEDIA_ID_ATTRIBUTE = 'data-media-id';

/**
 * `startViewTransition` as this repository's TypeScript library knows it — which
 * is not at all in the version shipping today, and as a different shape in the
 * versions that do know it. Declared here rather than widened globally: one
 * module needs it, and a global augmentation would silently stop matching the
 * day the DOM types catch up.
 */
type StartViewTransition = (update: () => void) => { finished: Promise<void> };

/**
 * Runs a DOM update as a view transition growing a thumbnail into the viewer.
 *
 * Opening a photo used to be a cut: the grid disappeared and a full-screen image
 * replaced it, with nothing saying which of the two hundred thumbnails had been
 * touched. Carrying the tile itself into place answers that without a word, and
 * it is the movement every native gallery makes.
 *
 * **Detected at runtime, and everything still works without it.** The build
 * targets `chrome79` (`vite.config.ts`), where `startViewTransition` does not
 * exist; there the update simply runs, exactly as it did before. Same under
 * `prefers-reduced-motion`, where a photo flying across the screen is precisely
 * what the setting asks to stop.
 *
 * `update` is expected to apply the change **synchronously** — React needs a
 * `flushSync` around its state update — because the browser takes the second
 * snapshot as soon as the callback returns.
 */
export function openWithSharedElement(mediaId: string, update: () => void): void {
  const start = (document as unknown as { startViewTransition?: StartViewTransition })
    .startViewTransition;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const from = document.querySelector<HTMLElement>(
    `[${MEDIA_ID_ATTRIBUTE}="${CSS.escape(mediaId)}"]`,
  );

  if (!start || reduced || !from) {
    update();
    return;
  }

  from.style.viewTransitionName = SHARED_MEDIA;
  const transition = start.call(document, () => {
    // Release the name inside the callback: by the time the new snapshot is
    // taken, the viewer's image must be the only element carrying it, and the
    // thumbnail is still in the document behind the viewer.
    from.style.viewTransitionName = '';
    update();
  });

  // The thumbnail keeps no inline style once it is over, including when the
  // transition is skipped — a tab hidden mid-animation rejects `finished`.
  void transition.finished
    .catch(() => undefined)
    .then(() => {
      from.style.viewTransitionName = '';
    });
}
