# D260809i — Cascade layers are flattened at build time

**Confidence.** observed — packages/web/src/styles.css, git ls-files → exit 0 · 2026-08-23

**Context.** [D260809f](./D260809f-the-style-sheet-is-lowered-at-build-time-not-written.md) lowers
the generated style sheet to the Chromium 79 observed on a television, with one
caveat: `@layer` does not exist before Chromium 99, Tailwind v4 encloses all its
output in it, and if the application rendered anyway, it was because that
particular parser accepted the unknown at-rule while retaining the rules inside.
The conclusion at the time — "no lowering can replace it because layers cannot
be simulated" — proved false, and the readout that demonstrated this came from
a second television.

**What the second readout says.** On a newer LG — Chromium 87, webOS 22 —
`/diagnostic` answers **NO** to the same probe where 79 answered YES. Neither
supports layers; what separates them is how they handle an unknown at-rule:

| Engine                 | Unknown `@layer` block   | Behaviour                               |
| ---------------------- | ------------------------ | --------------------------------------- |
| Chromium 79 (webOS 6)  | content retained         | parser leniency                         |
| Chromium 87 (webOS 22) | **discarded with block** | behaviour required by the specification |

This is not a regression in support between the two versions; it is a parser
becoming compliant. The more favourable engine was the older one, and nothing
guaranteed that a third device would behave like the first.

**What it cost.** 47,329 of the 51,899 bytes in the generated style sheet —
**91%** — live in a layer. Chromium 87 discards them while parsing: the
application is not laid out poorly; it is **unstyled**. Simulating this by
injecting the sheet after removing everything that engine discards reduces the
album to the SVG back arrow, drawn full page.

**Decision.** A fourth pass in the plugin, `flattenLayers`, removes the layers
while leaving their content in place, and `findUnloweredDeclarations` fails the
build if any remain. Flattening comes **last**, after
`replaceIndependentTransforms`, which itself introduces a layer.

**Why this has no effect on a current engine.** A layer changes the outcome of a
conflict only with respect to text order and specificity. However:

- Tailwind **declares its layers in the order in which it emits them** —
  `properties`, `theme`, `base`, `components`, `utilities` — so text order
  already produces the same result.
- **Nothing outside a layer is a style rule**: what remains at the root of the
  style sheet consists of `@property` and `@keyframes`, which the cascade does
  not arbitrate. Nothing therefore loses the precedence provided by being
  outside a layer.

Verified rather than assumed: gallery and viewer captured in current Chromium,
first with the layered sheet and then with the flattened sheet, showed **0 pixels
of difference out of 1,314,816**. The same flattened sheet, stripped of what a
compliant pre-Chromium 99 engine discards, also yields 0 pixels of difference —
meaning that engine now sees the entire page.

**What flattening loses**, and must be understood: layers protected utilities
from a base rule more specific than them. Without layers,
`main p { color: … }` would beat `.text-white`. No rule in this repository or in
Tailwind does that today — the base uses only element selectors — and if it ever
happens, the flaw will be visible everywhere, not only on a television. That is
the compromise: a uniform, visible risk instead of a risk invisible on someone
else's screen.

**The `/diagnostic` probe remains, with a corrected label.** It measures "do the
inner rules apply?", not "are layers supported?": YES still proves nothing about
an engine (D260809f), and NO no longer condemns the application. The readout
remains useful for the engine version and the other capabilities.

**Consequences.**

- The style sheet loses 101 bytes — the layers carried only their own syntax.
- `packages/web/src/styles.css` continues to use `@layer base` and
  `@layer utilities`: the source does not change; only the output is flattened.
  There is nothing new for someone writing a component to remember, following
  the same rule as the rest of the lowering.
- Flattening skips CSS strings while looking for the closing brace. A brace
  contained in `content` exists in Tailwind's output, and counting it would split
  the style sheet midway without reporting anything.
