# D260814b — A sheet replaces the overlay, and the viewer opens bare

**Context.**
[D260814](./D260814-the-mobile-shell-moves-to-a-bottom-tab-bar.md) moved
navigation to the bottom of the phone screen and left the two surfaces that
carry **content** where they were. Both were still desktop shapes with a width
rule bolted on:

- `SidePanel` became a full-screen overlay below `md`, arriving from the top,
  dismissed by a cross in the far corner — the one part of a phone screen a thumb
  cannot reach.
- `MediaCaption` sat over the photo as a strip that could be collapsed but not
  explored: the EXIF data and the conversation about the same photo lived in that
  other overlay, and nothing connected the two.
- The viewer opened with its full chrome — header, both arrows, caption — over a
  photo somebody had just chosen to look at. `bare` already existed behind the
  `h` shortcut; on a phone there is no `h`.

**Decision.** One `components/Sheet.tsx`, and below `md` it carries everything
that used to overlay.

**The viewer's caption and panel become the same sheet at two stops.** At rest it
shows the day, the place, the comment count and what was written about the photo;
pulled up, the same sheet is the panel, tabs and all. This is the honest shape of
the relationship — "what this photo is" and "everything about this photo" are one
subject at two depths, and they were two unrelated full-screen surfaces for no
reason a finger could discover. `SidePanel` keeps its column from `md` and
exports `PanelBody` so both frames hold identical contents.

**`ActionMenu` renders the same entries in a sheet below `md`**, keeping its
three closing rules in the one place they are written. Its `placement` prop,
added a day earlier so the Account tab could open a dropdown upwards, is removed:
the sheet is what a control on the bottom edge needed.

**The viewer opens bare on a coarse pointer.** A phone opening a photo shows the
photo; the eye button in the corner is the affordance saying the rest is one tap
away, and the tap that reveals it hides it again. With a cursor nothing changes:
hover already names every control, the arrows are how a mouse navigates, and no
screen edge needs reclaiming.

**Consequences.**

Zoom moves to a **double** tap on touch, and this is a cost, not a bonus. A
single tap was the only way to enlarge a photo with a finger:
`touch-action: pinch-zoom` hands two fingers to the browser's own page zoom,
which magnifies rendered pixels instead of requesting the 4096 px variant. Every
single tap therefore now waits 250 ms to learn whether a second one follows.

`lib/sheetDrag.ts` is the vertical `swipeTrack.ts` and is deliberately built on
its constants — same edge resistance, same flick speed, same `settleDuration` and
`SETTLE_EASING`. Two motion vocabularies in one application are noticed even when
neither can be named.

The sheet **captures the pointer on `pointerdown`**, unlike the photo rail, which
must first decide whether a gesture is horizontal. A grip is 44 px tall and the
drag that matters is 400 px long: without early capture the first move already
lands outside the handle, the element never sees it, and the sheet does not move.
This was measured, not predicted — the first implementation captured after the
direction lock and no drag ever committed.

Opening a photo carries the thumbnail into the viewer through
`document.startViewTransition` (`lib/viewTransition.ts`), detected at runtime.
The build targets `chrome79`, where the API does not exist and the update simply
happens, as it did before. The **closing** direction is deliberately not
animated: the shared name would have to be given to the destination _after_ the
update rather than before it, which is a second mechanism, and the thumbnail may
have been unmounted by the virtualiser after a swipe through fifty photos.

**`navigator.vibrate` does nothing on iOS.** `lib/haptics.ts` is one guarded call
that fires on Android and Chromium and is silent on Safari, which has never
implemented the API — on the archetypal phone for a photo gallery, the haptic
confirmation this adds does not exist. It is kept because it costs nothing and
works everywhere else, not because it covers the case one would assume first.

**Rejected.** Rendering both frames and hiding one with `md:hidden`. It would
mount two comment forms, two scroll containers and two message drafts for a
single photo, and the draft in the hidden one would be the one somebody typed.
Hence `lib/useMediaQuery.ts`, which decides in JavaScript what CSS cannot.

Also rejected: giving the sheet its own settling curve. It was tempting because a
sheet falls and a photo slides, and they are different physical intuitions. They
are not different applications.
