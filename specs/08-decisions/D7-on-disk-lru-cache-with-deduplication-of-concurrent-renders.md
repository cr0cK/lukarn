# D7 — On-disk LRU cache with deduplication of concurrent renders

**Context.** Opening an album triggers dozens of thumbnail requests at once; producing a
thumbnail requires a Drive download and sharp decoding.

**Decision.** One file per entry under `CACHE_DIR`, with the key
`sha256("<fileId>:<variant>")` distributed across 256 subdirectories, and an inventory
of sizes and last access times kept **in memory**; LRU eviction continues until 90% of
the limit is reached. `MediaRenderer.inFlight` tracks ongoing renders by key: ten
simultaneous requests for the same thumbnail trigger only one download.

**Rejected.** Relying on the file system's `atime` for LRU ordering: on a `relatime`
mount — the default on most VPSs — it is not updated in a usable way. Also rejected:
evicting precisely to the limit, which would trigger an eviction on every subsequent
write; hence the 90% threshold.

**Consequences.** The inventory is rebuilt on startup by `MediaCache.load()`, which also
cleans up `.tmp` files left by interrupted writes. **A file placed in the cache while
the server is running remains invisible until restart** — this is the documented
`seed-demo` trap. Writes go through a temporary file followed by an atomic `rename`: a
concurrent reader never sees a partial file.

No invalidation is planned: the key contains the Drive file ID.
