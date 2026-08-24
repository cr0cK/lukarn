# D260824j — A decision may precede its code, provided it rides the same branch

**Confidence.** stated — owner: Alexis Mineaud, /do-spec arbitration · 2026-08-24

**Context.** The `do-` delivery pipeline writes a decision the moment an interview
settles a design question, on the ground that a choice left in a conversation is
one the next command re-asks. This repository said the opposite: a decision file
added before its code describes an instance nobody is running, so the reasoning
belonged in a plan until a pull request earned the decision. Both rules are sound
and they cannot both be followed, so the question went to the owner the first time
a pipeline command hit it.

**Decision.** A decision is written when the question is answered, not when the
code lands. What bounds it is the branch: the decisions and the code they explain
reach `main` in the same pull request, which they do here because the log lives in
this repository rather than in a store of its own (D260824). Nothing on `main`
therefore describes an instance nobody is running, which is the property the older
rule was protecting.

`specs/09-plans/` keeps the rest of its job. It still holds what spans several
pull requests, and it still holds a decision genuinely **not yet taken** — an open
question with its options, which is a different thing from an answered one.

**Rejected.** Keeping the reasoning in a plan until a pull request earns it, which
is how the 1.2.0 storage work ran. On a branch that lands whole, the plan is a
second place to write the same trade-off, and the decision is then written twice:
once as a plan item and once as the file the plan is deleted in favour of. Also
rejected: writing the decision to `main` ahead of its branch. That is the failure
the older rule named, and no argument here touches it.

**Consequences.** A branch that answers a design question carries decisions the
running instance does not yet follow, for as long as it is open. A decision read
off `main` is still the rule in force, which is what every `(Dxx)` in the code
depends on. This also means an abandoned branch takes its decisions with it, which
is correct: a question answered for work that never shipped was never answered.

It is worth naming what this gives up. A reviewer opening the branch meets rules
stated in the present tense for behaviour the diff has not built yet, and telling
the two apart is the reviewer's job rather than a check's.
