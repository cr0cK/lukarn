# D260809 — A decision is numbered by its date and lives in its own file

**Context.** The decision log was a single file nearly four thousand lines long,
with each new entry appended using the next sequential number. Two parallel
branches collided in it in two ways, and work is done in worktrees, so several
branches are permanently active:

- **the same identifier**, because a branch can only know the last number on
  `main` — two branches opened on the same day choose the same one;
- **the same insertion point**, at the end of the file. This is the costlier one,
  because it occurs **even when the identifiers differ**: git sees two additions
  at the same line and hands control back. The resolution then involves ninety
  lines of prose, at a point — the merge — when the work was thought to be done.

A check for identifier collisions had already been introduced (D75). It reports
them, but does not prevent them, and says nothing about the second flaw.

**Decision.** A decision's identifier is **the date on which it is made**, in
`D<YYMMDD>` format — `D260809` for this one — followed by `b`, then `c`, if the
day already has one. A decision is **one file**,
`specs/08-decisions/D<YYMMDD>-<slug>.md`.

A date can be known without looking at other branches, which a sequential number
does not allow. One file per decision removes the shared insertion point: two
branches create two files, and there is nothing for the merge to arbitrate.

The sequential log keeps D1 to D99 and accepts no new entry: splitting it would
have conflicted with the two branches open when this decision was made. It was
split as soon as they had been merged, and the directory has since carried the
document number ([D260809d](./D260809d-the-log-becomes-a-directory-and-the-archive-is-split.md)).

`check:specs` checks that the identifier follows the format, that the filename
reflects the title, that no identifier is used twice, and that every reference
`(Dxx)` — in the specs as well as the code — leads to an existing decision.

**Rejected.** _Renumbering on merge_, with a branch using a provisional number:
this is a rename, and a rename crosses the three hundred `(Dxx)` references in
the code. A decision cited in a comment would change name after the fact, which
is exactly what an identifier must never do.

_Keeping sequential numbers_ and merely checking uniqueness: this addresses the
identifier collision, never the insertion conflict, which is the real cost.

_Also splitting the ninety-nine existing entries_: moving four thousand lines
would make every open branch conflict, for consistency that nobody reads — a log
is not read from end to end; an entry is looked up. The cut-off is clear and can
be documented; it is the same trade-off as the accepted difference between PR
titles and commit messages in the first eleven PRs.

_Using the pull request number as the identifier_: unique by construction, but
known only once the PR is open, and therefore requiring a systematic rename
afterwards.

_A generated index listing the directory_: that file would become the shared
insertion point that has just been removed. The directory sorted by name already
gives the chronological order of dated decisions.

**Consequences.** Two identifier formats coexist — at most three digits for the
old log, six for what follows — and this is unambiguous both to readers and to
the check. No existing reference changes.

Two decisions made on the same day on two branches unaware of each other will
use the same identifier, neither with a letter. `check:specs` reports this at
merge time, and the correction is a `git mv` on a decision that has never been
published: there is no external reference to rewrite. This case is rare, whereas
a sequential-number collision was certain.

There is no index to maintain, and therefore no index to forget.
