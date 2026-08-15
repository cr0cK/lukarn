# D260815d — The light theme is a second ramp, not a second interface

**Context.** The interface has always been dark, and it said so in three places:
one `ink-*` scale in `styles.css`, `class="dark"` hardcoded in `index.html`, and a
Theme row on `/settings` whose second value was greyed out with "(soon)" beside it
([D260815c](./D260815c-the-reader-gets-a-screen-of-their-own.md)). That row was a
promise, and this is it kept.

The obvious way to keep it is the expensive one. Four hundred and thirty-five
`ink-*` class names are spread across forty-two components, and a light theme
written as `dark:` variants doubles every one of them — a second class beside the
first on each surface, each able to be forgotten, and none of them checked by
anything. The interface would then exist twice.

**Decision.** The rungs name a **role**, not a brightness, and there are two ramps
bound to them.

`ink-900` is the page, `ink-850` the panel raised above it, `ink-700` its edge,
`ink-400` the muted text, `ink-100` the text. That is already what the numbers
meant; writing it down is what makes a second ramp possible. `styles.css` declares
`.theme-dark` and `.theme-light`, one of which is on `<html>`, and every
`bg-ink-850` in the application resolves against whichever is in force. **No
component changes, and no component learns that a theme exists.**

The light ramp is not the dark one reversed value for value. Two rungs invert
their neighbours instead: `ink-850` is whiter than `ink-900` because a light
interface stacks upwards where a dark one stacks down, and `ink-800` — at once a
raised bar and every hairline between rows — sits just _below_ the panel rather
than just above it. A divider that cannot be seen loses more than a top bar that
reads as chrome rather than as paper.

**Consequences.**

**The choice is applied by a blocking script from `public/theme.js`.** The
stylesheet is render-blocking and the bundle is not: left to React, the page
paints dark and then turns, and everyone reading in light watches it flash black
on every cold load. The script therefore runs from `<head>`, with neither `defer`
nor `type="module"`, and moves the class before the first paint.

It is a **file** and not four inline lines because the policy this server sends is
`script-src 'self'` (`plugins/headers.ts`). An inline script is refused, and
relaxing that directive to save one small same-origin request would also make an
injected `<script>` in an album title executable — the exact thing the directive
is there for. The cost is one request of a few hundred bytes, discovered by the
preload scanner alongside the stylesheet.

That file cannot import from `src/lib/theme.ts`: one is served as it is written,
the other is bundled. It repeats two functions unbundled, and `theme.test.ts` reads
both files and fails when they stop agreeing on the storage key, the class names
or the colour of the browser chrome. The same test compares the dark ramp against
the copy of it `@theme` has to carry — Tailwind emits no `bg-ink-850` for a token
it has never seen.

**The device answers until the reader does**, exactly as the language already
works: stored choice, then `prefers-color-scheme`, then dark. Deliberately _not_
`@media (prefers-color-scheme)` in the stylesheet, which would make the device the
rule rather than one of three answers — somebody who chose light on a phone that
goes dark at night chose it for the gallery too. The media query is asked for
`light` and not for `dark`, so an engine too old to answer either falls back to
the dark this gallery has always been.

**The photo stage does not follow the theme.** A photograph is judged against what
surrounds it, and a white ground shifts every exposure in it; the viewer's stage
therefore keeps `ink-950` under a `theme-dark` class of its own, and the gradients
and white text painted over the image are correct for the same reason. Everything
else in the viewer is chrome and turns light with the application: the side panel,
the sheet a phone pulls up, the menus. This is where Google Photos and Apple
Photos both land, and the alternative — a dark island that leaks through a portal
into a sheet the same reader opens on a phone — would have made the same content
dark on one screen size and light on another.

**`--color-accent-soft` becomes translucent.** It was an opaque colour computed
against `--color-ink-850` by `derivePalette`, which was correct as long as there
was one panel colour. There are two now, and no single opaque value is right on
both. The accent at a sixteenth of its opacity is: over the dark panel it
composites to exactly the value it replaces — `branding.test.ts` performs that
composite and checks it — and over any other ground to what the mix would have
produced there. It is also the first version of this token that is correct on
`ink-900`, which some of the rows using it actually sit on.

Written `#rrggbbaa`, not `rgb(… / 16%)` and not `color-mix()`. Eight-digit hex has
been read since Chromium 62, well inside the 79 this gallery is read on
([D260809f](./D260809f-the-style-sheet-is-lowered-at-build-time-not-written.md)),
and a colour the engine cannot parse is dropped rather than approximated — the
hovered row would lose its background instead of its tint.

**Hover states become a token.** Roughly thirty surfaces asked for `bg-white/5`, a
wash of white that says nothing on a white page. They now read `bg-tint`, a token
that flips with the ramp. This also removes them from a defect they shared:
Tailwind compiles an opacity modifier to `color-mix()`, which Chromium 79 drops
whole, so on that television the only cue that a borderless row answers the
pointer was already missing.

**`color-scheme` moves from a meta tag to the ramps.** It decides the colour of
the native scrollbar, of a `<select>` drop-down and of the space either side of a
rubber-band scroll. As a meta it could only say one thing; as a property on each
ramp it follows the reader. The `theme-color` meta has no such equivalent and is
rewritten by hand, in the two files that move the theme.

**What was not done.** The rungs keep their numbers rather than becoming
`surface` / `raised` / `border` / `text`. Honest names would have been a
mechanical rewrite of four hundred and thirty-five call sites in forty-two files,
landing in the same commit as the theme and hiding it. The naming is a separate
piece of work, and this decision is what makes it optional rather than urgent.
