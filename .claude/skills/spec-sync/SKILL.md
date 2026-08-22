---
name: spec-sync
description: Rereads the specifications in specs/ against the code and corrects only what has become false. Invoked bare it audits the whole corpus, one document at a time; given names it audits those. Use when asked to sync, audit or re-verify the specs, when a claim in specs/ looks doubtful, or after a merge changed the code a document describes. Not for writing new documentation, not for improving prose.
---

# Auditing the specifications against the code

Read a document in `specs/` end to end, verify every checkable claim against the
source, and correct only what is false.

**Why this exists.** `check:specs` proves a mention exists, `check:links` proves a
link resolves, `check:changelog` proves a visible change was announced. None of them
reads a paragraph and asks whether it is still true. A review in August 2026 found
nine claims in `specs/` that the code had made false, some standing for six months
— and **every pull request responsible had already updated the specs**. The failure
is never a missing edit. It is an edit made in the wrong paragraph while the
contradicted one stays.

## 1. Scope

**Invoked bare, audit the whole corpus**: `01` through `07`, in order, one document
at a time. This is the full sync and it is the default because it is what somebody
asking for one wants. Do not try to guess a smaller scope from git.

`01` first: it summarises the other six, so it is where a claim goes stale fastest.
`07` is 3,300 lines — take it in sections rather than in one pass, and do not let
its size push the earlier documents into a skim.

Two narrower entry points:

- **Names given** — `/spec-sync 04`, `/spec-sync 02 05` — audit exactly those.
- **`$PUSH_RANGE` set**, which is how CI calls it after a merge: run
  `git diff --name-only "$PUSH_RANGE"` and map those files onto documents with the
  **"If you change… / Update…" table in `CLAUDE.md`**, at most three. That table has
  holes — 28 of the 52 server modules have no row — so when a changed file maps
  nowhere, pick the document describing that subsystem anyway and report that the
  mapping did not name it. A missing row is a finding of its own.

## 2. Read each document whole

Not its diff, and not the parts a recent change touched. Reading the diff is what
the author already did, and it is how those nine claims survived.

A claim usually goes stale across **several** merges, none of which contradicted it
on its own. `01` said "There is only one encrypted refresh token in a single-row
table" while three pull requests each moved one piece of that arrangement. Only a
page reread end to end finds those.

Finish a document before opening the next one. Findings accumulate; the audit is
not over until the last document has been read.

## 3. Verify every checkable claim

A claim is checkable when it asserts something the code settles:

- a number, a size, a timeout, a limit, a default
- a name: a route, a column, a table, a file, an exported symbol, an environment
  variable, a status code
- a quantifier: **only**, **never**, **always**, **the first**, **two cases and no
  others**
- a behaviour: what happens on this input, in this order, with this failure

**Read the source. Never reason from the document**, and never take another spec's
word for it — the point of the exercise is that documents restate each other and go
stale together.

Cheap traps, all of which have caught somebody here:

- a table that was exhaustive when written and no longer enumerates everything
- an "only X" that became "X and Y" when a second implementation landed
- a rule attributed to a column the code has since stopped reading
- a decision cited for a conclusion it no longer holds
- a `(Dxx)` reference to a decision about something else
- a claim about a file that has been renamed, or about a symbol now exported under
  another name

## 4. The three rules

**Correct what is false. Never touch what is merely worded oddly.** An audit that
also improves prose eventually rewrites something true, and then nobody can review
the diff because every line is a candidate. If a sentence is accurate, leave it
exactly as it is, however you would have phrased it.

**Prove every correction.** Each one cites the `file:line` that settles it, in the
report. A claim you cannot settle either way goes under **Could not verify** and the
file is left untouched.

**Follow the repository's own rules**, which are in `CLAUDE.md`:

- English throughout, and the register `check:prose` enforces on public documents
- a rewritten decision in `specs/08-decisions/` needs the `Swept:` line its own
  check will demand
- a spec change that also changes behaviour is not your business here

## 5. Finish

Run `pnpm verify`. It must pass before anything is opened.

**If nothing was false, open nothing.** Say so in one line, naming the documents
read, and stop. A pull request opened to prove the audit ran is how the audit gets
muted.

Otherwise commit — one commit per document, so a reviewer can take them one at a
time — and open a single pull request:

```bash
git checkout -b spec-sync/<date or subject>
git commit -m "docs(specs): what the code now says about <subject>"
gh pr create --base "<the branch you started from>" --label spec-sync
```

Fill `.github/PULL_REQUEST_TEMPLATE.md`. In **What changes**, group by document, one
bullet per correction, each carrying three things: the claim as it stood, what the
code actually does, and the `file:line` that shows it. End the body with the
documents you read and found accurate — a reader needs to know the audit covered
them, not just that it said nothing about them.

You are auditing, not designing. If a document describes something you think is
wrong in the **code**, that is not your business here: say it in the pull request
body and change nothing.
