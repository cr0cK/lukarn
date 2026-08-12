/**
 * Size of libuv's thread pool, to be set **before** any I/O.
 *
 * Node uses this pool for sharp image decoding, as well as file reads and
 * argon2 hashing. Its default size is four threads: four photos being processed
 * fill it completely, and everything else queues behind them — including a
 * cached thumbnail read, even though it only requires disk access.
 *
 * Measured on eight cores with twenty-four simultaneous renders, while querying
 * a cached thumbnail in parallel:
 *
 * | Pool | p95 for a request served from the cache |
 * | ---- | --------------------------------------- |
 * | 4    | 2,124 ms                                |
 * | 16   | 0.77 ms                                 |
 *
 * Render throughput is the same in both cases: the extra threads do not make
 * processing faster, but prevent long-running work from monopolising the pool
 * at the expense of short requests.
 *
 * The entry point must import this module **first**. Node reads the variable when
 * the pool is first used, not at startup: setting it after a file read would no
 * longer have any effect.
 */

/** Enough to ensure that short requests never queue. */
const DEFAUT = 16;

function configurer(): number {
  const existant = Number(process.env.UV_THREADPOOL_SIZE);

  // A value already set by the operator takes precedence: it may have been
  // chosen for resource-constrained hosting.
  if (Number.isInteger(existant) && existant > 0) return existant;

  process.env.UV_THREADPOOL_SIZE = String(DEFAUT);
  return DEFAUT;
}

/**
 * The setting is applied when the module loads, rather than in a function called
 * from the entry point: in ESM, **all** imports are evaluated before the body of
 * the module that declares them. A call placed between two imports would
 * therefore run after them, and a single import opening a file would be enough
 * to freeze the value.
 */
export const threadPoolSize = configurer();
