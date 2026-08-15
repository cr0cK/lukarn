# D260815b — The account is a person, not an initial

**Context.** Three surfaces stood for whoever is signed in, and each drew them
differently. The top bar's badge held a letter taken from the identifier; the
Account tab on a phone held a person glyph; the menu both of them open opened on
the identifier as bare text, four pixels to the left of every action it applies
to, because that header had no icon while every entry below it did.

The letter was chosen so the badge would abbreviate the menu's first line, and
that reasoning holds only while one reads the badge as a name. Nobody does: it
sits at the end of a bar of icons, so it reads as one more icon — an odd one,
which changes with the account and says nothing on an instance where "demo" and
"dad" both give a D. And the tab bar already answered the same question with a
drawing.

**Decision.** One glyph for the person, drawn by all three: the badge above `md`,
the Account tab below it, and the identifier line at the top of the menu.
`AccountMenu` exports it as `AccountIcon`, and `ActionMenu` gained a `headerIcon`
so its header sits on the gutter its entries already use. `accountInitial` is
gone.

**Consequences.**

Opening the menu now continues something instead of replacing it: the badge one
clicks is the mark beside the name one lands on. Aligning that name with
Administration and Sign out also makes the header read as the head of the list —
what these actions apply to — rather than as a stray caption.

The glyph takes its size and stroke from `className` rather than fixing them.
Each of the three sits among icons of another weight — 24 px at 1.75 between the
tabs, 16 px at 2 in the menu, 18 px inside a 32 px disc on the bar — and a
drawing that ignored its neighbours would be the one thing on the row that looks
pasted in.

What does **not** change: no photo, no avatar fetched from a third party
([D86](./D86-the-account-fits-in-a-badge-and-its-initial-is-rendered.md)). The reason that
decision gives — an address handed to somebody else on every page load, for
decoration, on an application self-hosted to avoid exactly that — is untouched
by this one. Only the local drawing changed.

Nothing is lost that the interface still needs: which account is signed in is
answered by the menu, one press away, where it is written out in full rather
than reduced to its first character.
