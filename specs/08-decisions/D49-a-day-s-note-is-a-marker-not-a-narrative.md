# D49 — A day's note is a marker, not a narrative

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** A grid section header must be able to carry a place and a note. But
`computeLayout` positions every photo **before** any DOM node exists: this is what
provides the correct scroll bar on the first render and makes virtualisation
possible.

**Choice.** 300 characters, clamped to two lines, with header height declared by
`LayoutOptions.headerHeightFor` — `56 + 20 if place + 40 if note`.

Height is **input data for the calculation**, never a measurement. A header that
decided its size once mounted would end up underneath its own photos, and nothing
would correct it: the layout is only recomputed when the width, list, or grouping
changes. The two constants are therefore a contract that `SectionHeader` must
honour, hence its explicitly fixed line heights (`leading-5`) instead of leaving
them to the font.

The same reason applies to the editor, which opens as an **absolute overlay**:
having it expand the flow would shift the rest of the album under the pointer at
the exact moment it has just been clicked.

**Rejected.** _A note of unrestricted length_, which would require measuring the
rendered header and then recomputing the layout — making the grid jump once per
section during loading. _A `ResizeObserver` on the headers_: the same problem,
plus a feedback loop between measurement and layout.

**Consequences.** A day is described in a sentence or two, not a paragraph. This
is the right format for the feature's purpose — "Bonifacio, then the beach" — and
the full text remains readable in a tooltip. If true narration is wanted one day,
it will not live in the header of a virtualised grid.
