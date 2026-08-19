import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LoginThrottle } from '../src/throttle.js';

/**
 * Login attempt throttling. Each rejected attempt costs a deliberately slow
 * argon2 verification: anything not throttled here consumes CPU on the VPS.
 */

const now = 1_700_000_000_000;

const depuis = (ip: string, username: string): { ip: string; username: string } => ({
  ip,
  username,
});

describe('login throttling', () => {
  it('allows the first typing mistakes', () => {
    const throttle = new LoginThrottle();
    const moi = depuis('10.0.0.1', 'alexis');

    for (let essai = 0; essai < 5; essai++) {
      assert.equal(throttle.blockedFor(moi, now), 0);
      throttle.fail(moi, now);
    }
    assert.equal(throttle.blockedFor(moi, now), 0);

    throttle.fail(moi, now);
    assert.ok(throttle.blockedFor(moi, now) > 0);
  });

  it('doubles the delay for each additional failure', () => {
    const throttle = new LoginThrottle();
    const moi = depuis('10.0.0.1', 'alexis');

    for (let essai = 0; essai < 6; essai++) throttle.fail(moi, now);
    const premier = throttle.blockedFor(moi, now);

    throttle.fail(moi, now);
    assert.equal(throttle.blockedFor(moi, now), premier * 2);
  });

  it('forgets an old series', () => {
    const throttle = new LoginThrottle();
    const moi = depuis('10.0.0.1', 'alexis');
    for (let essai = 0; essai < 8; essai++) throttle.fail(moi, now);

    assert.equal(throttle.blockedFor(moi, now + 2 * 60 * 60 * 1000), 0);
  });

  it('leaves another visitor on another account unaffected', () => {
    const throttle = new LoginThrottle();
    for (let essai = 0; essai < 8; essai++) throttle.fail(depuis('10.0.0.1', 'alexis'), now);

    assert.equal(throttle.blockedFor(depuis('10.0.0.2', 'famille'), now), 0);
  });

  it('throttles an address trying random usernames', () => {
    const throttle = new LoginThrottle();

    // Each attempt uses a new username, so no pair counter exceeds one attempt.
    // Without a per-address limit, the attacker gets as many argon2
    // verifications as they request.
    for (let essai = 0; essai < 40; essai++) {
      throttle.fail(depuis('10.0.0.66', `inconnu-${essai}`), now);
    }

    assert.ok(
      throttle.blockedFor(depuis('10.0.0.66', 'encore-un-autre'), now) > 0,
      'the address must be throttled regardless of the supplied username',
    );
    // A visitor from elsewhere must not pay for it.
    assert.equal(throttle.blockedFor(depuis('10.0.0.7', 'alexis'), now), 0);
  });

  it('throttles a distributed attack against one account', () => {
    const throttle = new LoginThrottle();

    // Each attempt uses a different address, so neither the pair nor the
    // address sees a pattern; only the targeted account accumulates failures.
    for (let essai = 0; essai < 20; essai++) {
      throttle.fail(depuis(`203.0.113.${essai}`, 'alexis'), now);
    }

    assert.ok(throttle.blockedFor(depuis('198.51.100.9', 'alexis'), now) > 0);
    assert.equal(throttle.blockedFor(depuis('198.51.100.9', 'famille'), now), 0);
  });

  it('applies the strictest of the three dimensions', () => {
    const throttle = new LoginThrottle();
    const moi = depuis('10.0.0.1', 'alexis');

    // Six failures for the pair activate a penalty while the username counter
    // (10 free attempts) and address counter (20) are still inactive.
    for (let essai = 0; essai < 6; essai++) throttle.fail(moi, now);

    assert.ok(throttle.blockedFor(moi, now) > 0);
  });

  it('releases the legitimate visitor after a successful login', () => {
    const throttle = new LoginThrottle();
    const moi = depuis('10.0.0.1', 'alexis');
    for (let essai = 0; essai < 8; essai++) throttle.fail(moi, now);
    assert.ok(throttle.blockedFor(moi, now) > 0);

    throttle.succeed(moi);
    assert.equal(throttle.blockedFor(moi, now), 0);
  });

  it('does not let a valid account clear the record for its address', () => {
    const throttle = new LoginThrottle();

    for (let essai = 0; essai < 40; essai++) {
      throttle.fail(depuis('10.0.0.66', `inconnu-${essai}`), now);
    }
    // The attacker owns an account on the instance and logs into it to reset
    // counters between bursts.
    throttle.succeed(depuis('10.0.0.66', 'complice'));

    assert.ok(throttle.blockedFor(depuis('10.0.0.66', 'inconnu-suivant'), now) > 0);
  });

  /**
   * A public route answering the same thing to every caller has no username to be
   * blocked on: a `429` keyed to an address is the oracle that answer exists to
   * close. What it has instead is one counter for the caller, moved by the call
   * itself rather than by what the call turned out to be about.
   */
  it('counts a call against its caller and against no account', () => {
    const throttle = new LoginThrottle();

    for (let call = 0; call < 21; call++) throttle.countCall('10.0.0.5', now);

    assert.ok(throttle.blockedForIp('10.0.0.5', now) > 0);
    // Nothing was asserted about an account, so no account carries a penalty: the
    // same one reached from elsewhere is as free as it was.
    assert.equal(throttle.blockedFor({ ip: '10.0.0.6', username: 'alexis' }, now), 0);
  });

  it('spends the same allowance as a failed sign-in from that address', () => {
    const throttle = new LoginThrottle();

    // Twenty failures leave the address one below its threshold, which is where an
    // attacker parks it before asking whether one address is known here.
    for (let attempt = 0; attempt < 20; attempt++) {
      throttle.fail({ ip: '10.0.0.66', username: `unknown-${attempt}` }, now);
    }
    assert.equal(throttle.blockedForIp('10.0.0.66', now), 0);

    throttle.countCall('10.0.0.66', now);

    // One shared counter, so the twenty-first call costs what the twenty-first
    // failure would have. A counter of its own would answer, one call later, the
    // question the uniform response refused.
    assert.ok(throttle.blockedForIp('10.0.0.66', now) > 0);
  });

  it('forgets expired counters when asked to clean up', () => {
    const throttle = new LoginThrottle();
    for (let essai = 0; essai < 500; essai++) {
      throttle.fail(depuis('10.0.0.66', `inconnu-${essai}`), now);
    }
    assert.ok(throttle.size > 500);

    const oublies = throttle.purge(now + 2 * 60 * 60 * 1000);

    assert.ok(oublies > 0);
    assert.equal(throttle.size, 0, 'no series should survive its expiry');
  });

  it('bounds its table even without clean-up', () => {
    const throttle = new LoginThrottle();

    // A burst far larger than the limit within a rolling hour gives the hourly
    // purge nothing to remove, so the limit itself must hold.
    for (let essai = 0; essai < 40_000; essai++) {
      throttle.fail(depuis(`198.51.${essai % 256}.${essai % 251}`, `inconnu-${essai}`), now);
    }

    assert.ok(throttle.size <= 20_000, `unbounded table: ${throttle.size} entries`);
  });
});
