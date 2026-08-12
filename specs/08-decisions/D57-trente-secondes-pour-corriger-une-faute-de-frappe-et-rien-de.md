# D57 — Thirty seconds to correct a typo, and nothing more

**Context.** A one-sentence comment is posted from a phone, often with one thumb,
and the typo becomes visible a second after sending it. The only remedy was to
delete and rewrite it — which, for a reply, also removes the thread others had
attached to it.

**Choice.** `PATCH /api/comments/:commentId`, restricted to the author, during
`COMMENT_EDIT_WINDOW_MS` (30 s) after publication. `created_at` does not change,
nor does `parent_id`. The deadline is enforced **by the server** — a rule applied
only by the interface is not a rule — and `remainingEditMs` is shared so that both
sides decide identically.

There are three distinct refusals, deliberately. A comment belonging to someone
else responds with **404**, indistinguishable from a nonexistent identifier, as
elsewhere. An elapsed window responds with **409 `edit_window_closed`**: the
refusal concerns the message's **state**, not an access right; its author already
has it in front of them, and explaining it reveals nothing. An empty body responds
with **400**.

**The administrator has no privilege here.** They hide and delete; they do not
rewrite. Removing someone's words and putting different words in their mouth
under their name are two different kinds of power; the latter has no place in a
tool whose entire moderation model rests on explicit reversibility (D36).

**Rejected.** _Unrestricted, unlimited editing_, which turns a thread into a
revisable document: someone replies to a message, the author rewrites it, and the
reply becomes incomprehensible to later readers. This is why messaging services
that allow editing all display an "edited" label — an admission that what is
being read can no longer be trusted. Thirty seconds does not require that label:
nobody has had time to read it.

_A longer window_, five or fifteen minutes: it would make the "edited" label
necessary, then an editing timestamp, then another column — an entire apparatus
for a case deletion already covers.

_Tracking the window only on the client_, with no server enforcement: a `curl`
would be enough to rewrite a six-month-old comment.

**Consequences.** The countdown is displayed on the button ("Edit (12 s)")
because a button that disappears without warning looks like a defect, whereas
its disappearance is the rule here. An open form is not forcibly closed at the
deadline: the server rejects the request and its message is displayed — closing
the field would silently discard text being typed. `Comment.canEdit` is the first
contract value that **expires by itself**; every consumer must cross-check it
with `createdAt`, as the type explicitly states.
