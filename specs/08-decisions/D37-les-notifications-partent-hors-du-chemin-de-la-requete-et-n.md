# D37 — Notifications are sent outside the request path and never fail it

**Context.** A comment must notify the instance owner, and a thread's author
when someone replies. Until then, the application had no email-sending
dependency — "no email to send" even appeared in the out-of-scope section of
[01](../01-vision-et-perimetre.md), regarding registration.

**Decision.** `nodemailer` behind `SMTP_URL` and `MAIL_FROM`. `POST` responds as
soon as the row is written; messages enter a serialised queue and are sent
afterwards. A failure is **logged and abandoned**, with no retry. Without SMTP
configuration, the `Mailer` is inert rather than absent: no caller needs to
know whether the instance sends emails.

**Rejected.** Sending in the handler: a slow SMTP relay would cause a wait of
several seconds after clicking "Publish", for work unrelated to the person
waiting. Also rejected: a persistent queue with retries — it is a mechanism to
monitor, while a missed notification is an inconvenience and the comment is
safely recorded. Finally, writing an in-house SMTP client to avoid the
dependency was rejected; `nodemailer` has no runtime dependency, in line with
the reasoning in D5.

**Consequences.** The graceful shutdown's `drain()` is essential: without it, a
comment posted just before a redeployment would be recorded without anyone
being notified. The unsubscribe link is an HMAC with no expiry and no session
(see [04](../04-securite-et-acces.md)) — an email may be reopened months later,
and requiring sign-in to stop being bothered would be a way of not responding.
`PUBLIC_URL` becomes foundational once again: configured incorrectly, it
produces notifications that lead nowhere.
