import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { previewOverlay } from '../src/lib/preview';

/**
 * What is displayed while a photo is being prepared.
 *
 * A previous regression showed the blurred preview **without** an indicator.
 * Nothing signalled a wait, so opening looked like a blurry photo rather than
 * one that was loading — and the defect disappeared whenever the render was
 * already cached, making it seem "random".
 */

describe('display while loading', () => {
  it('shows the preview and indicator together', () => {
    // This is the invariant that regressed: never show silent blur.
    const overlay = previewOverlay({ loaded: false, failed: false, measured: true });

    assert.equal(overlay.placeholder, true);
    assert.equal(overlay.spinner, true);
    assert.equal(overlay.error, false);
  });

  it('signals waiting even without a preview to show', () => {
    // Unknown dimensions leave nothing to position, but a silent black screen
    // would be even more confusing than a blurred preview.
    const overlay = previewOverlay({ loaded: false, failed: false, measured: false });

    assert.equal(overlay.placeholder, false);
    assert.equal(overlay.spinner, true);
  });

  it('removes both as soon as the photo is ready', () => {
    const overlay = previewOverlay({ loaded: true, failed: false, measured: true });

    assert.equal(overlay.placeholder, false);
    assert.equal(overlay.spinner, false);
    assert.equal(overlay.error, false);
  });

  it('does not announce a wait that will not happen', () => {
    // On failure, the indicator would spin indefinitely and the blurred preview
    // would imply that the photo will eventually arrive.
    const overlay = previewOverlay({ loaded: false, failed: true, measured: true });

    assert.equal(overlay.error, true);
    assert.equal(overlay.spinner, false);
    assert.equal(overlay.placeholder, false);
  });

  it('lets failure take precedence over completed loading', () => {
    // The `hd` render may fail after the screen render appears: reporting that
    // is better than implying the image is complete.
    const overlay = previewOverlay({ loaded: true, failed: true, measured: true });
    assert.equal(overlay.error, true);
  });

  it('stops the indicator for a render that failed before measurement', () => {
    // Nothing can be positioned or blurred, leaving only the message. This
    // combination represents a render rejected before its dimensions were
    // known — otherwise the indicator would spin on a permanently empty screen.
    const overlay = previewOverlay({ loaded: false, failed: true, measured: false });

    assert.equal(overlay.error, true);
    assert.equal(overlay.spinner, false);
  });

  it('never shows two states at once', () => {
    for (const loaded of [false, true]) {
      for (const failed of [false, true]) {
        for (const measured of [false, true]) {
          const { placeholder, spinner, error } = previewOverlay({ loaded, failed, measured });
          if (error) {
            assert.ok(!placeholder && !spinner, 'failure excludes both preview and indicator');
          }
          if (placeholder) {
            assert.ok(spinner, 'a blurred preview without an indicator looks like a defect');
          }
        }
      }
    }
  });
});
