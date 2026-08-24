# D16 — Cursor pagination rather than OFFSET

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

See [03](../03-data-model.md) for the mechanism.

**Rejected.** `LIMIT … OFFSET …`: a synchronisation that inserts media while the
user scrolls would shift the window, and the viewer would see photos again or
skip them. The cursor identifies a position in the sort order, not a rank.
