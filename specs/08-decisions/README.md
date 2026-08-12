# 08 — Decision log

One decision per file: its context, the decision, what was rejected, and why. A
new decision is added instead of rewriting an existing one — a decision that was
later reversed remains useful information.

The log was a single file up to D99. It became this directory so that two
parallel branches would stop competing over the same end of file, and so that
amending an old decision would touch only that decision
([D260809](./D260809-a-decision-is-numbered-by-its-date-and-lives-in-its.md)).

## The identifier

`D` followed by the **date** on which the decision is made, in `YYMMDD` format:
`D260809` is the decision from 9 August 2026. If a second decision is made on the
same day, it adds a letter to the same prefix — `b`, then `c`. A date can be
known without looking at the other branches; a sequential number cannot.

Decisions **D1 to D99** retain their original numbers: too many references cite
them from the code to justify a rename, and an identifier that changes after the
fact is no longer an identifier. They therefore sort by number, while the others
sort by date — the directory is chronological only within each family.

There is no index to maintain: an index would become once again the single file
that this directory replaces.

## Adding a decision

The filename uses the identifier from the title, followed by a slug:
`D<YYMMDD>-<slug>.md`. This is checked.

```markdown
# D<YYMMDD> — A sentence stating the decision, not the problem

**Context.** What made the decision necessary.

**Decision.** What is decided and why.

**Rejected.** The other options and why they were not chosen.

**Consequences.** What this decision requires, costs, or makes impossible.
```

## Referring to another decision

`(Dxx)` as text, without a link: this is the form used by the overwhelming
majority of references in the repository, and the only possible form in a code
comment. `check:specs` verifies that the cited decision exists.

A clickable link remains appropriate when the reference carries the thread of
the text rather than serving as a simple citation:

```markdown
from this directory [D38](./D38-an-access-key-is-not-a-person.md)
from specs/ [D38](./08-decisions/D38-an-access-key-is-not-a-person.md)
```

A `#dxx--…` anchor leads nowhere: it dates from the single file, where all
decisions shared one page. `check:links` resolves every link and reports any
that no longer leads to a file.

## Referring to another spec

This directory is **one level below** the rest of the specs: a link to another
document is written as `[03](../03-data-model.md)`, never `./`.
`check:links` catches this.

The reverse case escapes every check: a spec that refers to a decision but
targets the wrong file sends the reader to a decision about something else, and
the link still resolves. This is the "paragraph that became false" from
`CLAUDE.md`: the writer is responsible for it.

## What is checked

`pnpm check:specs` verifies the identifier format, agreement between the title
and filename, the absence of duplicates, and that every `(Dxx)` reference from
the specs and code leads to an existing decision. This last rule applies
everywhere, including in an example: an identifier written for illustration is
an identifier the check expects to find. Use `D<YYMMDD>` when no specific
decision is intended.
