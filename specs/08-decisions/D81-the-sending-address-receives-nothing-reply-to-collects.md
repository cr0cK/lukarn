# D81 — The sending address receives nothing: `Reply-To` collects replies

**Confidence.** observed — env.ts, git ls-files → exit 0 · 2026-08-23

**Context.** `MAIL_FROM` contains an address from the instance's domain, for
example `Gallery <gallery@example.com>`. The transactional relay that emits it
sends but does not receive. And the sending domain does not necessarily have a
mailbox behind that address — with several registrars, even simple forwarding now
requires an email subscription.

A reply to a comment notification therefore disappeared or bounced back to its
author. The instance knew nothing: the rejection happens at the recipient, and no
server log shows it.

**Choice.** An optional `MAIL_REPLY_TO` variable sets the `Reply-To` header on
every message. The displayed sender remains on the domain — it is aligned with
SPF and DKIM, and changing it would send messages to spam — but "Reply" targets
an address that has a mailbox.

It is **independent** of the inseparable `SMTP_URL`/`MAIL_FROM` pair. When absent,
no header is set and behaviour remains as before: this is the right setting for a
domain that receives its mail, and there was no reason to force existing
instances to declare anything.

**Rejected.** An explicit `noreply@`, which would solve the problem by removing
the conversation. These messages announce comments from relatives on family
photos; replying is predictable behaviour, and `noreply@` asks the sender to
understand that nobody is speaking to them.

Also rejected: deriving `Reply-To` from the address of the commenter who
triggered the notification. Appealing — the reply would reach the right person —
but new-photo announcements have no originating commenter, and above all this
would disclose one visitor's address to other recipients.

**Three safeguards, two severities.** The dividing line is the same as elsewhere
in `env.ts`: what is **invalid** stops startup; what is merely **ineffective** is
logged.

- **The form of `MAIL_FROM` and `MAIL_REPLY_TO` is checked** — `Name <address>`
  or a bare address — and an unreadable value stops startup. This follows the
  `SMTP_URL` check (D37 for transport): an unclosed angle bracket is sent as-is in
  the header, the relay rejects or rewrites it, and failure occurs weeks after
  deployment with nothing linking it to a line in `.env`. The check remains
  permissive where stricter rules teach nothing: no dot is required in the
  domain, as `@localhost` supports testing with a local relay.
- **`MAIL_REPLY_TO` without a relay** is logged as `warn`, not rejected: disabling
  SMTP during maintenance is legitimate, and stopping startup for a variable
  that is not invalid would be disproportionate.
- **`MAIL_REPLY_TO` equal to `MAIL_FROM`** is also reported. Copying the sender is
  the instinctive action, and worse than setting nothing: the configuration looks
  complete while replies continue going exactly where they did not arrive. The
  comparison uses the extracted address, so a display name or case difference
  does not hide the duplicate.

This is also why `mailReplyTo` lives at the root of `Env`, not inside `mail`:
grouped with `smtpUrl` and `from`, it would disappear with them when no relay is
configured — exactly the case that must be reported.

**Consequences.** The configured address is visible to all recipients, like any
header. On a family instance, it is an address recipients already know; on an
open instance, a real mailbox on the domain is preferable, and the variable then
remains empty.
