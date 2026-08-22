# Plan — Keeping the specs true, in four layers

A review of the whole corpus on 22 August 2026 found nine claims in `specs/` that
the code had made false, some of them for six months. What the nine have in common
matters more than their number: **every pull request responsible had updated the
specs.** #37 wrote `03`, `05`, `07` and a decision; #41 wrote five documents; #93
wrote all seven. None of them was careless, and no gate reading "were the specs
touched?" would have caught a single one. The failure is never a missing edit, it
is an edit made in the wrong paragraph while the contradicted one stays.

Four layers follow from that, each catching what the one before it cannot. The
first and the third have landed; this plan carries what is left of them and the
two that have not.

## Layer 1 — mechanical, on every push · **done**

[D260822](../08-decisions/D260822-a-decision-states-the-rule-in-force-and-is-rewritten.md):
a decision states the rule in force and is rewritten when that rule changes, and
`check:specs` answers a rewrite with the list of everything that restates it.
Deterministic, no agent, runs inside `verify`.

- [x] The rewrite detected by its title, compared by identifier against the merge
      base, and answered by a `Swept:` line that states what was checked
- [x] D6 and D92 rewritten, each absorbing the decision that had replaced it, and
      every paragraph the sweep named reread

What it cannot see: prose that cites no decision, and drift that accumulated
across several pull requests without any one of them contradicting anything.

## Layer 2 — adversarial, on a pull request that changes behaviour

A sub-agent, given the diff and nothing else, whose task is **to refute rather
than to write**: quote every sentence in `specs/` that this diff has made false.
Not "update the specs for me", which reproduces the author's blind spot and
produces one more paragraph beside the stale one.

- [ ] The refuting brief, and the surface it is given to read
- [ ] Its trigger, and where its verdict is recorded
- [ ] A measured false-positive rate before it is allowed to block anything

Open questions, to settle in the pull request that builds it:

- **What triggers it.** An instruction in `CLAUDE.md` is a rule that depends on
  being remembered, and this repository has twice watched that fail. A hook, a
  `verify` step that refuses without a recorded verdict, or a CI job that comments
  are the three candidates, and they differ in who pays for the run.
- **What it reads.** The whole of `specs/` is 7,800 lines. Handing it the diff
  plus the documents named by the mapping table in `CLAUDE.md` is cheaper and
  probably enough, at the price of missing the document nobody thought to name —
  which is exactly the miss being fixed.
- **Where its verdict is recorded**, so that "did it run" has an answer. A line in
  the commit body, in the shape of `Changelog: none — <reason>`, is the form the
  repository already uses for an escape hatch that states its reason.
- **What happens when it is wrong.** A refuter that cries wolf on correct prose
  costs more than it saves. It needs a cheap way to be overruled, and a record of
  how often it is.

## Layer 3 — a whole document reread, after a merge · **done**

The class neither of the layers above can see: a claim that became false gradually.
`01` said "There is only one encrypted refresh token in a single-row table" until
this week; #89, #91 and #93 each moved a piece, and no single one of them
contradicted that sentence outright. Only a pass that reads a whole document
against the code finds those.

[D260822b](../08-decisions/D260822b-the-specification-audit-is-triggered-by-a-merge-not.md):
`.github/workflows/spec-sync.yml`, triggered by a merge to `main` rather than by a
clock, scoped by the mapping table in `CLAUDE.md`, reading the mapped documents in
full and opening a pull request only when something was false.

- [x] The workflow, its trigger, and the brief that tells it to correct what is
      false and leave what is merely worded oddly
- [ ] Watch the first runs: what it finds, what it invents, and whether the
      "correct only what is false" rule holds without a reviewer enforcing it
- [ ] Fill the holes in the mapping table it scopes itself by — 28 of the 52
      server modules have no row, and a change to one of them routes the audit
      nowhere

## Layer 4 — the reverse direction, if the first three are not enough

Everything above pushes from the code towards the specs. Nothing pushes back: a
specification that has become false is read, never run. `07` already holds the
seed of the other direction with its table of which browser spec proves which
claim, and the drift found this week contained **nothing** from a claim covered
that way.

Generalising it — a section that states a behaviour names the test that holds it,
and `check:specs` verifies the named file exists — turns a false specification
from something to notice into something that fails. It is the most expensive of
the four and the only one that closes the loop; leave it until the cheaper layers
have been measured.

- [ ] Decide whether layers 1 to 3 leave enough drift to justify it

## What is deliberately not being done

**No reorganisation of the seven documents.** `03`, `04`, `06` and `07` were
checked line by line against the code and are accurate. Splitting by subsystem
instead of by reader's question would optimise writing at the cost of reading,
break three hundred references, and repair a problem the measurements place
elsewhere. Only `01` is being rewritten, because only `01` is a summary of the
other six.

**No gate requiring a specs diff per pull request.** Measured yield against the
nine drifts: zero. Cost: friction on every pull request that touches source.
