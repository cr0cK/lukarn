import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COMMIT_FRACTION,
  EDGE_RESISTANCE,
  FLICK_VELOCITY,
  decideSwipe,
  resistAtEdge,
  settleDuration,
} from '../src/lib/swipeTrack';

/**
 * What a swipe becomes once the finger is lifted.
 *
 * Thresholds are the heart of the gesture: too high and changing photo requires
 * crossing the screen; too low and diagonal scrolling skips an image. These
 * tests cover gesture invariants, not the values themselves.
 */

/** Typical width of a phone in portrait. */
const WIDTH = 390;

describe('swipe decision', () => {
  it('moves to the neighbour once the expected fraction is crossed', () => {
    const dx = -(WIDTH * COMMIT_FRACTION + 1);
    const towards = decideSwipe({ dx, velocity: 0, width: WIDTH, canPrev: true, canNext: true });
    assert.equal(towards, 1);
  });

  it('preserves gesture direction: right goes backwards', () => {
    const dx = WIDTH * COMMIT_FRACTION + 1;
    const towards = decideSwipe({ dx, velocity: 0, width: WIDTH, canPrev: true, canNext: true });
    assert.equal(towards, -1);
  });

  it('returns to place when the finger has not moved far enough', () => {
    const dx = -(WIDTH * COMMIT_FRACTION - 1);
    const towards = decideSwipe({ dx, velocity: 0, width: WIDTH, canPrev: true, canNext: true });
    assert.equal(towards, 0);
  });

  it('accepts a sharp flick that travels almost no distance', () => {
    // This phone thumb gesture is quick, short and performed without looking.
    // Rejecting it would require a deliberate drag from end to end.
    const towards = decideSwipe({
      dx: -30,
      velocity: -(FLICK_VELOCITY + 0.1),
      width: WIDTH,
      canPrev: true,
      canNext: true,
    });
    assert.equal(towards, 1);
  });

  it('ignores velocity opposite to the displacement', () => {
    // A finger moves left and doubles back at the last moment: this is a
    // cancellation, and reading it as a flick would confirm exactly the
    // opposite of what was just done.
    const towards = decideSwipe({
      dx: -30,
      velocity: FLICK_VELOCITY + 0.5,
      width: WIDTH,
      canPrev: true,
      canNext: true,
    });
    assert.equal(towards, 0);
  });

  it('does not mistake a tremor for a flick', () => {
    const towards = decideSwipe({
      dx: -4,
      velocity: -2,
      width: WIDTH,
      canPrev: true,
      canNext: true,
    });
    assert.equal(towards, 0);
  });

  it('never leaves the album regardless of gesture magnitude', () => {
    for (const velocity of [0, -3, 3]) {
      assert.equal(
        decideSwipe({ dx: -WIDTH, velocity, width: WIDTH, canPrev: true, canNext: false }),
        0,
        'no photo after the last one',
      );
      assert.equal(
        decideSwipe({ dx: WIDTH, velocity, width: WIDTH, canPrev: false, canNext: true }),
        0,
        'no photo before the first one',
      );
    }
  });

  it('moves nowhere when the finger remained still', () => {
    const towards = decideSwipe({ dx: 0, velocity: 0, width: WIDTH, canPrev: true, canNext: true });
    assert.equal(towards, 0);
  });
});

describe('edge resistance', () => {
  it('lets the track follow the finger while a photo exists on that side', () => {
    assert.equal(resistAtEdge(-120, true, true), -120);
    assert.equal(resistAtEdge(120, true, true), 120);
  });

  it('resists without blocking at the first and last media item', () => {
    // The gesture is still received so the edge can be felt, but it leads nowhere.
    assert.equal(resistAtEdge(120, false, true), 120 * EDGE_RESISTANCE);
    assert.equal(resistAtEdge(-120, true, false), -120 * EDGE_RESISTANCE);
  });

  it('resists only on the missing side', () => {
    assert.equal(resistAtEdge(-120, false, true), -120);
    assert.equal(resistAtEdge(120, true, false), 120);
  });
});

describe('settling duration', () => {
  it('extends the gesture instead of replacing it with a fixed duration', () => {
    // At equal distance, a faster finger should make the track finish sooner.
    const lent = settleDuration(300, 0.2);
    const vif = settleDuration(300, 2);
    assert.ok(vif < lent, `${vif} should be shorter than ${lent}`);
  });

  it('stays within usable bounds even at extreme velocity', () => {
    for (const velocity of [0, 0.01, 1, 50]) {
      for (const distance of [0, 40, 400, 4000]) {
        const duration = settleDuration(distance, velocity);
        assert.ok(duration >= 160 && duration <= 320, `duration out of bounds: ${duration}`);
      }
    }
  });

  it('ignores the sign of the remaining displacement', () => {
    assert.equal(settleDuration(-250, 0.8), settleDuration(250, 0.8));
  });
});
