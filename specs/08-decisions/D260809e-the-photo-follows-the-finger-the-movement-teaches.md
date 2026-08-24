# D260809e — The photo follows the finger: the movement teaches the gesture

**Confidence.** observed — lib/useSwipe.ts, git ls-files → exit 0 · 2026-08-23

**Context.** Horizontal swiping had existed in the viewer through
`lib/useSwipe.ts`, and it worked: 50 px clearly in the horizontal direction in
under 800 ms, and the next photo replaced the previous one. But **nothing showed
it**. Throughout the gesture, the screen remained still; the image changed all
at once only when the finger was lifted. This had three consequences, all three
reported as "not very mobile-friendly":

- **The gesture cannot be discovered.** A viewer that does not move under a
  finger teaches nothing. The only visible way to change photo was the 44 px
  arrow over the image — precisely what swiping was meant to replace.
- **The gesture cannot be corrected.** Nothing showed that the threshold had
  been crossed or which way it was heading: changing one's mind was impossible,
  because there was nothing to see before the result.
- **The change is abrupt.** One photo replacing another without a transition
  reads as a reload, not as turning a page.

**Decision.** The photo column becomes a **track** of three media items — the
previous, current, and next — which the finger moves pixel by pixel and which
settles into place on release. This is how every native viewer behaves, and it
consists of four rules.

- **The track follows the finger.** The neighbour enters from the edge with the
  very first pixels: this movement alone teaches the gesture. A 24 px gap
  separates two photos; otherwise they read as one split image.
- **The direction is decided once**, at the tenth pixel travelled
  (`DIRECTION_LOCK_PX`) and using the same 1.5 ratio as before. Below that,
  nothing moves: a track that twitches at the slightest touch would make resting
  a finger on it unsettling. And a gesture that curves midway no longer changes
  its nature.
- **Two ways to commit**, because there are two gestures. Cross 22% of the width
  — looking at what comes next before releasing — or fling the track at more
  than 0.35 px/ms without looking. Keeping only one would make the other
  ineffective; the 50 px rule alone prevented a thumb flick.
- **Settling takes as long as the gesture calls for.** Its duration follows from
  the remaining distance and the finger's speed, bounded between 160 and 320 ms.
  A fixed duration betrays the gesture: after a sharp flick the track seems to
  bog down, while after a slow drag that is nearly complete it suddenly shoots
  away.

At the ends of the album, the track still moves but renders only 35% of the
gesture: the edge is **felt**, rather than announced or silent.

Two implementation points are structural rather than decorative:

- **The photo changes only once the track has arrived.** Requesting it earlier
  would remount `ZoomableImage` in the middle of the animation, on a photo that
  is not yet the one shown on screen.
- **The track returns to zero only when the index changes**, in a
  `useLayoutEffect`. The viewer does not decide its index: it requests it and
  receives it back through the URL (`?photo=`). In between, the track must stay
  where the animation left it, on the neighbour already on screen — resetting
  it when requesting the change would make the photo just left reappear for one
  frame.

**Rejected.**

- **A simple opacity transition between the two photos.** Three lines of CSS
  would have softened the change — but it runs only **after** the gesture. It
  shows nothing during it, so it still teaches nothing and still gives no chance
  to change one's mind. The lack of feedback is what is being fixed, not the
  abrupt cut.
- **A hint on the first visit** — a photo that slides by itself, or a pulsing
  arrow. No native viewer does this, for good reason: what is shown once is
  forgotten; what responds to a finger teaches itself. It is also an animation
  moving without being requested, over someone's photo.
- **Keeping the neighbours mounted permanently.** Two more full-screen images
  to decode for every photo viewed, although they are useful only during the
  gesture. They are mounted when the swipe is recognised and unmounted with it.
- **Also animating ←/→, the arrows, and the keyboard.** The reported flaw concerns
  the finger, and a keyboard viewer is browsed quickly: 250 ms of animation per
  photo would place a barrier between two arrow-key presses. The track remains
  the touch gesture, and that gesture alone.
- **Extending swiping to the mouse.** Unchanged: clicking already zooms, and a
  three-pixel drag must not choose between two actions.

**Consequences.**

- The **800 ms** rule disappears. It protected against "resting a finger, then
  moving it", which no visual feedback disproved; the track now continuously
  shows what will happen, and a slow but deliberate drag is a valid gesture.
- The decision lives in `lib/swipeTrack.ts`, outside React, and is tested. The
  thresholds are what need tuning: leaving them in an event handler would make
  them impossible to test.
- The neighbours add **no requests**: neighbour preloading (`PRELOAD_AHEAD` /
  `PRELOAD_BEHIND`) has already put their `full` rendition in the browser cache.
  A video has only its Drive preview to show (D92); without a preview, the track
  slides over an empty space, which remains accurate — there is nothing to show
  until the video is opened.
- Swiping remains **disabled while zooming and on a video**, for the same reasons
  as before, and continues to depend entirely on `touch-action: pinch-zoom` on
  the column (D77).
- **Only the track moves**: arrows, header, caption strip, and error messages
  stay still while the photos are browsed. Moving them would make it feel as if
  the viewer were sliding, rather than the photos.
