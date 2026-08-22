# D260813d — Tailwind's own variables are initialised for every engine, not for the two its sniff names

**Confidence.** observed — tools/legacy-css.ts, git ls-files → exit 0 · 2026-08-23

**Context.** Adding an accent outline to the selected administration section
(D260813) meant using Tailwind's `outline` utility for the first time. It
compiles to `outline-style: var(--tw-outline-style); outline-width: 1px`.
Checking where that variable comes from turned up something larger.

Every Tailwind v4 utility built on a variable dereferences it unconditionally.
`.border` is `border-style: var(--tw-border-style); border-width: 1px`;
`.border-b`, `.divide-y` and the `space-*` utilities are the same. The value
normally comes from `@property`, which does not exist before Chromium 85.
Tailwind knows this and ships a fallback block setting every variable on
`*, ::before, ::after, ::backdrop` — but behind

```
@supports (((-webkit-hyphens: none)) and (not (margin-trim: inline)))
       or ((-moz-orient: inline) and (not (color: rgb(from red r g b))))
```

which is a **detection written for Safari and Firefox**. Chromium 79 matches
neither branch and has no `@property` either, so the variables are never set.

An unset custom property does not degrade: `border-style: var(--tw-border-style)`
is invalid at computed-value time, `border-style` reverts to its initial `none`,
and **every border in the application is absent** — the top bar's hairline, every
panel, every field, every divider. Measured in a browser by removing the variable
on a page that has it: `solid` becomes `none`.

This is the same defect D260809i describes for cascade layers and
`replaceIndependentTransforms` fixes for `--tw-translate-*`, met from the other
end: there the fallback was missing at the call site, here it exists and is
addressed to two other engines.

**Choice.** `unguardVariableInitialisation` in `tools/legacy-css.ts` replaces that
conditional block with its contents, so the values apply everywhere.

The block is matched **by shape** — an `@supports` containing nothing but a
`*, ::before, ::after, ::backdrop` rule made only of custom properties — not by
the condition string, which would silently stop matching the day it is reworded.
That shape is unambiguous: an `@supports` guarding a real style rule is a
deliberate fallback and is left alone, which is what keeps the `color-mix()`
blocks intact. Those are correct as they stand: Tailwind emits the plain-hex
version just before each one, and an old engine skips the guarded copy and keeps
the hex.

**Why replace rather than duplicate.** Applying these values everywhere is
exactly what the block is for, and an engine with `@property` computes the same
thing from them — Tailwind already sends this block to Safari and Firefox
versions that do have `@property`. Specificity is unchanged: `*` loses to every
utility class, so `outline-none` still overrides what it is asked to.

**And a check, because the fix is invisible when it stops working.**
`findUnloweredDeclarations` now reports an initialisation still trapped inside an
`@supports`, and — separately — a `--tw-border-style` that some utility reads
while nothing sets it. Two rules rather than one because "Tailwind stopped
emitting the block" and "the block was hoisted" produce the same absence of
`@supports`, and only the second is correct.

**Scope of what this repaired.** Not only the outline that prompted it: borders,
dividers and `space-*` were already affected, on every page, for the whole life of
the Tailwind v4 migration. Nothing reported it — the build passes, the tests pass,
and the application is correct on the machine that builds it.
