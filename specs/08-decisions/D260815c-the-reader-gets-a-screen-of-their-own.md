# D260815c — The reader gets a screen of their own

**Context.** The interface became translatable in
[D260812c](./D260812c-the-interface-is-translated-by-two-typed-catalogues.md), and
the language went where there was room at the time: the account menu, as a group
of ticked entries below "Sign out" and "Install". That worked while it was the
only thing of its kind.

It is not the only thing of its kind any more. A light theme is coming, and
behind it the thumbnail size and the grid density — every one of them a value
this browser holds, none of them an action on the session. Added to that menu
they would each have made it longer, until the list of things you can do ended
somewhere in the middle of a list of things you have chosen. A menu opened from
the bottom edge of a phone has a height budget; more importantly, "Sign out"
sitting among preferences is a mistake waiting to be clicked.

**Decision.** `/settings` is a screen, guarded like the rest and **not** by
`admin`.

It carries the language today and the theme beside it, and it takes the shape
administration already has: the same top bar, the same `Section` box, the same
`ui.tsx` fields — therefore the same rows on a phone, value on the right and a
chevron opening the control. `components/admin/ui.tsx` stops being
administration's alone; two screens of settings read differently would be the
defect the shared primitives exist to prevent.

The account menu keeps one new entry, **Settings, first and offered to
everybody**: it is the only thing there that an account without the
administrator flag can act on beyond leaving. `MenuEntry` loses its `checked`
field along with the languages — every entry in that menu is now an action.

**Consequences.**

**No sidebar, and no `:tab` segment.** `AdminNav` earns its column by listing six
sections; two settings do not need a column naming the screen they are already
on. Sections can be split out the day there are enough of them without moving the
address, and until then `/settings` is one page. Its content column stops at
48 rem rather than administration's 90: that width exists for album rows and a
moderation queue, and a dropdown alone at the end of a 1170 px line reads as a
field somebody forgot to fill.

**Dropdowns, not ticked lists or segmented controls.** Every setting on the
screen is read the same way — a name, and the value it currently holds — whatever
the number of values behind it. A tick list is fine for two languages and wrong
for eight grid densities, and the screen would then carry two ways of answering
the same kind of question. `ui.tsx` gains `SelectField` for it, shaped like
`TextField` so the row on a phone comes free.

**The theme is listed and refused rather than absent.** `styles.css` has one
`ink-*` scale and `index.html` hardcodes `class="dark"`; the second option is
`disabled` and choosing it does nothing. A setting nobody can see coming is a
setting people ask for, and "Light (soon)" answers where the answer will
eventually be. Nothing is stored for it: a remembered value with one palette to
apply it to is a preference that does nothing, and the day the second scale lands
is the day it becomes worth writing down.

**What was not done.** The language stays a property of the **browser**, not of
the account, exactly as
[D260812d](./D260812d-the-language-travels-in-accept-language-and-is.md) left it:
one access key may be shared by a household, and one member reading French must
not switch the television in the living room. Moving these settings to the server
would have made this screen an account editor — a different feature, with a
different security surface, for no gain to anybody it currently serves.
