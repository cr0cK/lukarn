# D65 — The code email subject names the instance, not the code

**Context.** The verification email put the code at the start of its subject —
`864781 — verification code`. The intention was practical: on a phone, the
notification banner was enough to read the code without opening the mailbox. The
HTML body never named the instance, while the text version did; the two versions
had diverged, and HTML is what the recipient sees.

An email subject is the part most likely to leak: it appears on a locked screen,
remains in clear text in the system's notification history, appears in a
screenshot sent to someone when asking for help, and is visible over a shoulder
in a message list. The body requires opening the message.

**Choice.** The subject becomes `Verification code — <PUBLIC_URL host>`. The code
only appears in the body, in both versions. The body also recalls the action that
triggered the message, names the host, and says that the code is valid for fifteen
minutes and can only be used once — the latter is accurate, as
`CommenterRepo.verify` clears `code_hash` on success.

**Rejected.** Keeping the code in the subject and merely adding the host: this
makes the line longer where clients truncate it, without removing any of the leak
paths above. Also rejected: a clickable verification link, which would avoid
copying — it would open a second session in another browser while the person is
waiting in the tab where they requested the code. Finally rejected: placing the
code in a designed block and grouping it as `123 456` — the latter cannot be
pasted back into a field that `verify` validates as six characters after
`trim()`. Spacing remains a `letter-spacing`, which does not alter the copied
string.

**Consequences.** The convenience of reading from the banner is lost: the
message must be opened. This is the accepted price. This email remains the only
one of the three without a clickable link, distinguishing it from
`buildCommentMail` and `buildAlbumUpdateMail` — a future template alignment must
not add one along the way. `PUBLIC_URL` gains another role: if misconfigured, it
names the wrong instance in the subject, rather than only producing links that
lead nowhere.
