# D260812d — The language travels in `Accept-Language` and is recorded against the identity

**Confidence.** observed — plugins/locale.ts, git ls-files → exit 0 · 2026-08-23

**Context.** The interface knows which language it speaks: the browser chose it,
or the reader did, from the account menu. The server does not. Yet it writes two
kinds of text a person reads — the message accompanying a refusal, and the emails
it sends hours later — and both were in English regardless of who was reading.

Two problems, and they are not the same one.

A **refusal** is read immediately, in the tab that provoked it: "Incorrect
username or password" appears under a French form. The request already knows the
language, and only needs a way to say so.

An **email** is read later, elsewhere, in an inbox. Nothing about the message
that triggers it says which language its recipient reads — a comment reply is
composed for someone who is not connected at all.

**Decision.** The language travels as `Accept-Language`, and identities remember
it.

The front end sends its chosen language as `Accept-Language` on every API
request, overriding what the browser would have sent by itself. The standard
header, rather than a header of our own: unsubscribe links are opened straight
from an inbox, outside the React application, and a real browser sends its
preference list there — the same code path then works for both, quality factors
included. `plugins/locale.ts` resolves it before authentication so that
`requireAuth` already refuses in the right language, and exposes `request.t`.

When the session carries a commenter identity, that language is written to
`commenters.locale`, **only when it differs** from what is stored (migration 16).
The guard is not an optimisation detail: this hook runs on every thumbnail
request, and an unconditional `UPDATE` would put a write on the critical path of
a cold grid.

**On `commenters`, not on `users`.** A username is an access key a household may
share; an email address lands in one inbox belonging to one reader. The interface
language stays in the browser (`localStorage`) for the same reason read from the
other end: the television in the living room and the phone in a pocket share one
key and need not share a language.

**`DEFAULT_LOCALE` covers what has no reader.** The moderation address is an
instance setting, not a person: it belongs to no identity and has no recorded
language. Same for a subscriber who has never opened the gallery in a supported
language. The variable exists so that a French installation does not send those
in English by default.

**Logs stay in English.** They are read by whoever operates the instance, beside
a stack trace and the code itself.

**Rejected.**

_A `PUT /api/me/locale` endpoint._ One more route, one more client call to keep
in step with a value that already accompanies every request. The header cannot
fall out of sync with what is on screen; a separately-pushed preference can.

_Storing the language on the session._ A session is a browser, so this would be
correct for the interface — which does not need it, `localStorage` already
answers — and useless for email, whose recipient has no session open at the
moment of writing.

_Translating emails at reading time_, by sending a link to a page rather than
text. An email that renders nothing without fetching from the server is also an
email that reports having been read, and it stops working the day the gallery is
unreachable.

_Reading `Accept-Language` on the sign-in request only._ It would freeze the
language of a year-long session on whatever the browser was set to that day, and
the account menu would change the interface without ever changing an email.
