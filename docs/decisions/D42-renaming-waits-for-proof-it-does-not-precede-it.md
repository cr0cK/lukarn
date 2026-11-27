# D42 — Renaming waits for proof; it does not precede it

**Confidence.** stated — owner: Alexis Mineaud, pre-pipeline hand-authored store · 2026-08-12

**Context.** Found during cross-review. `requestCode` wrote `display_name` as soon
as it was requested, with this comment as justification: "it is revalidated by
the following code anyway". That was false in terms of operation order — the
write preceded validation, and nothing undid it if the code was never entered.

The consequence went beyond the name itself. A comment's signature is not frozen
when it is written: the thread reads it by joining `commenters`. It was therefore
enough to know someone's address — and behind an access key shared by a household,
it is known — to rename **all their past messages** at once, without access to
their mailbox.

**Choice.** The requested name for an **already verified** identity waits in
`pending_display_name`; `verify` applies it, and only it. An identity that
has not yet been verified continues to be written directly: nothing is signed by
it, so there is nothing to hijack.

**Rejected.** Freezing the name on the comment row when it is written, which
would also solve the hijacking. Rejected because renaming would then cease to
apply to history: "Granny" becoming "Grandmother" would leave two signatures for
the same person, while the spec promises the opposite. Also rejected: refusing
the request when the address belongs to a verified identity — this is precisely
the path taken by someone re-identifying themselves from a new device, by far the
most common case.

**Consequences.** An abandoned request leaves a pending name with no visible
effect; the next request overwrites it. Renaming remains global and retroactive —
this is the desired behaviour, since the identity is the address and the name is
its current label.
