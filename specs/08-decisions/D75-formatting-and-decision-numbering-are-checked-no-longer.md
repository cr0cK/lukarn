# D75 — Formatting and decision numbering are checked, no longer left to vigilance

**Context.** Two silent drifts took hold, each because nothing measured it.

First, formatting. `pnpm verify` ran typecheck, lint, tests, `check:specs`, and
`check:links` — not Prettier. `pnpm format` existed only in write mode and ran
only when someone remembered. Five files on `main` had drifted. The real cost is
not aesthetic: the next person to run `pnpm format` also reformats someone else's
work, and their diff mixes their fix with changes that are not theirs.

Then decision numbering. It is done manually, and nothing arbitrated it. One
entry was numbered `D60` while the file went up to `D64`: `main` carried two
`## D60` headings. Then three parallel branches each added "the next one" — all
three `D65`, unseen by each other because each started from the same last number.
The most costly defect is neither: it is a shifted `(Dxx)` reference that remains
syntactically correct and points to a decision about something else. Nothing
breaks, it reads smoothly, and it tells a false story.

**Choice.** `check:format` — a `prettier --check .` — joins `verify` beside
`lint`: two style barriers in the same place. And `check-specs.mjs` gains a
"Decisions" section that rejects a number defined twice and any `(Dxx)` reference
to a missing entry, in the specs **and in the code** — a comment justifying a line
with a decision is the most useful form of reference and the easiest to let rot.

**Rejected.** A `pre-commit` running `prettier --write`: it rewrites files under
the hands of whoever commits, and the repository has already chosen `pre-push`
over `pre-commit` — committing an intermediate step is legitimate; publishing a
state that lies is not.

Also rejected: assigning numbers automatically. A tool that renumbers rewrites
published entries and their references, contradicting the rule "new entry, do not
rewrite old ones". The check observes; it does not arbitrate.

Finally rejected: reporting gaps in the sequence. A gap has no consequence, and
the check would trigger on a legitimate removal. A noisy check ends up disabled —
this is already the purpose of `MODULES_TOLERES`.

The check does not belong in `check-links.mjs`, despite the similarity: a plain
text `(D67)` is not a Markdown link, and
`[D67](./D67-the-moderation-queue-is-a-work-list-not-a-feed.md)`
refers to the file, never the entry. That tool resolves paths and anchors; the
decision check reads a file and counts.

**Consequences.** `verify` grows from five steps to six. Number collisions are
not prevented — two parallel branches can still each choose `D65`, and nothing
can prevent that while numbers are selected at writing time. They cannot,
however, land: the second fails on merge, where the conflict is visible and can
be resolved.

An `(Dxx)` reference in code gains weight: renumbering a decision without
following its mentions fails CI. This is the intended effect, and it applies to
tests and comments as well as specs.

The five files that had drifted are reformatted here, unrelated to the subject of
this work: the backlog from the drift, paid once.
