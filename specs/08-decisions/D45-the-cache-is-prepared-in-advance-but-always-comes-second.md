# D45 — The cache is prepared in advance, but always comes second

> **Two points in this entry were revised by D58**: the pass now prepares
> **thumbnails**, not the `full` variant, and it **is** connected to the end of
> every synchronisation. The three safeguards below **remain in force** — they
> are the decision — but two of their justifications have become outdated. Read
> D58 before applying what follows.
>
> **Safeguard no. 1.** The render limiter does not have four fixed slots but
> `max(2, min(4, cores - 2))` (`renderConcurrencyFor`), which means **two** on the
> two-core VPS targeted by this project. The reasoning does not depend on this:
> prewarming never occupies more than one, whatever the total.
>
> **Safeguard no. 2.** The cited concern — full-page renders evicting grid
> thumbnails — **can no longer occur**: the pass only produces thumbnails. The
> 70% threshold remains useful, but it now protects something else: thumbnails
> for albums being viewed from those for albums being prepared.

**Context.** Measured on a live instance, with an album of 471 DSLR photos
(~8 MB each): opening a photo that has never been rendered takes **~3.5 s** —
around two seconds to download from Drive and one and a half to decode and encode
WebP — compared with **5 ms** once the derivative is cached. Preloading adjacent
photos in the viewer already covers browsing; it does not cover returning to the
grid and then opening a random photo, which is the common use case.

**Choice.** A background pass renders the `full` variant, from the newest photos
to the oldest, connected to hourly housekeeping and startup. Three safeguards,
and they are the decision — the principle itself is obvious:

1. **One photo at a time, with a one-second pause.** The render limiter has four
   slots; by never occupying more than one, prewarming always lets someone who is
   browsing through. Filling 471 photos then takes half an hour, which is the
   desired behaviour: there is nothing to gain by going fast; nobody is waiting.
2. **It stops at 70% of the cache.** Eviction is **global** LRU, not per album:
   without this reserved share, full-page renders (~1 MB) would evict grid
   thumbnails (~15 KB) — what people view most — for photos nobody requested.
   The rest of the cache belongs to what is actually viewed.
3. **The setting is reread for every photo.** `prewarmCache` is unchecked because
   it has just been found to get in the way; a switch that only takes effect on
   the next pass does not meet that need.

**Rejected.** Connecting it to the end of a synchronisation, which seemed
natural: automatic sync can be disabled — it is on an instance whose Drive
changes little — and the cache would then wait for a click to fill, which is
exactly what this seeks to eliminate. Also rejected: prewarming `hd`, which costs
twice as much and is only useful to people who zoom. Finally rejected: prewarming
the entire Drive at once on first startup — 471 photos amount to 3.7 GB downloaded,
a volume best spread out.

**On quota.** Prewarming does not consume _more_ Drive quota: those downloads
would happen anyway on the first click. It concentrates them, which makes retries
essential — hence the exponential backoff added to `fetchAuthorized` at the same
time. Without it, every `403 rateLimitExceeded` would leave a gap in the cache
that nothing would fill, and a broken thumbnail where the request would have
succeeded a second later.
