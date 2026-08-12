import { COMMENT_EDIT_WINDOW_MS, remainingEditMs } from '@lukarn/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Comment editing window.
 *
 * The calculation is shared between the server, which rejects, and the front
 * end, which stops offering the action. Two separate implementations would
 * eventually differ by a second, exactly the gap where a button is clicked and
 * responds with a refusal.
 */

const PUBLIE = '2026-08-07T12:00:00.000Z';
const publieA = Date.parse(PUBLIE);

describe('remaining editing time', () => {
  it('leaves the full window at publication', () => {
    assert.equal(remainingEditMs(PUBLIE, publieA), COMMENT_EDIT_WINDOW_MS);
  });

  it('subtracts elapsed time', () => {
    assert.equal(remainingEditMs(PUBLIE, publieA + 10_000), COMMENT_EDIT_WINDOW_MS - 10_000);
  });

  it('closes exactly at the deadline', () => {
    // The boundary is closed on the rejection side: at the exact instant there
    // is nothing left to offer, otherwise the front end would show "Edit (0s)".
    assert.equal(remainingEditMs(PUBLIE, publieA + COMMENT_EDIT_WINDOW_MS), 0);
  });

  it('never returns a negative value', () => {
    // Without this floor, the front end would show a countdown into the past
    // on every old comment.
    assert.equal(remainingEditMs(PUBLIE, publieA + 3_600_000), 0);
  });

  it('closes the window for an unreadable date', () => {
    // A date the server could not have written must not grant write access:
    // when in doubt, reject it.
    assert.equal(remainingEditMs('pas une date', publieA), 0);
  });

  it('tolerates a slow clock without making the window unlimited', () => {
    // Browser and server clocks may differ, making the countdown generous by a
    // few seconds but never unlimited — the server ultimately decides.
    const restant = remainingEditMs(PUBLIE, publieA - 5_000);
    assert.ok(restant > COMMENT_EDIT_WINDOW_MS);
    assert.equal(restant, COMMENT_EDIT_WINDOW_MS + 5_000);
  });
});
