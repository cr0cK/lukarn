# D260809c — A television does not type a password: it displays one and has it approved

**Context.** The only way in was `POST /api/auth/login`, with two fields to
enter. On a computer or phone, a password manager fills them in; on a television
there is neither a manager nor a keyboard — each character is entered with the
remote on a virtual keyboard, and the field is masked. The living-room screen,
which is where a family gallery makes the most sense, is therefore the screen on
which it is most cumbersome to open.

**What a QR code cannot be here.** A television has no camera. "Log in by
scanning a QR code" therefore does not work in that direction: the screen
displays it and the phone scans it. Consequently, the QR code carries no
credentials — it only opens a URL on the phone. Any design that placed a secret
in it would, by construction, put that secret on the living-room screen, where
anyone passing by could read it.

**Decision.** Pair two devices, in the spirit of RFC 8628's "device" flow — the
one used by television applications:

1. The screen requests pairing. The server generates two values of opposite
   kinds: an eight-character `userCode`, **intended to be seen** — displayed in
   plain text and included in the QR code — and a 32-byte `deviceCode`, **never
   intended to be seen**, returned only to the requester.
2. A phone that is **already logged in** opens `/pair?code=…` and approves it.
3. The screen, which polls the server every two seconds, collects the session.

There is nothing new about permissions: the session belongs to the account of
the person who approves, and therefore carries its albums, while
`plugins/auth.ts` continues to reassess them on every request. Since an account
is a shared access key and not a person
([D38](./D38-une-cle-d-acces-n-est-pas-une-personne.md)), delegating that key to
the living-room screen passes on no personal information.

**What each value protects:**

| Value                   | Where it travels                         | What it prevents                                                                                        |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `userCode` (8 chars)    | Screen, QR code, URL opened on the phone | Nothing on its own — it only identifies a pending request.                                              |
| `deviceCode` (32 bytes) | Response to requester, polling body      | Someone who read the code on screen from collecting the session in place of the device that is waiting. |

**The commenter's identity does not follow the session.** The paired device
arrives without an identity, as it does after a password login: the identity
belongs to the person, not the key. Without this rule, approving from a phone
would leave the living-room television signing "Mamie" on behalf of the entire
household — exactly the impersonation that code verification in
[D39](./D39-l-adresse-est-verifiee-par-un-code-a-usage-unique.md) prevents.

**The accepted risk, and why it is accepted.** The known weakness of this flow
is social: persuading someone to scan a QR code that is not theirs and gaining
the access they thought they were granting to their own screen. No secret value
changes this — the victim willingly approves it. Three things limit the scope:
the approval page displays the code, which must match the one on the screen being
viewed; the request expires in five minutes; and what is granted is an already
shared access key, revocable by changing its password, which closes all its
sessions. A family instance does not justify more.

Also rejected: showing the requesting device's `User-Agent` on the phone to help
people recognise their own. It is written by the requester and therefore chosen
by an attacker — a reassuring label that guarantees nothing is worse than no
label at all.

**Rejected.**

- **A signed login link generated from `/admin`.** It would have to be entered
  on the television: that is the problem being solved.
- **A code sent by email.** An address belongs to `commenters`, never to `users`
  (see [03](../03-modele-de-donnees.md)): assigning one to an access key would
  conflate the key with the person, which D38 has just separated. And without
  SMTP, the instance would lose its only convenient way in.
- **Passkeys (WebAuthn), whose hybrid flow displays a QR code.** No television
  browser implements it, and the device that implements it best is the one that
  does not need it.
- **Creating the session on approval, leaving the screen only to collect it.**
  A one-year session would then be created even for a screen switched off in the
  meantime, and `sessions` would fill with rows nobody had opened. It is
  therefore created on collection, and an uncollected request expires without a
  trace.

**Consequences.** The password remains the only way in for a **first** device:
pairing delegates existing access; it does not create any. On an instance where
no device is logged in yet, the username must still be entered — consistently
with the absence of both a registration form and a "forgotten password" flow
([01](../01-vision-et-perimetre.md)).

The QR code is encoded in the browser (`lib/qr.ts`, built on
`qrcode-generator` — a dependency with no dependencies). Having a third-party
service generate it would have added a fourth outbound destination to those
listed in [04](../04-securite-et-acces.md), entrusting it with the instance URL:
out of all proportion to the few kilobytes saved by the call.
