# D70 — A day's note leaves the viewer header on mobile

**Context.** A day's note appears in two places: its section header in the grid,
and the viewer header, so opening a photo does not lose what gives it meaning
(D68 describes the adjacent feature, collapsing). On a phone, this second
location stacks the filename, day, place, and up to two lines of note above the
image — on a screen where the photo is already cramped.

Two settings decided elsewhere change the tradeoff: the grid now displays the
note at **all** widths, and the "Info" panel is closed by default. The note is
therefore no longer information that might never be seen if the viewer does not
carry it.

**Choice.** The note remains in the viewer header from `md` upwards and disappears
below it. The threshold is not arbitrary: `md` is the width where `SidePanel`
ceases to be an overlay drawer and docks in the flow — the established boundary
between "phone layout" and everything else.

**Rejected.** Hiding the entire context line, including place and date. It fits
on one short line where the note takes two, and it is precisely what is lost when
opening a photo from the grid: hiding it would cancel the reason for carrying
that context here. The space gained would be marginal and the loss complete.

Also rejected: touch expansion — one more gesture on the device where gestures
are scarcest, for text the grid already displays.

**Consequences.** On mobile, the note was then only reachable from the grid:
`ExifPanel` only listed EXIF data. The remedy announced here as "an addition to
make" was implemented immediately afterwards —
[D74](./D74-the-viewer-organises-its-actions-and-restores-the-day-s.md)
gives it "Place" and "That day" rows at every width. The choice above is
unchanged: the header remains reserved for `md` and above; only the consequence
described has ceased to be true.

The paragraph wrapper carries `hidden md:block`, not the paragraph itself:
`line-clamp-2` sets `display: -webkit-box`, and two `display` utilities on the
same element are resolved by stylesheet order, not class order in the attribute.
