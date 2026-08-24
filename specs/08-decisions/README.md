---
type: decision-store
---

# 08 — Decision log

One decision per file: its context, the decision, what was rejected, and why.

**A decision states the rule in force, and is rewritten when that rule changes.**
This directory answers "why is it built this way", in the present tense. A log
that kept "No video transcoding" on file while the application transcoded made a
reader reconstruct the truth from a chain of three documents, and made every
`(D6)` in the code gradually false. The history is in `git log` and `git blame`,
where it is complete, dated and attributed; restating it here would be the same
duplication the rest of these documents avoid.

What survives a rewrite is **why an alternative was rejected**. That is the part
worth protecting from being re-litigated, and it does not age: an option turned
down for a reason that still holds is still turned down. What does not survive is
what we believed on a Tuesday in August.

**One question, one decision.** When the answer to a question already decided
changes, that decision is rewritten — a second file answering the same question is
how the log starts to disagree with itself (D260822).

The log was a single file up to D99. It became this directory so that two
parallel branches would stop competing over the same end of file, and so that
amending an old decision would touch only that decision
([D260809](./D260809-a-decision-is-numbered-by-its-date-and-lives-in-its.md)).

## The identifier

`D` followed by the **date** on which the decision is first written, in `YYMMDD`
format: `D260809` was opened on 9 August 2026. If a second decision is opened the
same day, it adds a letter to the same prefix — `b`, then `c`. A date can be known
without looking at the other branches; a sequential number cannot.

**The date allocates the name; it does not date the content.** A decision keeps
its identifier when its rule is rewritten, because that identifier is what a
hundred code comments already say. `git log` gives the content's real dates.

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

**Confidence.** <stated|observed|inferred> — <evidence> · <YYYY-MM-DD>

**Context.** What made the decision necessary.

**Decision.** What is decided and why.

**Rejected.** The other options and why they were not chosen.

**Consequences.** What this decision requires, costs, or makes impossible.
```

Every section is written in the present tense, about the application as it stands.
"Three of that decision's four load-bearing facts have since changed" belongs in
the commit that changes them, not in the file it leaves behind.

## A decision written before its code

A decision may be written before anything implements it. A plan's constraints each
cite one, and a rule nobody can cite is a rule nothing counts, so what a piece of
work binds on is decided before its first line is typed.

Such a file carries one extra line, directly after the confidence line:

```markdown
**Not built yet.** Decided 2026-08-25; no code implements this.
```

It is mandatory there. It goes when the implementation lets the file be rewritten
to `observed`, and that rewrite is the only thing that removes it, so
`grep -rl 'Not built yet' .` answers "what has been decided and is not built". That
is the one question the present tense of this directory cannot answer on its own:
without the line, a rule waiting for its code and a rule the application follows
read exactly alike.

## How the rule is known

The line under the title says where the rule was read from. It exists because a
decision read off the implementation and a decision somebody wrote down from memory
used to look identical, and both were read with the same authority.

| Level      | Means                                                | Evidence names                                      |
| ---------- | ---------------------------------------------------- | --------------------------------------------------- |
| `observed` | read off the implementation                          | a `path:line`, or a command and the output it gives |
| `stated`   | somebody decided it and said so                      | who, and where they said it                         |
| `inferred` | interpreted from a document, so possibly an accident | the document it was read out of                     |

The first two bind: work may not knowingly contradict them. `inferred` is advisory,
and work that goes against it owes an account of why. A line that is absent or
malformed reads `inferred`, which is the direction that costs least when it is
wrong.

## Rewriting a decision

The rule changed, so the sentence stating it changes, so the title changes and the
file is renamed to match its new slug. The identifier does not move, and the
confidence line is rewritten with fresh evidence and that day's date. It never moves
down: a decision the code has contradicted is rewritten to say what is true now, and
reads `observed`.

`check:links` then reports every document linking to the old filename, which is
the point: each one is a paragraph that restated the old rule and is now worth
rereading. `check:specs` adds the source files citing the identifier, which it
lists without demanding an edit — most of them explain a mechanism a rewrite
leaves untouched (D260822).

Fold in, rather than leaving two files answering one question. When the reasoning
that changed the rule already lives in a newer decision, that reasoning moves here
and the newer file goes; its identifier is replaced everywhere it was cited, and
`check:specs` fails on any left behind.

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

The confidence line is not checked. Nothing verifies that the evidence it names
still exists, or that a rewritten decision refreshed it, so a line that has gone
stale is the writer's responsibility in the same way the paragraph that has become
false is.
