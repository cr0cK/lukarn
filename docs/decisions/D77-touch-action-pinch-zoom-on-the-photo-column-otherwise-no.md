# D77 — `touch-action: pinch-zoom` on the photo column, otherwise no touch gesture completes

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** On a phone, panning around an enlarged photo was described as "very,
very slow, almost unusable", and the position indicator "slipped" as soon as it
moved. It was not slow: the gesture died midway. No `touch-action` was declared
anywhere in the frontend, and with the default `auto` value the browser retains
the right to interpret a one-finger drag as scrolling. It decides to do so after
one or two `pointermove` events, emits `pointercancel`, and the handlers give up —
only the few movements received before arbitration take effect.

Contrary to what its name suggests, `setPointerCapture` does not prevent this:
capture guarantees delivery of subsequent events; it does not stop the browser
from cancelling the gesture.

Measurement showed that **swiping between photos failed in the same way** — it
never reached `pointerup`, so the photo never changed. Two gestures, one defect.

| Gesture, in Pixel 10 emulation | `pointermove` | `pointercancel` | Result                 |
| ------------------------------ | ------------- | --------------- | ---------------------- |
| Zoomed pan, `auto`             | 2             | 1               | 24 px out of 240       |
| Zoomed pan, fixed              | 20            | 0               | 240 px out of 240      |
| Position indicator, `auto`     | 2             | 1               | lands on opposite side |
| Position indicator, fixed      | 12            | 0               | targeted point         |
| Swipe, `auto`                  | 1             | 1               | no change              |
| Swipe, fixed                   | 10            | 0               | next photo             |

**Choice.** Permanent `touch-action: pinch-zoom` on the viewer's photo column.

**`pinch-zoom` rather than `none`.** Both remove arbitration, but `none` also
removes two-finger pinching — the instinctive zoom gesture on a phone, which the
viewer does not attempt to replace and whose scale it watches to load the `hd`
variant ([D20](./D20-zooming-with-a-high-resolution-variant-rather-than-scale.md)).
`pinch-zoom` only removes one-finger scrolling, exactly what nobody needs there:
nothing beneath the viewer scrolls.

**On the column rather than the `ZoomableImage` container.** The rule is the same
for everything in that column, and a descendant inherits it by intersection —
the position indicator, which declares `auto`, is protected by the column without
having to say so. One declaration instead of three, and swiping, which lives in
`Lightbox`, is covered by the same one.

**Permanently rather than only while zoomed.** Applying the value on enlargement
would leave swiping broken and make browser behaviour depend on a class change
between two renders. The only touch gesture removed outside zoom is scrolling
when there is nothing to scroll.

**Rejected.** Video, excluded: its native playback controls have their own touch
handling, and swiping is already disabled there — nothing justified changing it
without being able to test it.

**Consequences.** Double-tap to zoom, which the browser adds under `auto`,
disappears on the photo column. Nothing is lost: a brief tap already toggles zoom
at the targeted point.

Automated verification stops where the phone begins. Chromium emulation reproduces
the arbitration — the figures above come from it — but not two-finger pinching or
the feel of panning, which was the original defect. Those can only be checked on
a real device: Playwright synthesises pointers; it does not replace a hand.
