# D260809d — The log becomes a directory, and the archive is split with it

**Context.** [D260809](./D260809-numerotation-des-decisions.md) made every
**new** decision a file, while leaving the first ninety-nine in the original
log. This division reflected a constraint at the time: two branches were open,
and moving four thousand lines would have made them conflict. They have now been
merged.

Once the constraint was removed, what remained was no longer a compromise but
an inconsistency, with three costs:

- **Amending an old decision** — qualifying it or marking it superseded — meant
  editing a four-thousand-line file, recreating exactly the conflict that
  D260809 had just removed for additions. The benefit applied only to creation.
- **Two ways to read a decision** depending on its age, although nothing
  distinguishes them in use.
- **An `08-decisions.md` file still present**, which `CLAUDE.md` still directed
  writers to in two places. The check rejected the write; the documentation
  required it.

**Decision.** Document `08` **is** the `specs/08-decisions/` directory. Each of
the ninety-nine entries becomes its own file there, and the single file
disappears.

The directory carries the series number rather than a separate name: "01 → 02 →
08" remains true everywhere it was written, and there is no longer an `08` that
might appear writable.

**D1 to D99 keep their numbers.** Renaming them by date would cross the three
hundred references to them in the code, and an identifier that changes after the
fact is no longer an identifier. Two families therefore coexist — sequential
numbers for the old decisions, dates for the rest — and `check:specs` accepts
both. The directory is chronological only within each family: that is the cost
of a stable identifier, and it is small compared with a rename.

**Rejected.** _Zero-padding the archive filenames_ to three digits so the whole
directory sorts from end to end. The filename would no longer exactly reflect
the identifier in the title — the very rule enforced by `check:specs` — for a
display order nobody needs.

_Keeping the archive in one file_ and simply correcting the two now-false
references in `CLAUDE.md`. This addressed the most visible symptom while leaving
the first cost intact: an old decision would remain impossible to amend without
a conflict.

_An `08-decisions.md` reduced to a contents page_ pointing to the directory. A
contents page is an index, and an index becomes once again the shared insertion
point that all this work removes.

**Consequences.** The move covers 2,907 lines, with no guarantee that none would
be lost along the way. The split was therefore performed by one script and then
checked by a second, written independently: it compares the multiset of
significant lines in the original log with that of the resulting files. Both
counts are 2,907, with no missing line.

The links underwent three separate transformations, all checked by
`check:links`: `#dxx--…` anchors became file links, references to the other specs
moved up one level, and a link labelled "08" followed by a number in text became
a link labelled with that number, finally pointing to what it names.

[D260809](./D260809-numerotation-des-decisions.md) named the directory
`specs/decisions/` and described a sequential log still open for reading. Both
statements are **corrected in that decision**, with a reference to this entry: a
decision keeps its reasoning, never a false path. A cross-reference that lies
costs more than the trace of a rename, and nothing reported it — neither the
`(Dxx)` reference check, which covers decisions, nor `check:links`, which only
follows Markdown links.

`check:specs` now closes that gap: a specs document cited as text in backticks
must name an existing file. This directory is excluded, as it has to be — a log
names what it replaced, and requiring that target to exist would make the log
impossible to write.
