# D32 — Throttled renders and an enlarged thread pool

**Confidence.** observed — media/semaphore.ts, git ls-files → exit 0 · 2026-08-23

**Context.** Opening a grid whose thumbnails are not yet cached triggers one
render per visible photo. Each loads the entire original into memory — nine
megabytes for a typical camera photo — then decodes and re-encodes it. The
question was: does the server remain available to other visitors during this
work?

**Measurements.** Benchmark on eight cores, with twenty-four simultaneous
renders of a 4,000 × 3,000, 9 MB photo, while querying a thumbnail **already in
the cache** in parallel — the path of a visitor who is only browsing.

| Configuration                   | p95 of the request served from the cache | Process memory |
| ------------------------------- | ---------------------------------------- | -------------- |
| Pool 4 (Node default), no limit | 2,124 ms                                 | +336 MB        |
| Pool 4, with limit              | 2,344 ms                                 | +117 MB        |
| Pool 16, with limit             | **0.25 ms**                              | **+117 MB**    |

The total rendering throughput is identical in all three cases: these settings
do not make the work faster; they prevent long-running processing from taking
resources away from short requests.

**Decision.** Two fixes, addressing two distinct problems.

- **A simultaneous-render limiter** (`media/semaphore.ts`), sized at `cpus - 2`
  and bounded between 2 and 4. The slot is taken **before** the download:
  waiting for a turn with the original already in memory would limit nothing.
  This is what divides memory use by three.
- **A thread pool of 16** (`threadpool.ts`). Image decoding, file reads and
  argon2 share libuv's pool, whose default size is four: a few renders fill it,
  and a simple thumbnail read waits behind them. This is what brings latency
  down from two seconds to a quarter of a millisecond.

**Rejected.** Moving processing to separate processes (`worker_threads`,
external queue): sharp already works outside the main thread — event-loop lag
remained below 2 ms in all measurements — so the problem was not blocking but
resource sharing. A process pool would add serialisation, memory use and
supervision for a gain that the measurements do not show.

Also rejected: setting the pool from the entry point after imports. Node reads
the variable on the pool's first use; in ESM, all imports are evaluated before
the module body, and a single one opening a file would be enough to lock in the
value. Hence a dedicated module, imported first, that acts when loaded.

**Consequences.** The `Dockerfile` also sets `UV_THREADPOOL_SIZE=16` — redundant
with the module, but visible to operations and robust if the import order ever
changes. A value already present in the environment takes precedence.

On an entirely cold grid, the total time to display all thumbnails remains the
same; visitors browsing something else no longer pay the cost.
