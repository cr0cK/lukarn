# D260822 — A decision states the rule in force and is rewritten when it changes

**Context.** This directory was append-only: a new decision was added instead of
rewriting an existing one, on the grounds that a decision later reversed remains
useful information. Two costs came with that, and both were being paid.

The log said things that were false. `D6 — No video transcoding` was on file while
the application transcoded, and `D92 — A video preview comes from Drive, not local
decoding` while ffmpeg cut posters for three backends out of four. To learn how
video posters work, a reader opened three files in turn and reconstructed the
answer from the chain. That is work handed to every future reader so that no
writer has to edit a file.

And a citation aged. `(D92)` in `routes/media.ts` meant "the reasoning recorded
that day", so it became gradually wrong as the rule moved. There are twenty-three
files citing D92 and twenty citing D6; under append-only every one of them was
slowly drifting from what the code does.

Meanwhile the history the log was preserving is already kept, completely, dated
and attributed, by `git log` and `git blame`.

**Decision.** A decision states the rule **in force**, in the present tense, and is
rewritten when that rule changes. The rule changed, so the sentence stating it
changes, so the title changes and the file is renamed to match. The identifier
does not move: it is what a hundred code comments already say, and it now means
"the current rule on this question" — a citation that stays true instead of one
that decays.

**One question, one decision.** A second file answering a question already decided
is how the log starts to disagree with itself. When the reasoning that changed a
rule already lives in a newer decision, that reasoning is folded into the older
file and the newer one goes, its identifier replaced wherever it was cited. D6 and
D92 each absorbed the decision that had replaced them, on the day this was written.

**What survives a rewrite is why an alternative was rejected.** That is the value
append-only actually protected — not re-litigating what was already turned down —
and it does not age: an option refused for a reason that still holds is still
refused. What does not survive is what we believed on a Tuesday in August.

**The sweep.** Rewriting a decision is a signal, and `check:specs` uses it: it
lists every paragraph of `specs/` and every source file citing that decision, and
asks for a `Swept: D92 — <what was checked>` line in the commit body, in the shape
`check-changelog.mjs` already uses for an escape hatch that states its reason.

The trigger is **the title changing**, compared by identifier between the merge
base and the working tree. Not the file's diff: firing on any edit would have
demanded a sweep of three untouched decisions in the very change that introduced
this rule, whose only edit was a reference pointing at a renamed file. Three false
alarms out of five is how a check earns its way to being disabled. And not git's
rename detection either: a decision rewritten thoroughly enough to matter reads as
one file added and another deleted, which is exactly the case that must not slip
through.

**Consequences.** What this forces is **seeing the list**, not reading each
paragraph. A `Swept:` line can be written without opening anything, and this is
the honest limit of a mechanical check on prose — the reason `specs/09-plans/`
carries a second layer whose entire task is the reading, and a third that rereads
whole documents on a schedule.

The sweep only reaches prose that cites a decision. `01` claimed "There is only
one encrypted refresh token in a single-row table" while citing nothing, and no
graph reaches an orphan sentence: a claim that names no decision is a claim
nothing can hold to account. That is an argument for citing.

Folding costs a wide, mechanical diff — thirty-seven files for the two folds done
here — and the reference check catches any identifier left behind, so the cost is
paid once and verified.

**Rejected.** Keeping the log append-only and adding a `**Narrows.**` line to
declare what a new decision replaced. It was written and it worked, catching seven
stale paragraphs where a human review had found four. It was dropped because it
outsources to a check the job of compensating for a log that lies: the reader still
had to follow a chain, and the citations still decayed. Removing the lie is
cheaper than tooling around it.

**A changelog section inside a decision**, saying what the rule used to be. It is
history in the specs under another name, and `git log` already answers better. The
reasons that mattered survive as **Context** and **Rejected**, which is where they
were always going to be read.

**Renumbering a rewritten decision to today's date.** The identifier is a stable
name, not a claim about when its content was written; moving it would break the
hundred citations that make it worth anything.
