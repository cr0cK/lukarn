# D89 — The album description leaves the caption: it was read on entry

**Context.** [D84](./D84-le-contexte-descend-en-bas-de-la-visionneuse-a-toutes-les.md)
gathered three texts at the bottom of the viewer, from most specific to most
general: photo, day, album. The reasoning held for the first two — they belong to
what is being viewed. It held less well for the third, as use showed: the album
description is **the same on every photo in the album**, and was just read at the
top of the grid. One strip line per photo for text repeated nine hundred times,
in an area whose defect is precisely consuming the framing.

**Decision.** The `album` scope disappears from `captionEntries` — from the type,
component, and plumbing that passed `albumDescription` down from `AlbumPage`.
The strip carries two lines: photo, then day.

What the viewer owes the album is saying **which one**, not narrating it. Its
title moved to the top of the header at the same time
([D88](./D88-la-photo-ouverte-dit-d-ou-elle-vient-et-s-en-debarrasse-d.md)),
which makes this removal lossless: someone arriving through a shared link still
knows where they are, in one phrase rather than a paragraph.

**Rejected.** Keeping the line collapsed by default: the strip expands as a
whole, so a third collapsed text remained another line on screen and another
click to understand. Also rejected: only displaying it on the first photo opened
in a session. A display depending on action order cannot be explained, and there
is nothing to explain here — the text is elsewhere, in a place already crossed.

**Consequences.** The album description now has one location, the top of the
grid — where it takes the full width (D88). A shared link opening a photo directly
therefore does not show it; closing the viewer does, which is the natural action
to see the rest of the album anyway.
