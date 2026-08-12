import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { unreadCount, unreadFeedCount } from '../src/lib/seenComments';

/**
 * Unread count in the badge.
 *
 * The calculation is subtraction, but its boundaries matter: the badge is the
 * only place that calls for attention, and a wrong number is much worse than
 * no number — either the thread is opened for nothing or a message is missed.
 */

describe('unread comments', () => {
  it('counts the difference from what has been read', () => {
    assert.equal(unreadCount(5, 2), 3);
  });

  it('considers everything unread without a marker', () => {
    // On the first visit, or in a browser that denies storage, the badge reports
    // the whole thread rather than hiding it.
    assert.equal(unreadCount(4, undefined), 4);
  });

  it('does not fall below zero', () => {
    // A deletion or hide can make the total fall below the marker. A value of
    // "-2" would be displayed as is.
    assert.equal(unreadCount(1, 3), 0);
  });

  it('reports nothing for a fully read thread', () => {
    assert.equal(unreadCount(3, 3), 0);
  });

  it('reports nothing for a photo without comments', () => {
    assert.equal(unreadCount(0, undefined), 0);
  });
});

/**
 * Unread items in the activity feed.
 *
 * The marker here is an identifier rather than a count: anything deleted since
 * the last visit must not appear as new, and an old message resurfacing on the
 * page must not light the badge again.
 */
describe('unread activity feed items', () => {
  it('counts only items beyond the marker', () => {
    assert.equal(unreadFeedCount([12, 11, 10, 9], 10), 2);
  });

  it('considers everything unread without a marker', () => {
    assert.equal(unreadFeedCount([3, 2, 1], 0), 3);
  });

  it('reports nothing when deletion emptied the top of the feed', () => {
    // The marker is 20 and the remaining messages are older: nothing has
    // arrived since, even though the feed's contents changed.
    assert.equal(unreadFeedCount([8, 7], 20), 0);
  });

  it('reports nothing for an empty feed', () => {
    assert.equal(unreadFeedCount([], 0), 0);
  });
});
