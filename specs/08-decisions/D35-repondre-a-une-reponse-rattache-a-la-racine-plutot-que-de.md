# D35 — Replying to a reply attaches it to the root instead of rejecting it

**Context.** The requirement was "a single reply level". It remained to decide
what the server does when `parentId` points to a reply.

**Decision.** The message is attached to the **thread root**. The front end does
not display a "Reply" button below a reply.

**Rejected.** Returning `400`. A user who reaches this case — through a
third-party client or an interface that might evolve — has a perfectly clear
intent: to write in this thread. Returning an error they cannot correct has no
value. Also rejected: allowing depth and flattening it for display, which would
have left a hierarchy in the database that nobody uses and that would have had
to be traversed on every read.

**Consequences.** `parent_id` **never** points to a row that itself has a parent
— an invariant maintained by `rootOf()` on write, rather than by an SQL
constraint, which SQLite cannot express here. Reading a thread is therefore
simple: a single pass, with roots preceding their replies because id order is
write order. The corollary is that a reply whose root disappears (deleted
account, hidden comment) moves to the top of the thread rather than
disappearing: it belongs to its author, not to the person it cites.
