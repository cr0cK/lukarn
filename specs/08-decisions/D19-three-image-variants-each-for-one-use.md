# D19 — Three image variants, each for one use

| Variant | Maximum side     | WebP quality | Use                |
| ------- | ---------------- | ------------ | ------------------ |
| `thumb` | 320 / 640 / 1280 | 78           | Grid, album covers |
| `full`  | 2560             | 82           | Full-screen viewer |
| `hd`    | 4096             | 88           | Zoom               |

**Context.** `full` at 2560 px fills a screen but does not allow a photo to be
examined at its native resolution; serving the 9 MB original for zooming is
disproportionate.

**Decision.** An `hd` variant capped at 4096 px, with more generous quality and a
size of a few hundred kilobytes. `withoutEnlargement` prevents pixels from being
invented: a 3000 px photo remains at 3000 px.

**Rejected.** Serving `/original` when zooming: several megabytes per photo,
decoded by the browser, without going through the disk cache. Also rejected: a
higher WebP `effort`, which costs hundreds of milliseconds per image when first
opened for a few percent reduction in size — hence `effort: 4`.

**Consequences.** The `ETag` must distinguish the variants (`"<id>-full"` vs
`"<id>-hd"`), otherwise they would share the same browser cache entry and zoom
would serve the low-resolution image again. On the frontend, `hd` is requested
only on the first zoom and loaded off-screen before being substituted
(`components/ZoomableImage.tsx`, see [07](../07-frontend.md)).
