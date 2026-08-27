# D260825b — A link that once worked says whether it was revoked or expired

**Confidence.** stated — owner: Alexis Mineaud, /do-plan challenge on Sharing-without-an-account · 2026-08-25

**Context.** D12 answers a refusal with 404 rather than 403 so that nobody learns by probing that
other people's albums exist. Carried over to a share link unchanged, it answers a revoked link with
"page not found", which is what a mistyped address also answers. The person reading it was sent
that link a month ago by somebody they know, and cannot tell whether they got the address wrong or
whether it was taken back.

**Decision.** A token that **existed** and no longer works answers **410**, and says which of the
two happened, revoked or expired. A token that never existed answers **404**, exactly as any other
unknown address does.

Nothing a stranger can discover changes. Reaching the 410 requires already holding thirty-two
random bytes, which is the same thing as having been sent the link; guessing is not a route to it,
and 410 confirms only what its reader was already told by the person who sent it.

**D12 stands unchanged, and this is not an exception to it.** Its question is what an **album or a
media item** answers when the caller may not have it, and that answer is still 404 here: a link
that covers one album says nothing about any other, and a live link to a forbidden album is a 404
like every other. What this decides is a different question — what a **credential** answers once it
has stopped working — on a surface D12 predates.

**Rejected.** _404 everywhere, with the reason in the body._ It keeps one status code, and it makes
the response say two things at once: a body explaining that the link was revoked, under a code
stating that nothing was found. Every cache and every log between the two would record the 404.

_403 for a revoked link._ The one status D12 reserves for administration, whose existence is not a
secret. Spending it here would leave the invariant with two exceptions and no way to state it in a
sentence.

_Deleting the row on revocation._ It is the obvious implementation and it makes this decision
impossible: with the row gone, revoked and never-existed are the same state, and the server has
nothing left to tell them apart with. D15 already retains a revoked Google token for the neighbouring
reason — so that `/admin` can distinguish "never connected" from "access removed".

**Consequences.** A revoked link is kept, and its record of use with it (D260825c), so
administration can still show what a link did before it was cut off. Only deleting the link outright
removes both, and that is a separate gesture from revoking.

Expiry is evaluated against the row rather than baked into the token, so a link's date can be
changed or removed after it was sent.

The page shows the difference in words rather than in a status: "this link was taken back" and
"this link has expired" are two sentences in both catalogues, and neither offers a way to sign in
(D260825d).
