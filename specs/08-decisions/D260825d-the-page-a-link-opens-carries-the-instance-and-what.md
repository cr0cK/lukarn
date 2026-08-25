# D260825d — The page a link opens carries the instance and what was shared, and no way further in

**Confidence.** stated — owner: Alexis Mineaud, /do-spec Decision Record Q4 on Sharing-without-an-account · 2026-08-25

**Not built yet.** Decided 2026-08-25; no code implements this.

**Context.** The person opening a link did not choose this application, holds no password, and is
reading a message on a phone. Two failures are available and they pull in opposite directions. A
page carrying nothing but photographs has no sender: it has the shape of a phishing message, and the
sensible reaction to it is to close the tab. A page carrying the whole application advertises that
this instance has accounts, a sign-in form and albums behind it, to somebody who was given one
album.

**Decision.** The page carries the instance's name, its logo, and what was shared. It carries no
album list, no sign-in control, and nothing indicating that other content exists.

Both halves already cost nothing to build. `useInstanceName()` reads the name out of the document's
metadata with no network call, and `/api/branding/logo` is a public route because it is requested
before any session exists — which is why the sign-in screen can show both. Non-indexability is
likewise already true of every page: `noindex, nofollow` sits in the one shared HTML template, so a
share page inherits it rather than asking for it.

What this rules out is reuse that would leak. The top bar wraps the mark in a link to the album list,
the bottom tab bar is a hardcoded route to it, and the account menu offers settings, administration
and sign-out. A share page mounts none of them, in the way `/pair` and `/diagnostic` already mount
no chrome at all.

**Rejected.** _The bare page, photographs and nothing else._ It is the smallest thing that works and
it fails the person it was built for: a stranger's link opening on unexplained family photographs is
indistinguishable from a message worth deleting.

_The application as it stands, with the album list emptied._ Cheapest by far, since the page would
be the existing gallery with a different data source. It leaves the sign-in control in the corner,
which tells everybody who was ever sent a link that there are passwords here to try, and it leaves a
route back to a list that answers 404 — a dead end presented as a destination.

_Choosing indexability per link._ The intent raised it and it is refused for being unrecoverable:
a link marked indexable and then revoked stays in a search index, where nothing this application
does can reach it.

**Consequences.** The share route is registered outside the guard that sends an unauthenticated
visitor to the sign-in screen, beside `/diagnostic`. Ordering does not come into it: this router
matches by computed rank, so the catch-all sorts last wherever it is written.

**A link opens one page, and the guard has to say so.** The session a link opens answers
`/api/auth/me` like any other (D260825), and the front-end guard admits anybody that call answers
for — so on its own that session would render the album list, the settings screen and the account
menu with its sign-out control, which is the whole of what this decision refuses. The guard is
therefore told what kind of session it is holding, rather than only whether it is holding one, and
a link's session reaches the share page and nothing else. The server refuses the rest in any case;
what is at stake here is that the recipient is never shown it.

The mark needs a way to render unlinked. That block has two states today and both assume an album
list exists.

A link that has stopped working shows its sentence on this same page rather than on a generic error
screen (D260825b), which is the only way its reader learns what happened without being offered a
password field to guess at.
