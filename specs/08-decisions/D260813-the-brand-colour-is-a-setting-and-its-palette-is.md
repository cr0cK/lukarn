# D260813 — The brand colour is a setting, and its palette is derived in TypeScript rather than by `color-mix()`

**Context.** The project has a mark: a rounded black square, a white `L` and a red
dot standing for both the lucarne and the lens. The dot's red is the identity —
and it is one operator's red. This gallery is self-hosted software: the person
running an instance for their family did not choose this colour, and no reason
exists to impose it on them. Meanwhile the interface had a fixed
`--color-accent: #7aa2ff` with a single companion, `--color-accent-dim`, both
literals in `styles.css`.

Making the colour configurable raises a second question at once. One colour is
not enough to paint an interface: a filled button needs a readable label, a
hovered row needs a tint of the same colour, a focused field needs a darker
edge. Those three follow from the primary colour, and something has to compute
them.

**Choice.** `AppSettings.primaryColor` — `#rrggbb`, default `#eb2020` — and
`derivePalette()` in `packages/shared/src/branding.ts`, returning four hex
strings: `accent`, `accentDim` (28 % darker), `accentSoft` (16 % of the accent
mixed into `--color-ink-850`) and `accentInk` (white or `--color-ink-950`,
chosen by relative luminance).

`shell.ts` writes all four into the `style` attribute of `<html>`, into a slot
`index.html` already carries. `styles.css` keeps the same values as `@theme`
defaults, so `pnpm dev` — where Vite serves the page without the server — looks
like production, and so does a stylesheet read on its own.

**Why not `color-mix()`.** It is the direct expression of every derivation here,
it needs no code, and it would put the whole thing in `styles.css`. It also does
not exist before Chromium 111, and the television this gallery is actually read
on reports Chromium 79 (D260809f). An unparseable colour is not approximated: the
declaration is dropped. A hovered row would lose its background rather than its
tint, and a filled button its fill. The build-time lowering that handles
`oklch()`, cascade layers and independent transforms (D260809i) cannot help here,
because the value depends on a custom property whose contents Lightning CSS
cannot know.

Deriving in TypeScript also puts the calculation where both ends can share it:
the server writing the shell, and the administration form previewing a colour
nobody has saved yet. Two implementations would drift, and the one that drifted
would be the preview — the only one nobody compares against anything.

**Why inline on `<html>` rather than a `<style>` block.** An inline custom
property outranks any stylesheet rule for the same element, whatever order Vite
emits its `<link>` in; a `<style>` block would be competing with Tailwind's
`:root` at equal specificity, decided by source order that a tooling update can
change. Inline is also parsed before the first paint, so nobody watches the
built-in red flash into the configured colour.

**Where `accentInk` switches.** At a relative luminance of 0.3, not the 0.179
where white and near-black tie by WCAG contrast. At that exact tie both measure
around 4.5:1, so the choice falls to what a saturated colour looks like: the
default red lands at 0.19, where near-black measures a hair better and reads far
worse. Above 0.3 only pale accents remain, and near-black is unambiguous there —
which is what the previous fixed blue already used, so nothing changes for an
instance that keeps a light accent.

**Accepted consequence.** Red becomes the default primary colour while
`red-300`/`red-400`/`red-500` remain the error and destructive colours across
some thirty usages. Hue alone no longer separates a primary button from a delete
button. They stay distinguishable by form — a filled surface against text on a
tinted panel — which is how every red-branded product handles it, and an operator
who dislikes it now has a colour picker.
