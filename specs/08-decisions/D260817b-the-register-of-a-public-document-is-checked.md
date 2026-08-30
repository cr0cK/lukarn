# D260817b — The register of a public document is checked

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-17

**Context.** The five documents a stranger reads (`README.md`, `CHANGELOG.md`,
`deploy/README.md`, `CONTRIBUTING.md`, `SECURITY.md`) had drifted into a
recognisable register. The measurements at the time: 42 em dashes across 486
lines of `README.md`, 46 across 318 of `CHANGELOG.md`, 65 across 762 of
`deploy/README.md`. Roughly one every seven to twelve lines, plus a recurring set
of constructions that assert something by denying its opposite: "the form asks
for what that kind needs and nothing else", "not just a song", "it is not X, it
is Y", "never a photo, never an API response".

Every sentence was accurate. Nothing was wrong enough to fix on its own, and the
accumulation read as machine-written, which for a project asking strangers to
trust it with their photographs is its own kind of inaccuracy.

**Decision.** `pnpm check:prose` reads those five files and fails on two things.

**Em dashes past a budget per file.** A budget, not a ban: the mark is legitimate
and a check refusing all of them would be argued with rather than obeyed. What is
caught is density, which a comma, a colon or a full stop resolves almost every
time. Version headings in `CHANGELOG.md` are exempt, since `## [1.2.0] —
2026-08-17` is a date separator the file has used since 1.0.0.

**A list of constructions**, each with the plain equivalent named in the failure
message. A check that only says no teaches nothing the second time.

Code blocks and inline code are skipped, so a document can cite the very phrases
it forbids, which `CONTRIBUTING.md` does.

**Only the newest changelog section is read.** The section of a shipped version
is the body of a GitHub release that already exists. Editing it here would make
the file disagree with the page people were sent to, and it is exactly the kind
of edit a check would otherwise demand every time the budget moved.

**`specs/` is out of scope.** Twenty thousand lines and 1912 em dashes, read by
whoever takes over the code rather than by whoever discovers the project. Adding
them would have turned a check into a rewrite, and the rewrite would have been
done by whoever wanted the check to pass rather than by whoever wanted the specs
to read well. The boundary is the same one D64 draws: front door, then the rooms
behind it.

**Not a general style linter.** Vale, `write-good` and textlint all do more than
this, with dictionaries, and would need a dependency, a configuration file and a
policy on every rule they ship enabled. This is sixty lines with no dependency,
and its rules are the specific defects observed in this repository rather than a
vendor's idea of good writing. If the list stops paying for itself, it is one
file to delete.

**What it cannot check.** Whether a paragraph is true, whether it is useful, or
whether the heading above it describes what changed. `AGENTS.md` and
`CONTRIBUTING.md` carry that half of the rule, including the one about a heading
stating the change rather than evoking it: "Three new storage backends alongside
Google Drive" rather than "Photographs no longer have to live in Google Drive".
The check cannot tell those apart, which is why both files say it in words.
