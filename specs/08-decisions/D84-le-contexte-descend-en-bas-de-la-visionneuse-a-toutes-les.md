# D84 — Context moves to the bottom of the viewer at every width

**Context.** Three texts describe an open photo, and none was present while it
was viewed. The album description only lives at the top of the grid. The day note
only appeared in the viewer from `md` upwards (D70), never on a phone. And the
photo description had just begun to exist (D83) with nowhere to display it.
Opening an image therefore lost the essence of its explanation — exactly the
defect D68 and then D74 addressed incrementally by moving a fragment of context
into the header.

**Choice.** A bottom strip in the photo column (`MediaCaption`) stacks the three
texts from narrowest to broadest scope — photo, day, album — at **every** width.
Hierarchy is conveyed by colour and visible line count
(`ink-100`/3, `ink-300`/2, `ink-500`/1), with no headings: the broader the scope,
the more the line recedes.

**This reverses D70's threshold, and the reason it is not backtracking must be
stated.** D70's tradeoff concerned **two lines stacked above the image** on a
phone where the photo was already cramped: context ate into framing from above,
with no remedy. The question here is different. A caption under the photo on a
gradient does not crop it in the same way; it is collapsed by default; and one
gesture hides it, which the header note did not offer. D70 explicitly rejected
"touch expansion" — another gesture for text already visible in the grid. That
is true of a day note, not a photo description shown nowhere in the grid.

**Hiding is persisted; expansion is not.** The distinction is intentional:
hiding is a choice about how to view photos — made once, and asking again on
every opening would ensure it is never used. Expansion responds to one specific
text and has no meaning on the next photo. The former lives in `localStorage`
(`useCaptionHidden`); the latter in component state remounted for every photo.

When hidden, a ghost "Show caption (l)" button remains at bottom right. A hidden
state with no way out is a trap: once the strip is gone, nothing else would say
that it had existed.

**Rejected.** Leaving the photo description only in the `i` panel. It is closed
by default, and a caption that must be sought out is not a caption.

Also rejected: a permanent strip that cannot be hidden. A gallery is also viewed
for images alone, and text on every photo with no way to dismiss it would
eventually become the application's main annoyance.

**Consequences.** The day note leaves the header, which keeps only what
identifies the file and locates the day. The "Place" and "That day" rows in
`ExifPanel` now repeat the strip: they remain because they are the only place
showing the **entire** text without expansion, and removing them would lose
access to the note from an already open panel. Their status changes, not their
code — they were D70's remedy below `md`; they are now a convenience.

`Escape` gains a layer — editor, zoom, panel, close. Caption input lives in the
viewer, and the key handler lets `Escape` from an input through (it is the escape
hatch): without this layer, correcting a caption and pressing `Escape` would
close the viewer over unsaved text.

On video, and only there, the strip **pushes** rather than overlays. Native
playback controls live at the bottom of the element; on a portrait video filling
the screen, a strip laid over them would make play/pause and the progress bar
untouchable — a far worse defect than the lost space.
