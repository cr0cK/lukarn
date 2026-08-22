# D260822 — A decision that narrows another sweeps the paragraphs it seeded

**Context.** Every documentation check in this repository proves that a mention
**exists**. `check:specs` finds the route, the variable, the migration, the
module; `check:links` resolves the link; D75 added that a `(Dxx)` names a real
decision. None of them looks at the paragraph the new mention contradicts, and
that is where these documents actually rot.

The measurement that prompted this. [D92](./D92-a-video-preview-comes-from-drive-not-local-decoding.md)
said a video poster comes from Drive and nothing is decoded here.
[D260816](./D260816-a-video-preview-is-cut-by-ffmpeg-when-the-backend.md) made
that false. Seven paragraphs across `01`, `02`, `03`, `05` and `07` went on saying
it, and three of them survived a deliberate review of the whole corpus a week
later — a human rereading 7,800 lines for contradictions misses them, which is
the ordinary outcome and not a lapse.

What makes this class invisible is that the pull request **did** update the specs.
#93 touched all seven documents and its own commit body names the sentence that
had to widen: "`MediaItem.hasPreview` widens with it, from 'the backend holds a
preview' to 'an image can be obtained'". The intent was recorded, a new paragraph
was written, and the old one stayed. A gate asking "were the specs touched?" is
therefore worth nothing here — measured against the nine drifts this work found,
it would have caught none.

**Decision.** A decision that replaces part of an older one says so, on a
`**Narrows.**` line naming it. `check:specs` then requires that **every paragraph
of `specs/` citing the narrowed decision also cite the narrowing one** — or stop
citing the old one. Either is one word to write, and neither can be written
without reading the sentence it sits in.

The check reports the line of the citation and sends the author to the four or
five paragraphs about to become false, rather than to the documents that hold
them. Run against D92 the day it was declared, it named seven, three of which
nobody had found.

**The unit is the paragraph, not the file.** Run per file, this check passed
`03-data-model.md` on the strength of one corrected paragraph while another still
read "those belong to Drive" three hundred lines below. One acknowledgement must
not absolve the paragraphs nobody reread.

**Rejected.** Requiring the **code** sites to acknowledge as well. A decision is
cited from eighteen files at the top of the distribution, most of them comments
explaining a mechanism a narrowing leaves untouched. Eighteen mandatory edits to
land one change is a check people route around, and
[D75](./D75-formatting-and-decision-numbering-are-checked-no-longer.md) exists
because a check nobody can live with gets disabled. The source files are listed
in the failure message instead, where the author can judge.

Also rejected: **a `Supersedes.` line that retires a decision entirely.** The log
is a record of how this application was built, and a decision that was later
reversed remains useful; nothing here should encourage retiring one. `Narrows.`
says what it means — part of an older conclusion no longer holds — and leaves the
old file exactly as it was written.

**`Narrows.` is for a conclusion that no longer holds, never for a neighbour.**
This decision was first written declaring that it narrowed
[D75](./D75-formatting-and-decision-numbering-are-checked-no-longer.md), which
added the reference check it extends. The check immediately flagged a paragraph of
`06` citing D75 for its **other** half, formatting, which nothing here touches.
D75 says what checks exist and every one of them still runs; adding a check does
not falsify it. A decision that covers two subjects will be cited for both, so a
narrowing declared out of kinship rather than contradiction produces exactly the
noise that gets a check disabled. Nothing in D75 became false, so nothing is
declared.

Also rejected: **front matter, or a directory-wide index of what supersedes what.**
[D260809](./D260809-a-decision-is-numbered-by-its-date-and-lives-in-its.md) split
the log into files precisely so that two branches would stop competing over one
end of a file. The relation belongs in the file that declares it, and the graph is
computed by reading them.

**Consequences.** The sweep only reaches prose that cites a decision. `01` claimed
"There is only one encrypted refresh token in a single-row table" while citing
nothing, and no graph reaches an orphan sentence: a claim that names no decision
is a claim nothing can hold to account. That is an argument for citing, and the
reason `01`'s scope statements are being rewritten to name the decision each one
rests on.

Two directions remain uncovered and are written down in `specs/09-plans/`: drift
that no single pull request caused, which only a periodic pass over the whole
corpus can see, and the reverse direction — a specification proving itself against
the code rather than being read against it.
