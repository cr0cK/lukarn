import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeZoomScale,
  HD_MAX_EDGE,
  isTap,
  offsetForCenter,
  TAP_SLOP_PX,
  viewCenter,
  visibleFraction,
  zoomPercent,
} from '../src/lib/zoom';

const MAX_SCALE = 8;

/** A 1200 px-wide frame, typical for a viewer on a laptop. */
function scaleFor(overrides: Partial<Parameters<typeof computeZoomScale>[0]> = {}) {
  return computeZoomScale({
    sourceWidth: 6000,
    sourceHeight: 4000,
    renderedWidth: 0,
    hdLoaded: false,
    displayedWidth: 1200,
    maxScale: MAX_SCALE,
    ...overrides,
  });
}

describe('computeZoomScale', () => {
  it('caps available resolution at the hd render rather than the file', () => {
    // The corrected defect: 6000 / 1200 would produce 5, a scale at which 6000
    // pixels would have to be painted using the 4096 produced by the server.
    const { availableWidth, pixelScale, limited } = scaleFor();
    assert.equal(availableWidth, HD_MAX_EDGE);
    assert.equal(pixelScale, HD_MAX_EDGE / 1200);
    assert.equal(limited, true);
  });

  it('applies the cap to the longest edge rather than the width', () => {
    // For a 4000 × 6000 portrait, the height reaches the cap, so available
    // width falls to 2731 rather than 4000.
    const { availableWidth, limited } = scaleFor({ sourceWidth: 4000, sourceHeight: 6000 });
    assert.equal(availableWidth, Math.round((4000 * HD_MAX_EDGE) / 6000));
    assert.equal(limited, true);
  });

  it('reports no limit when the file fits below the cap', () => {
    const { availableWidth, pixelScale, limited } = scaleFor({
      sourceWidth: 3000,
      sourceHeight: 2000,
    });
    assert.equal(availableWidth, 3000);
    assert.equal(pixelScale, 3000 / 1200);
    assert.equal(limited, false);
  });

  it('prefers the measured hd render over any estimate', () => {
    // If the server changes its cap, the measurement takes precedence, keeping
    // the mirrored constant from remaining wrong.
    const { availableWidth, pixelScale } = scaleFor({ hdLoaded: true, renderedWidth: 3000 });
    assert.equal(availableWidth, 3000);
    assert.equal(pixelScale, 3000 / 1200);
  });

  it('falls back to the received render when the index lacks dimensions', () => {
    const { availableWidth, pixelScale, limited } = scaleFor({
      sourceWidth: 0,
      sourceHeight: 0,
      renderedWidth: 2560,
    });
    assert.equal(availableWidth, 2560);
    assert.equal(pixelScale, 2560 / 1200);
    // Nothing is known about the file, so it is not claimed to be larger.
    assert.equal(limited, false);
  });

  it('offers no zoom until something is measured or known', () => {
    const { availableWidth, pixelScale } = scaleFor({ sourceWidth: 0, sourceHeight: 0 });
    assert.equal(availableWidth, 0);
    assert.equal(pixelScale, 1);
  });

  it('never falls below 1 or exceeds the zoom cap', () => {
    // A frame wider than the render would gain no detail from enlargement.
    assert.equal(scaleFor({ displayedWidth: 5000 }).pixelScale, 1);
    assert.equal(scaleFor({ displayedWidth: 200 }).pixelScale, MAX_SCALE);
  });
});

describe('zoomPercent', () => {
  it('shows 100% at exactly one rendered pixel per screen pixel', () => {
    const { pixelScale, availableWidth } = scaleFor();
    assert.equal(zoomPercent(1200, pixelScale, availableWidth), 100);
  });

  it('shows less than 100% when the zoom cap prevents showing every pixel', () => {
    // With 4096 available pixels in a 200 px frame, a scale of 20.5 would be
    // needed to paint them all, but zoom stops at 8.
    const { pixelScale, availableWidth } = scaleFor({ displayedWidth: 200 });
    assert.equal(pixelScale, MAX_SCALE);
    assert.equal(zoomPercent(200, pixelScale, availableWidth), 39);
  });

  it('exceeds 100% as soon as the browser interpolates', () => {
    const { availableWidth } = scaleFor();
    assert.equal(zoomPercent(1200, MAX_SCALE, availableWidth), 234);
  });
});

describe('position indicator', () => {
  const displayed = { width: 1000, height: 800 };
  const container = { width: 500, height: 400 };

  it('reports the visible fraction of the photo', () => {
    // At scale 2, the window covers half of each side.
    assert.equal(visibleFraction(displayed.width, container.width, 2), 0.25);
    assert.equal(visibleFraction(displayed.height, container.height, 2), 0.25);
  });

  it('never exceeds the whole photo', () => {
    // When the image is smaller than the window, the frame covers the whole
    // indicator without overflowing, otherwise it would point to a nonexistent area.
    assert.equal(visibleFraction(200, 500, 1), 1);
  });

  it('places the view at the centre when nothing is offset', () => {
    assert.deepEqual(viewCenter({ x: 0, y: 0 }, displayed, 2), { x: 0.5, y: 0.5 });
  });

  it('round-trips faithfully between offset and target point', () => {
    // This invariant makes the indicator interactive: what it displays and
    // what it controls must describe the same thing.
    for (const scale of [1.5, 2, 4]) {
      for (const offset of [
        { x: 0, y: 0 },
        { x: 120, y: -80 },
        { x: -333, y: 210 },
      ]) {
        const center = viewCenter(offset, displayed, scale);
        const retour = offsetForCenter(center, displayed, scale);
        assert.ok(Math.abs(retour.x - offset.x) < 1e-9, `x at scale ${scale}`);
        assert.ok(Math.abs(retour.y - offset.y) < 1e-9, `y at scale ${scale}`);
      }
    }
  });

  it('moves left when targeting the right side of the photo', () => {
    // The image slides under a fixed window, so targeting the right moves it back.
    const { x } = offsetForCenter({ x: 1, y: 0.5 }, displayed, 2);
    assert.ok(x < 0, 'the offset must be negative');
    assert.equal(x, -1000);
  });

  it('does not move for a click in the centre', () => {
    assert.deepEqual(offsetForCenter({ x: 0.5, y: 0.5 }, displayed, 3), { x: 0, y: 0 });
  });
});

describe('tap or drag', () => {
  const origin = { x: 400, y: 300 };

  it('recognises a completely still pointer', () => {
    assert.equal(isTap(origin, { x: 400, y: 300 }), true);
  });

  it('tolerates hand tremor below the threshold', () => {
    // Without this tolerance, no tap would ever be recognised from a finger or
    // stylus, which always moves by a pixel or two.
    assert.equal(isTap(origin, { x: 402, y: 299 }), true);
  });

  it('measures distance travelled rather than each axis separately', () => {
    // 3 and 4 pixels make 5 diagonally, exactly the threshold and still a tap.
    // Checked axis by axis, a movement of 4 on each would also pass even though
    // its distance is 5.66, making it a drag.
    assert.equal(isTap(origin, { x: origin.x + 3, y: origin.y + 4 }), true);
    assert.equal(isTap(origin, { x: origin.x + 4, y: origin.y + 4 }), false);
  });

  it('treats a short slow drag as a drag', () => {
    // Duration does not matter because only displacement decides; otherwise a
    // deliberately started movement would eventually zoom out.
    assert.equal(isTap(origin, { x: origin.x + TAP_SLOP_PX + 1, y: origin.y }), false);
  });

  it('accepts a threshold supplied by the caller', () => {
    assert.equal(isTap(origin, { x: origin.x + 10, y: origin.y }, 12), true);
    assert.equal(isTap(origin, { x: origin.x + 10, y: origin.y }, 8), false);
  });

  it('ignores movement direction', () => {
    for (const [dx, dy] of [
      [TAP_SLOP_PX + 1, 0],
      [-TAP_SLOP_PX - 1, 0],
      [0, TAP_SLOP_PX + 1],
      [0, -TAP_SLOP_PX - 1],
    ] as const) {
      assert.equal(isTap(origin, { x: origin.x + dx, y: origin.y + dy }), false, `${dx}, ${dy}`);
    }
  });
});
