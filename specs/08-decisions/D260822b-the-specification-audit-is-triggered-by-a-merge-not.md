# D260822b — The specification audit is triggered by a merge, not by a clock

**Context.** Every documentation check here proves that a mention **exists**:
`check:specs` finds the route and the variable, `check:links` resolves the link,
`check:changelog` requires an announcement. None of them reads a paragraph and asks
whether it is still true, and a review in August 2026 found nine claims in `specs/`
that the code had made false, some of them standing for six months.

The three pull requests responsible had **all** updated the specs — #37 wrote four
documents, #41 five, #93 all seven. So the obvious gate, "did this change touch
`specs/`", has a measured yield of zero against the very defect it would exist for.
What is missing is not an edit; it is somebody rereading the page around the edit.

[D260822](./D260822-a-decision-states-the-rule-in-force-and-is-rewritten.md) covers
one part of that mechanically, by sending an author to whatever restates a decision
they rewrote. It cannot see the rest: `01` claimed "There is only one encrypted
refresh token in a single-row table" while three pull requests each moved one piece
of that arrangement, none of them contradicting the sentence outright.

**Decision.** A workflow rereads a **whole document** against the code, and a merge
to `main` triggers it. `.github/workflows/spec-sync.yml` runs the Claude Code action
already used by two other workflows, on the same credential.

**The trigger is a merge because that is when the answer changed, and because a
merge says which answer.** Work here arrives in bursts: a weekly run fires on the
four weeks nothing happened and stays quiet for the five days after five merges. A
merge also carries what no calendar does — the files it touched — and the
"If you change… / Update…" table in `CLAUDE.md` turns those into the documents that
follow them. The audit reads at most three.

**It reads the document whole, never the diff.** Reading the diff is what the author
already did, and it is how the nine claims survived. A page reread end to end is the
only thing that catches a sentence three merges falsified between them.

**The brief is a skill, not a prompt in the workflow.**
`.claude/skills/spec-sync/` holds it, the workflow invokes `/spec-sync`, and the
same words can be run by hand on a worktree — which is how it gets tried before it
is trusted. Writing it out in the YAML as well would be a second copy to keep true,
inside the job that exists because copies drift.

**It corrects what is false and nothing else.** An audit that also improves prose
eventually rewrites something true, and a reviewer then has to check every line to
find the one that matters. Each correction cites the `file:line` proving it, and a
claim it cannot settle either way is reported and left alone.

**Rejected.** A **schedule**, weekly or monthly, which is where this design started.
It fires when nothing has changed, it does not fire when everything has, and it must
remember where it stopped — a cursor is state, and state to keep synchronised is the
failure being repaired.

A **rotation** over the seven documents, one per run, chosen by the week number. It
removes the cursor and keeps the wrong clock: a document is audited on its turn
rather than when its subsystem moved.

A **directory where each pull request drops a note** for the audit to digest. `git
log` is already that inbox, already reviewed, already in this repository's grammar —
#93's commit body contains the very sentence that had to change in `05`. A second
store is one more thing to keep true, and
[D260809](./D260809-a-decision-is-numbered-by-its-date-and-lives-in-its.md) refused
an index for that reason.

Letting it **push to `main`**. It opens a pull request, labelled `spec-sync`, and
stands down while one is open — three pull requests saying the same thing is what
teaches everyone to ignore the first.

**Consequences.** The audit runs after the merge, so its corrections arrive as a
follow-up rather than inside the change that caused them. That is the trade for not
blocking anybody's pull request on a model's opinion of their prose.

Its scope depends on the mapping table in `CLAUDE.md`, which has holes: 28 of the 52
server modules have no row. A change to one of those routes the audit nowhere, and
the document it should have opened waits for a merge that does map. The table is
worth filling for this reason as much as for its own.

A burst of merges collapses to one run, since the later one reads the tree the
earlier ones were heading towards. What it loses is the earlier merges' file lists,
so a subsystem touched only by the cancelled runs is not mapped until it is touched
again.

Nothing here blocks a release, and a run that finds nothing opens nothing.
