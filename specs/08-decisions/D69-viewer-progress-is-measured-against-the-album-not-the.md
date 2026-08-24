# D69 — Viewer progress is measured against the album, not the loaded list

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** The viewer displayed `index + 1 / items.length`. `items` is the
**paginated** list: it grows during scrolling and preloading. The denominator
therefore increased along the way — "40 / 50" became "40 / 100" before the
viewer, then "40 / 150". The counter was only accurate after the last page had
been reached.

**Choice.** The denominator is `album.itemCount`, passed to the viewer as `total`.
This is the count the server maintains for the album, independent of what is
loaded and already displayed in the page subtitle. The render uses
`Math.max(total, items.length)`: a synchronisation adding media while someone is
browsing must not produce "60 / 50".

**Rejected.** Hiding the counter until pagination is complete: the middle of a
long album is exactly where someone wants to know their position. Also rejected:
loading the entire album when opening the viewer to make `items.length` exact —
thousands of rows to display one number.

**Consequences.** Progress becomes a bar, accompanied by the numeric ratio. A
ratio of two numbers must be read; a bar can be seen. It is attached to the
**top edge** of the viewer, across its full width and two pixels thick: placed
lower in the header flow, it crossed the photo with a coloured line. At the edge,
it reads as a progress bar and does not compete with the image.
