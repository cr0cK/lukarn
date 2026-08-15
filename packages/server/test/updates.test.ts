import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHECK_INTERVAL_MS,
  RETRY_INTERVAL_MS,
  UpdateChecker,
  isNewer,
  parseVersion,
} from '../src/updates.js';

/**
 * Whether a newer version exists, and — more importantly — how rarely the question
 * is asked.
 *
 * The invariants here are the ones an operator is entitled to: an instance that
 * announces nothing when it cannot read its own version, one that contacts nobody
 * when the check is switched off, and one that does not turn an unreachable host
 * into a request per click.
 */

const FEED = 'https://example.test/releases/latest';

/** A release feed answering with one tag, counting how often it is asked. */
function feed(tag: string): { fetch: typeof globalThis.fetch; calls: () => number } {
  let calls = 0;
  const fetch = (async () => {
    calls++;
    return new Response(
      JSON.stringify({ tag_name: tag, html_url: `https://example.test/${tag}` }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls: () => calls };
}

/** A feed nobody can reach. Counted the same way. */
function unreachable(): { fetch: typeof globalThis.fetch; calls: () => number } {
  let calls = 0;
  const fetch = (async () => {
    calls++;
    throw new Error('connection refused');
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls: () => calls };
}

const silent = { warn: () => {}, debug: () => {} };

describe('reading a version', () => {
  it('reads three numbers, with or without the tag prefix', () => {
    assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
    assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  });

  it('refuses everything that is not exactly three numbers', () => {
    // A pre-release must never be offered to an instance in service, and a build
    // outside a release has nothing to compare against.
    for (const value of ['dev', '1.2', '1.2.3-rc.1', 'main', '']) {
      assert.equal(parseVersion(value), null, value);
    }
  });
});

describe('comparing two versions', () => {
  it('compares numbers, not text', () => {
    // The classic silent failure: as strings, "1.10.0" sorts below "1.9.0", and a
    // project stops announcing its updates on reaching its tenth minor release.
    assert.equal(isNewer('1.10.0', '1.9.0'), true);
    assert.equal(isNewer('1.9.0', '1.10.0'), false);
  });

  it('recognises a newer version at each rank', () => {
    assert.equal(isNewer('2.0.0', '1.9.9'), true);
    assert.equal(isNewer('1.1.0', '1.0.9'), true);
    assert.equal(isNewer('1.0.1', '1.0.0'), true);
  });

  it('reports nothing for the same version, an older one, or an unreadable one', () => {
    assert.equal(isNewer('1.0.0', '1.0.0'), false);
    assert.equal(isNewer('0.9.0', '1.0.0'), false);
    assert.equal(isNewer('1.1.0', 'dev'), false);
    assert.equal(isNewer('nightly', '1.0.0'), false);
  });
});

describe('asking the release feed', () => {
  it('reports the newer release and where to read about it', async () => {
    const source = feed('v1.1.0');
    const checker = new UpdateChecker({
      currentVersion: '1.0.0',
      url: FEED,
      log: silent,
      fetch: source.fetch,
    });

    assert.deepEqual(await checker.available(), {
      version: '1.1.0',
      url: 'https://example.test/v1.1.0',
    });
  });

  it('reports nothing when the published release is the one running', async () => {
    const source = feed('v1.0.0');
    const checker = new UpdateChecker({
      currentVersion: '1.0.0',
      url: FEED,
      log: silent,
      fetch: source.fetch,
    });

    assert.equal(await checker.available(), null);
  });

  it('contacts nobody when the check is switched off', async () => {
    const source = feed('v9.9.9');
    const checker = new UpdateChecker({
      currentVersion: '1.0.0',
      url: null,
      log: silent,
      fetch: source.fetch,
    });

    assert.equal(await checker.available(), null);
    // The point of an empty URL: not a hidden request whose answer is discarded.
    assert.equal(source.calls(), 0);
  });

  it('contacts nobody from a build whose version cannot be read', async () => {
    const source = feed('v9.9.9');
    const checker = new UpdateChecker({
      currentVersion: 'dev',
      url: FEED,
      log: silent,
      fetch: source.fetch,
    });

    assert.equal(await checker.available(), null);
    // `pnpm dev` and every local build: nothing to compare against, so nothing
    // to ask, and no developer machine calling GitHub on every page load.
    assert.equal(source.calls(), 0);
  });

  it('asks once, then serves the same answer for six hours', async () => {
    const source = feed('v1.1.0');
    let now = 1_000_000;
    const checker = new UpdateChecker({
      currentVersion: '1.0.0',
      url: FEED,
      log: silent,
      fetch: source.fetch,
      now: () => now,
    });

    await checker.available();
    await checker.available();
    assert.equal(source.calls(), 1);

    now += CHECK_INTERVAL_MS - 1;
    await checker.available();
    assert.equal(source.calls(), 1);

    now += 2;
    await checker.available();
    assert.equal(source.calls(), 2);
  });

  it('joins the request already in flight rather than starting a second', async () => {
    const source = feed('v1.1.0');
    const checker = new UpdateChecker({
      currentVersion: '1.0.0',
      url: FEED,
      log: silent,
      fetch: source.fetch,
    });

    // Administration and the account menu ask within milliseconds of each other.
    const [first, second] = await Promise.all([checker.available(), checker.available()]);
    assert.deepEqual(first, second);
    assert.equal(source.calls(), 1);
  });

  it('says nothing rather than failing when the feed is unreachable', async () => {
    const source = unreachable();
    const checker = new UpdateChecker({
      currentVersion: '1.0.0',
      url: FEED,
      log: silent,
      fetch: source.fetch,
    });

    assert.equal(await checker.available(), null);
  });

  it('waits half an hour before re-asking an unreachable feed', async () => {
    const source = unreachable();
    let now = 1_000_000;
    const checker = new UpdateChecker({
      currentVersion: '1.0.0',
      url: FEED,
      log: silent,
      fetch: source.fetch,
      now: () => now,
    });

    await checker.available();
    await checker.available();
    // Without the negative cache, an instance cut off from the outside would open
    // a socket for every page that shows the line.
    assert.equal(source.calls(), 1);

    now += RETRY_INTERVAL_MS + 1;
    await checker.available();
    assert.equal(source.calls(), 2);
  });

  it('ignores a payload that is not a release', async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof globalThis.fetch;
    const checker = new UpdateChecker({
      currentVersion: '1.0.0',
      url: FEED,
      log: silent,
      fetch,
    });

    assert.equal(await checker.available(), null);
  });
});
