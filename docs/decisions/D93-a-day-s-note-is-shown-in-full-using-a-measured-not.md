# D93 — A day's note is shown in full using a measured, not estimated, line count

**Confidence.** observed — lib/measureLines.ts, git ls-files → exit 0 · 2026-08-23

**Context.** D85 reduced a day's note to **one truncated line** in the section
header so the height reserved by `useGridLayout` exactly matched that rendered by
`SectionHeader` (D49: layout is calculated without the DOM). The contract was
exact, but the cost was visible: a two-sentence note — the common case, a day's
itinerary — stopped at an ellipsis a third of the way through the first point of
interest. Full text remained available, but in three places that must be opened:
the tooltip, the `i` panel, and the viewer strip. A note written to be read while
browsing the grid was no longer read.

**Choice.** The note is displayed on as many lines as it needs, and the line count
is **measured by the rendering engine** before layout is calculated.
`lib/measureLines.ts` keeps an off-screen `<p>` probe, applies the same classes as
the real paragraph (`GRID_HEADER_NOTE_CLASS`) and the same container width, then
divides its measured height by `GRID_HEADER_LINE_HEIGHT`.

This count is then used **twice from the same source**: `useGridLayout` puts it in
`descriptionLines`, uses it to reserve height, and passes it to the component,
which applies it as the paragraph's `line-clamp`. Reservation and rendered box
therefore cannot diverge — not because both sides recalculate identically, but
because there is only one calculation.

**Why a DOM probe rather than `canvas.measureText`.** Canvas measures glyphs, not
layout: it ignores the wrapping rule, `text-rendering: optimizeLegibility` on the
page body, and actual line height. Its metrics are _almost_ right, and "almost"
is exactly what D85 rejected. The probe is measured by the same engine with the
same classes at the same width: it is correct by construction. The cost is one
forced style calculation per width and note — the result is memoised and the
cache cleared on width changes, bounding it to the number of annotated days.

**What makes D85's tradeoff obsolete.** D85 rejected "estimating line count from
text length and average glyph width", and that rejection remains valid: estimates
fail, and underestimation puts thumbnails beneath text. Measuring is not
estimating. D85's conclusion — _reserved height must be exact_ — is preserved;
what changes is that it can now be exact without being limited to one line.

**Rejected.** Limiting display to three or four lines, after which the ellipsis
would return. This would keep headers compact on mobile, where a 300-character
note occupies five to seven lines. But `ALBUM_DAY_DESCRIPTION_MAX_LENGTH` already
limits the note to 300 characters precisely so it remains a marker rather than a
narrative: a second, screen-width-dependent limit would restore truncation where
it is most troublesome.

Also rejected: measuring mounted headers and feeding their height back into
layout. This obvious solution is incompatible with virtualisation — a header
outside the viewport is not mounted and cannot be measured, leaving the scroll
bar wrong until everything has been traversed.

**Entered line breaks are preserved** (`whitespace-pre-line`), which was not true
anywhere in the grid: a note written on three lines appeared as one sentence,
while the viewer strip (`MediaCaption`) and album description already preserved
their breaks. The same text therefore read differently depending on where it was
opened. Since the probe carries the same class as the paragraph, these breaks
automatically contribute to reserved height — the benefit of making
`GRID_HEADER_NOTE_CLASS` the single geometry definition rather than copying a
class list.

**Consequences.** The place remains on one truncated line: it is naturally short,
and expanding it would multiply cases without showing more. The gap between a
header and its thumbnails remains `GRID_HEADER_PAD_BOTTOM` (12 px) in every case,
which D85 achieved and needed to preserve. `GridLayout` gains `descriptionLines`,
and `SectionHeader` gains a property. The `title` attribute disappears from the
note — it no longer repeats anything not already visible.
