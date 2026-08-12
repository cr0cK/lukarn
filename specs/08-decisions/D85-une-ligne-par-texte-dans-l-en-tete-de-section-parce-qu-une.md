# D85 — One line per text in the section header, because reserved height must be exact

**Context.** Grid layout is calculated without the DOM: `useGridLayout` declares
each header's height, and `SectionHeader` must fit within it (D49). A day note
reserved **two** lines there — 40 px — although most day notes are short and use
only one. The extra 20 px fell below the text, changing the gap before thumbnails
from 12 px to 32 px between sections depending on note length. The defect is
visible in two adjacent sections and has no visible explanation.

**Choice.** One truncated line for the place **and** the note, and one constant —
`GRID_HEADER_LINE_HEIGHT` — for both. Reservation is exact by construction: what
layout counts is exactly what the component renders, whatever the text length.

**What the note loses and where it recovers it.** A 300-character note occupied
two lines in the grid; it now appears on one with an ellipsis. Its full text
remains in the `title` attribute, the `i` panel, and above all the **viewer strip**
(D84), which shows it at every width and expands it on click. This last doorway
makes the tradeoff tenable: when D49 set two lines, the grid was the only place
showing the note.

**Rejected.** Estimating line count from text length and available width, using
an upper bound on glyph width to avoid under-reserving. It works and preserved
two lines for long notes. But it is another constant to keep aligned with font
size, and an estimate correct "almost always": the day it underestimates,
thumbnails pass beneath the text with nothing to correct them. An exact contract
is better than a cautious estimate.

Also rejected: reserving 40 px and forcing the box to two lines even when empty.
Height would become consistent again, but white space would remain — that was
what needed removing, not merely its irregularity.

**Consequences.** `GRID_PLACE_HEIGHT` and `GRID_DESCRIPTION_HEIGHT` merge into
`GRID_HEADER_LINE_HEIGHT`. The gap between a header and its thumbnails is now
`GRID_HEADER_PAD_BOTTOM` (12 px) in **every** case: no note, place only, short
note, or long note.

`ALBUM_DAY_DESCRIPTION_MAX_LENGTH` remains 300. The limit did not exist to fit
two lines — it says that a day note is a marker, not a narrative, and that has
not changed.
