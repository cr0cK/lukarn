# D260809f — The style sheet is lowered at build time, not written twice

**Confidence.** observed — tools/legacy-css.ts, git ls-files → exit 0 · 2026-08-23

**Context.** The application rendered poorly in an LG television browser:
missing padding, a shrivelled viewer header, and panel labels stuck to the edge.
The readout collected from the device through
[`/diagnostic`](../07-frontend.md#browser-survey--pagesdiagnosticpagetsx)
reports **Chromium 79** (webOS 6.x), a 1536 × 856 viewport, and
`devicePixelRatio` 1.25.

Tailwind v4 supports Chromium 111 and above. Thirty-two versions separate the
two, and two of them account for all the damage:

- **Logical shorthands do not exist before Chromium 87.** Tailwind v4 emits
  `px-*` as `padding-inline` and `py-*` as `padding-block`: on this engine,
  **none of the application's inner padding applies**. The same is true of
  `inset-x-*` and `inset-y-*`, causing the viewer header to shrink to its own
  content width. `inset-0` is unaffected because Tailwind emits it as physical
  properties.
- **`oklch()` does not exist before Chromium 111.** Colours from the default
  palette — `red`, `amber`, `emerald` — become invalid, and error and success
  banners lose their background and text colours.
- **Independent transform properties — `translate`, `rotate`, `scale` — do not
  exist before Chromium 104**, and Tailwind v4 emits them for all its transform
  utilities. As a result, `-translate-y-1/2` no longer centres anything: this is
  what placed the search field's magnifying glass below its text.

**Decision.** A Vite plugin, `tools/legacy-css.ts`, rewrites the **generated**
CSS before it is written: Lightning CSS targeting Chromium 79, duplication of
the logical shorthands that this version rejects, and a composed `transform` in
place of the three independent properties.

It acts on the output, never the sources. This is decisive: the correction asks
nothing of someone writing a component, bans no Tailwind class, and covers code
that has not yet been written. The alternative — replacing the offending
classes by hand — required seventy-eight changes, a convention to remember, and
a regression the first time someone absent-mindedly wrote `px-4`.

**The logical shorthand remains last**, after its physical equivalent. That is
the entire mechanism: an engine that understands it applies the last declaration
and continues to respect writing direction; an engine that ignores it drops that
declaration and keeps the two physical ones. Reversing the order would make the
physical version win everywhere, sacrificing RTL for everyone.

**Transforms are replaced, not duplicated.** Adding a fallback `transform`
alongside `translate` would move an element **twice** on a current engine, which
would apply both. `transform` is therefore used everywhere, at the cost of a
less modern property for identical rendering everywhere.

The composed `transform` uses three slots — `--lukarn-translate`,
`--lukarn-rotate`, and `--lukarn-scale` — instead of writing the function
directly. Without them, `rotate-90` and `-translate-y-1/2` on the same element
would compete for `transform`, and the latter would erase the former; with them,
they compose in the prescribed order. Two traps arose here:

- **The slot reset lives in `@layer properties`.** Outside a layer, it overrode
  the utility it was only meant to precede — an unlayered rule beats everything
  in a layer — and nothing transformed any more.
- **Each variable has its neutral value as a fallback.** Tailwind initialises
  its `--tw-translate-*` through `@property` and only provides a fallback under
  an `@supports` written for Safari and Firefox. Relying on it risked an
  uninitialised variable invalidating the entire `transform`, leaving the
  element completely still.

**Why this duplication is not left to Lightning CSS.** It knows how to do it,
but **refuses as soon as the value contains `var()`**: it cannot know how many
components the value will expand to. Yet that is exactly what Tailwind emits for
its spacing scale, `calc(var(--spacing) * 5)` — that is, all `px-*` and `py-*`.
A two-component value genuinely depends on writing direction: the plugin leaves
it unchanged rather than reversing padding in Arabic.

**`color-mix()` required no work**, contrary to the initial assumption.
Tailwind gives every opacity modifier an eight-digit hex fallback —
`.bg-white/10` already has `#ffffff1a` outside the `@supports` block.
Thirty-five of the thirty-six affected declarations are covered; the thirty-sixth
mixes `currentcolor` on `::placeholder`, which remains one shade too light on
these engines. That was not what produced the black bands in the viewer: the
cause was the viewer background itself, exposed by an image that missing padding
no longer positioned correctly.

**`@layer` remains a stroke of luck, and that must be understood.** This rule
does not exist before Chromium 99, and Tailwind v4 encloses all its output in it:
the application should have no styling at all on this television. It does
because this parser accepts the unknown at-rule and still applies the rules
inside it. Nothing here relies on this behaviour — it cannot be made to — and no
lowering can replace it because layers cannot be simulated. This is the real
limit of support: an engine older than Chromium 99 that followed the
specification to the letter would render nothing at all.

**Consequences.**

- The JS target is lowered to `chrome79` as well: otherwise esbuild leaves `?.`
  and `??`, which are unavailable before Chromium 80, and the page remains blank
  instead of rendering poorly. Measured cost: 1.6 kB out of 450.
- `Array.prototype.at` (Chromium 92) is replaced by an explicit index in
  `components/admin/CommentsSection.tsx`. A missing API throws, whereas a
  missing CSS property simply does nothing.
- CSS grows from 47.6 to 51.2 kB, and from 8.80 to 9.35 kB when compressed.
- The plugin **runs only at build time**. Under `pnpm dev`, an old browser still
  sees the unlowered sheet: this has no effect in production, where the server
  serves only `dist`, but it must be known before concluding that a fix did not
  take effect.
- The plugin checks its own work and fails the build if any `oklch()` or logical
  shorthand without a fallback remains. A Tailwind upgrade that changed the
  form of its output would stop there rather than on someone's screen.
