import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickThumbSize } from '../src/components/Thumb';
import { releaseIfDetached } from '../src/lib/imageRelease';

/** The minimum `<img>` shape observed by release. */
function vignette(isConnected: boolean) {
  const supprimes: string[] = [];
  return {
    supprimes,
    node: { isConnected, removeAttribute: (nom: string) => supprimes.push(nom) },
  };
}

describe('releaseIfDetached', () => {
  it('cancels the request for a thumbnail that left the grid', () => {
    // The protected invariant is that an unmounted thumbnail must stop making
    // network requests. Removing an `<img>` from the DOM is not enough because
    // the browser finishes the transfer, tying up one of six HTTP/1.1 origin
    // connections. Reversing a cold album abandoned dozens at once, leaving
    // the new order's `/items` waiting behind them on "Loading photos".
    const { node, supprimes } = vignette(false);

    releaseIfDetached(node as unknown as HTMLImageElement);

    assert.deepEqual(supprimes, ['src'], 'only `src` is cleared because it carries the request');
  });

  it('leaves a thumbnail still on screen intact', () => {
    // `StrictMode` replays mounting and unmounting without touching the DOM:
    // without this guard, first-screen thumbnails lost their `src` as they
    // appeared, and React never writes it again.
    const { node, supprimes } = vignette(true);

    releaseIfDetached(node as unknown as HTMLImageElement);

    assert.deepEqual(supprimes, []);
  });

  it('tolerates an absent node', () => {
    // A video tile or failed thumbnail has no `<img>` at all.
    assert.doesNotThrow(() => releaseIfDetached(null));
  });
});

describe('pickThumbSize', () => {
  it('covers the display size including density', () => {
    assert.equal(pickThumbSize(300, 1), 320);
    assert.equal(pickThumbSize(300, 2), 640);
  });

  it('caps the density taken into account at 2', () => {
    // Beyond this, four times the bytes would buy a difference the eye cannot
    // see on a grid thumbnail.
    assert.equal(pickThumbSize(300, 3), pickThumbSize(300, 2));
  });
});
