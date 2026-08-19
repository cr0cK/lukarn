# D260819c — The language of an invitation is chosen by whoever sends it, and followed to the end

**Context.** [D260812d](./D260812d-the-language-travels-in-accept-language-and-is.md)
settled how this instance knows which language to write to somebody in: the browser
announces it with `Accept-Language` on every request, and the language is recorded
against the commenter identity, so an email composed hours later reaches its reader
in the language they read. That rule assumes a reader who has been here.

An invitation ([D260819b](./D260819b-a-bound-account-signs-in-with-a-code-sent-to-its.md))
is the one message that breaks the assumption. It is composed for somebody who has
made no request to this instance: no row of `commenters` carries their address, or
one carries it without a language, and what they read is recorded nowhere. D260819b sent
it in `DEFAULT_LOCALE` for exactly that reason. On an instance whose readers share a
language that is right; on the instance this project is built for, a family with
French on one side and English on the other, it is right half the time and there is
nothing in the request to say which half. The one message read by somebody who has
never seen this application was the one message nobody could aim.

**Decision.** Whoever invites chooses the language, the choice is stored on the
invitation, and every later step follows it.

**The inviter is the party asked**, because they are the only one who can answer.
The recipient cannot: asking them would mean a message in some language reaching
them first, which is the question being settled. The instance cannot: `DEFAULT_LOCALE`
is what a bilingual household gets wrong. The administrator knows which relative
they are writing to, and is already filling in a form that names them, so the answer
costs one control beside the address. It starts on the language that administrator
is reading the interface in, since somebody about to write to somebody usually
writes in the language they are reading themselves, and the choice is about the
message rather than about the screen it was sent from: that screen stays in its own
language, and the confirmation under it is read in that one.

**It is stored on the code, rather than passed once.** `verification_codes.locale`
(migration 19) holds it, so it survives the request that made it. The reason is the
resend: sending an unread invitation again is one button on the account row, with no
address to give and no form to ask a second question on, and the same message is
minted again by `POST /api/auth/code/request` when its recipient asks for it from
the sign-in screen. A choice held only in the first request would have both of those
falling back to the instance default, and the same invitation arriving twice in two
languages reads as two different messages rather than as one sent again. Between
always defaulting and defaulting on the second attempt only, always defaulting is
the lesser defect. The column is nullable rather than `DEFAULT 'en'`: "nobody chose"
and "chose the language that happens to be the default today" are different answers,
and only the second must survive a change to `DEFAULT_LOCALE`.

**A language this instance does not speak is refused**, with `400`, rather than
folded back to the default. The header `plugins/locale.ts` reads degrades on purpose,
because a browser announcing `de` is stating a preference nobody typed here. A form
field is the opposite: somebody picked a value, and sending the message in another
language while answering `201` would report a success that did not happen.

**Consuming the invitation seeds `commenters.locale`, and never overwrites it.**
The identity created or adopted at that moment gets the language its invitation was
written in, so the notifications composed before that person's first request are
already readable to them. A value already stored came from that person's own browser,
which D260812d makes authoritative, and a choice somebody else made on their behalf
must not displace it. The rule lives in the statement rather than in a branch above
it, `WHERE id = ? AND locale IS NULL`, so no caller can bypass it. From the first
request onward, `Accept-Language` reclaims the value exactly as before.

**The interface takes the same language when the session opens**, and only from an
account bound to a person. That account is one reader, so what they are written to
in is evidence of what they read. A shared key is not: a household holds one key and
need not read one language, which is why D260812d put the interface language in
`localStorage` and left it there. The television in the living room is the case that
rule exists for, and it keeps its own language whoever signs in on it. The adopted
language is applied and never stored, so a decision made in `/settings` still
outranks it and this browser can still fall back to its own preference. It is applied
on the response that opens the session rather than on a later read of `/auth/me`,
because `plugins/auth.ts` records `Accept-Language` on every authenticated request:
a request going out before the adoption would write this browser's language over the
seeded one, and the change would undo itself on the first request it caused.

**Rejected.**

_Reading the inviting administrator's `Accept-Language`, with no field at all._ It
costs nothing and is right whenever the two people read the same language, which is
most of the time and never all of it. What makes it worse than the default it
replaces is that it looks correct: an administrator reading English invites their
French-speaking mother, the message goes out in English, and nothing anywhere says a
language was decided. A control that starts on that same value keeps the cheap case
cheap and leaves the other one visible.

_Asking, and not storing._ One field on the creation form, the language used for
that one message. The resend button then has nothing to read and falls back to the
default, so the copy sent because the first went unread arrives in another language
than the first, on the exact path taken by somebody who is already lost.

_Writing the language onto `commenters` when the invitation is sent._ It would need
an identity row for somebody who has accepted nothing, which is the assertion
[D260819](./D260819-an-account-may-be-bound-to-a-person-rather-than-a.md) refuses to
let an administrator make, and an invitation nobody takes up would leave that row
behind. The code row is deleted when it is spent or when it expires, which is the
lifetime this value has.

_Storing the adopted language in `localStorage`._ It would make a default the server
supplied indistinguishable from a decision the reader made: this browser could never
shed it, and leaving `/settings` alone would stop being a way back to its own
preference.

**Only a request the application made itself records a language, and this is what
made the rest of it work.** `plugins/auth.ts` writes `Accept-Language` onto
`commenters.locale` on every authenticated request. A thumbnail is not such a
statement: `<img src="/api/media/…">` is issued by the browser carrying the browser's
own preference, not the language the interface is displaying, and a cold grid sends
hundreds of them. Seeding a language and then opening the gallery therefore undid the
seeding within a second, and the next message left in the wrong language. The guard
reads `Sec-Fetch-Dest`, where the browser states what it will do with the answer:
`empty` is a `fetch()` the application made, and everything else is a subresource. A
browser that sends no such header keeps the earlier behaviour, so the language stays
a guess there rather than stopping being recorded at all.

This was found by `packages/e2e/specs/accounts.spec.ts` and by nothing else. Every
server test passed throughout: the defect needs a real browser loading real images
against a real session, which is the gap that suite exists to cover.

**Consequences.** The invitation is written in two catalogues as every other message
is ([D260812c](./D260812c-the-interface-is-translated-by-two-typed-catalogues.md)),
and the choice reaches `buildInvitationMail` from three callers: creation,
re-invitation and the public request for a code. `packages/e2e/specs/accounts.spec.ts`
holds the chain to account from the form to the gallery. What this does not do is
give an account a language: the value stays on the person, so an account handed back
to a household by unbinding takes no language with it.
