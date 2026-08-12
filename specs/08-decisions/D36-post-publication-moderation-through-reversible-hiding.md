# D36 — Post-publication moderation through reversible hiding

**Context.** The administrator needed a way to remove a comment.

**Decision.** The comment is published immediately and can be **hidden**
afterwards from `/admin`. `hidden_at` and `hidden_by` carry the decision. A
hidden comment disappears from view for everyone, including its author.

**Rejected.** Pre-moderation, where every message awaits approval. On a family
gallery whose accounts are created manually by the owner, it delays everyone
for a risk that does not exist: there are no strangers. It also has a hidden
cost — the author does not see their own message appear and assumes something
is broken.

Also rejected: **letting the author see their hidden comment**, as major
platforms do. This amounts to letting them believe people can still read it.
The decision might as well be visible: that is what distinguishes transparent
moderation from shadow banning.

Finally, outright deletion was rejected. Hiding keeps the decision reversible,
which matters when it is made quickly. Permanent deletion remains possible via
`DELETE /api/comments/:id`.

**Consequences.** A reply whose root is hidden moves to the top of the thread
(see D35). `hidden_by` is displayed in the moderation queue rather than kept as
a dead trace: on an instance with several administrators, that is the first
question people ask.
