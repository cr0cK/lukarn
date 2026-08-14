# D260814f — The sheet's grip answers a tap, not only a drag

**Context.** The sheet was built around its gesture: the grip follows the finger
and the release decides which stop it lands on
([D260814b](./D260814b-a-sheet-replaces-the-overlay-and-the-viewer-opens.md)).
That is what teaches the whole range, and it is right — but it was the **only**
way in. A press on the grip did nothing at all.

Two costs followed. Reaching the viewer's panel asked for a deliberate 400 px
drag where a press would do, on a control that looks exactly like something to
press. And on a one-stop sheet — the account menu, the search — dismissing meant
dragging the whole thing off the screen, which is a lot of hand for a menu
somebody opened by mistake.

**Decision.** The grip is a `button`. A tap on it goes up one stop, or back down
from the top; on a sheet with a single stop, the only way down is away, so it
dismisses. The drag is unchanged and still does everything a tap cannot — landing
on a middle stop, or reversing halfway.

**Consequences.**

Making it a real `button` rather than adding a handler to the handle brings
`Enter` and `Space` with it. The sheet traps focus, so a keyboard could reach
the grip and find nothing there: a gesture is precisely the one thing a keyboard
cannot perform.

`aria-expanded` states which end the sheet is at, and the accessible name says
what the press will do — Expand, Collapse, or Close where there is nowhere to
collapse to. A grip that only draws a bar announces neither.

**A completed drag must not be undone by the click that follows it.** The browser
fires `click` on the element after `pointerup`, so the gesture would settle on a
stop and the click would toggle it straight off again. A flag set when a drag
actually moves, cleared on the next `pointerdown`, swallows exactly that one
click — and only that one, because a cancelled gesture resets it on the following
press rather than leaving it armed.

**Growing is committed at once; shrinking is animated.** The sheet's height is a
style rather than a transform, and `dragged` only renders downwards — a drag
upwards does not preview its own growth either. Animating a tap upwards would
therefore hold the sheet still for the settling duration and then jump, which is
worse than jumping immediately. Downwards the transform does render, so
collapsing and dismissal keep the same curve as a released drag.

**Rejected.** Making the whole resting stop tappable rather than just the grip.
On the viewer's sheet that stop is the toolbar: a tap meant for Download would
have expanded the panel underneath it.
