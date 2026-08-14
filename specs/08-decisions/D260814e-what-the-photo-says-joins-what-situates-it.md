# D260814e — What the photo says joins what situates it

**Context.**
[D260814d](./D260814d-the-phone-rule-reaches-the-viewer-and-the-pinch-reaches-the-photo.md)
gave the phone's viewer a bottom row of actions and left the caption where D84
had put it — at the bottom of the photo column, which by then meant **under**
that row. The hand-written text, the one thing about a photo a machine did not
produce, ended up below a toolbar. It read as buried, and it was.

**Decision.** Below `md`, the caption moves into the viewer's header, under the
album, the date and the place. The bottom then carries the toolbar and nothing
else.

This reverses the split D84 chose — "the header **locates** the photo, the bottom
bar **tells its story**" — and only where the phone made it fail. Two bands of
text at opposite ends of a 390 px screen were never two registers; they were one
subject cut in half by a layout. Above `md` the split still holds and nothing
changes: the column is wide, the strip at the bottom of the photo is read in the
same glance as the image, and the panel has its own column beside it.

**The header keeps its gradient.** Making it opaque was considered first and
rejected in the same breath: a translucent band costs no photo, and an opaque
one either covers the top of a portrait image or pushes the photo down, in which
case it changes size every time a tap hides the chrome.

**Consequences.**

The **day note travels with the description**. Leaving it below would have kept
text under the toolbar for the sake of a distinction — "this photo" against
"that day" — that the caption already carries in its own prefix and colour.

The caption **ignores `captionHidden` below `md`**. Hiding the text separately
from the chrome made sense when it was a bar of its own with a chevron; in the
header the tap that hides the chrome already does it. And `l` has no key to press
on a phone: someone who had collapsed the strip on a desktop would have opened
the viewer on a phone with no description and no way to ask for one.

Clamping and tap-to-expand are unchanged, and the expanded text is still bounded
at half the viewport — the header is `absolute` and does not scroll, so a
thousand characters would otherwise run off the bottom of the screen with no way
to reach the end.

The editor opens **downwards** from the header rather than upwards from the
bottom, because that is where the text it replaces now is.

**A phone playing a video was the one exception D260814d had to carve out**: its
native controls live at the bottom of the element, so the caption could not rest
there and stayed in the flow. Moving the text up removed the exception along with
the problem — the header is the same for a video as for a photo, and the sheet
carries the panel alone.

**Rejected.** Reusing `TopBar` itself for the viewer's header, which was the
first reading of "keep the same header". It would put the instance's mark over a
photo, leave the progress bar and the counter homeless, and add three props to a
component with one caller needing them. The viewer keeps its own header; what
was asked for was that the text stop living at the far end of the screen.
