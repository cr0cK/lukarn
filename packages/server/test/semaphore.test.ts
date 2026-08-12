import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Semaphore, renderConcurrencyFor } from '../src/media/semaphore.js';
import { threadPoolSize } from '../src/threadpool.js';

/**
 * Limiting concurrent rendering.
 *
 * Without it, opening a grid whose thumbnails are not cached starts as many
 * processes as there are visible photos, each loading the entire original into
 * memory. Measured: over 300 MB for twenty-four renders, against 117 MB once
 * limited, with identical throughput.
 */

/** Promise whose resolution time is controlled for testing. */
function differee(): { promesse: Promise<void>; resoudre: () => void } {
  let resoudre!: () => void;
  const promesse = new Promise<void>((ok) => {
    resoudre = ok;
  });
  return { promesse, resoudre };
}

describe('Semaphore', () => {
  it('runs no more tasks than the limit', async () => {
    const semaphore = new Semaphore(2);
    const portes = [differee(), differee(), differee(), differee()];
    let demarrees = 0;
    let maxSimultanees = 0;
    let enCours = 0;

    const taches = portes.map((porte) =>
      semaphore.run(async () => {
        demarrees++;
        enCours++;
        maxSimultanees = Math.max(maxSimultanees, enCours);
        await porte.promesse;
        enCours--;
      }),
    );

    // Lets admitted tasks start.
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(demarrees, 2, 'only two tasks should have started');
    assert.equal(semaphore.enAttente, 2);

    for (const porte of portes) porte.resoudre();
    await Promise.all(taches);

    assert.equal(maxSimultanees, 2);
    assert.equal(semaphore.enCours, 0);
  });

  it('releases the slot even when the task fails', async () => {
    // Without this safeguard, repeated errors — an unreachable Drive, for
    // example — would reduce capacity until all rendering stopped permanently.
    const semaphore = new Semaphore(1);

    await assert.rejects(() => semaphore.run(() => Promise.reject(new Error('échec'))));
    assert.equal(semaphore.enCours, 0);

    assert.equal(await semaphore.run(() => Promise.resolve('passé')), 'passé');
  });

  it('serves tasks in arrival order', async () => {
    // A stack would make early grid thumbnails wait indefinitely while later
    // ones pass them.
    const semaphore = new Semaphore(1);
    const ordre: number[] = [];
    const porte = differee();

    const premiere = semaphore.run(async () => {
      await porte.promesse;
      ordre.push(0);
    });
    const suivantes = [1, 2, 3].map((n) =>
      semaphore.run(async () => {
        ordre.push(n);
      }),
    );

    porte.resoudre();
    await Promise.all([premiere, ...suivantes]);

    assert.deepEqual(ordre, [0, 1, 2, 3]);
  });

  it('rejects an absurd limit', () => {
    assert.throws(() => new Semaphore(0));
  });
});

describe('renderConcurrencyFor', () => {
  it('leaves two cores for the rest of the service', () => {
    // Cached files, the API and synchronisation must not wait behind image processing.
    assert.equal(renderConcurrencyFor(8), 4);
    assert.equal(renderConcurrencyFor(6), 4);
    assert.equal(renderConcurrencyFor(4), 2);
  });

  it('keeps at least two slots on a tiny machine', () => {
    // With one slot, a slow photo would delay the whole queue, including much
    // faster thumbnails.
    assert.equal(renderConcurrencyFor(1), 2);
    assert.equal(renderConcurrencyFor(2), 2);
  });

  it('does not run away on a large machine', () => {
    // Beyond this, gains stop — decoding already uses several cores per image —
    // while memory keeps growing.
    assert.equal(renderConcurrencyFor(32), 4);
  });
});

describe('thread pool', () => {
  it('is larger than the Node default', () => {
    // Four threads, the default, are saturated by a few renders: a cached
    // thumbnail then waits behind them, measured at 2 s at the 95th percentile.
    assert.ok(threadPoolSize >= 8, `pool too small: ${threadPoolSize}`);
    assert.equal(process.env.UV_THREADPOOL_SIZE, String(threadPoolSize));
  });
});
