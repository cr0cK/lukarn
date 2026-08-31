# D260822b — The specification audit is a skill run by hand, not a workflow

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-23

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

**Decision.** The audit is a **skill**, `.claude/skills/spec-sync/`, invoked by hand
as `/spec-sync`. Bare it reads `01` through `07` end to end against the code; named
— `/spec-sync 04` — it reads those. Nothing triggers it automatically.

**It reads the document whole, never the diff.** Reading the diff is what the author
already did, and it is how the nine claims survived. A page reread end to end is the
only thing that catches a sentence three merges falsified between them. This is the
part that has to survive any change of trigger, and it is the reason the audit cannot
be a push gate: it is an agent reading 7,900 lines, not a check that fails in a
second.

**It corrects what is false and nothing else.** An audit that also improves prose
eventually rewrites something true, and a reviewer then has to check every line to
find the one that matters. Each correction cites the `file:line` proving it, and a
claim it cannot settle either way is reported and left alone.

**Scope defaults to everything.** The full corpus is what somebody asking for a sync
wants, and it is what makes the pass free of machinery: reading all seven documents
means there is nothing to route, nothing to queue, and nothing to lose track of.

**Rejected.** **A workflow triggered by a merge to `main`**, which is what this
decision said until the design was measured. It was built, it was merged, and it
never ran once: `anthropics/claude-code-action@v1` answers `Unsupported event type:
push` and exits in 382 ms. The same action on the same credential passes in
`claude-code-review.yml`, so the credential was never the problem — the trigger was
refused outright.

The trigger was the small part. Everything downstream of it existed to make the
audit cheap enough to run on every merge, and each piece leaked:

- the "If you change… / Update…" table in `CLAUDE.md` scoped it, and **28 of the 65
  server modules have no row**;
- `concurrency: cancel-in-progress` collapsed a burst of merges to one run and
  discarded the earlier ones' file lists;
- a guard standing down while a sync pull request was open skipped every merge for
  the length of a review, with no queue to catch up from;
- the `paths:` filter omitted `.github/**` and the root `package.json`, both of
  which [06](../06-configuration-and-deployment.md) makes claims about;
- and a failed run was invisible: nothing blocks, nothing retries, and the one red
  run sat unnoticed for a day.

A full pass run by hand has none of those, by construction. The measured record is
the argument: the automated audit found **zero** drifts across its lifetime, and the
first manual pass found **fourteen**.

**A schedule**, weekly or monthly. It fires when nothing has changed, it does not
fire when everything has, and it must remember where it stopped — a cursor is state,
and state to keep synchronised is the failure being repaired.

**A directory where each pull request drops a note** for the audit to digest. `git
log` is already that inbox, already reviewed, already in this repository's grammar —
#93's commit body contains the very sentence that had to change in `05`. A second
store is one more thing to keep true, and
[D260809](./D260809-a-decision-is-numbered-by-its-date-and-lives-in-its.md) refused
an index for that reason.

**An adversarial refuter on a pull request**, handed the diff and asked to quote
every sentence the diff has made false. It is a strict subset of what a full pass
already does, and it is blind to the case that motivated all of this: no single diff
made `01`'s "single-row table" sentence false. It buys latency, not coverage, at the
price of a second agent on every change and a false positive rate that is what gets
a check disabled.

**Consequences.** Nothing reminds anybody to run it, and that is the cost paid for
deleting five leaks in exchange for one. The anchor is a release: the corpus is
already open at that moment for `CHANGELOG.md`, the cadence is low, and a false
specification is most expensive exactly when it ships with the image.

Rereading the whole corpus is what a run costs, since scope no longer narrows. That
is affordable at the cadence of a release and would not have been at the cadence of a
merge, which is what the machinery above was buying.

The mapping table stays in `AGENTS.md`, where it answers "I changed this, what do I
update?" for whoever is writing the change. What it no longer does is route an
audit, so its holes stopped being work owed to this decision.

**Still open.** Nothing here makes a false specification **fail**; it makes one
easier to notice. The direction that would close the loop is the reverse of every
check in this repository — a section that states a behaviour naming the test that
proves it, and `check:specs` verifying that file exists. `07` already holds the seed
of it in its table of which browser spec proves which claim, and the drift found in
August 2026 contained nothing from a claim covered that way. It is the most expensive
of the options and the only deterministic one; it is worth revisiting once enough
manual passes have been run to say whether they leave enough drift to justify it.
