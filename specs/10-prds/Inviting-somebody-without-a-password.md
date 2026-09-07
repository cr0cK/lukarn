---
type: prd
target-repos:
  - lukarn
---

# Inviting a viewer to their albums without a password

Follows [Sharing without an account](./Sharing-without-an-account.md), which
defines guest links for people outside without an account. That intent was accepted
first and is not changed by this one: a guest link remains ephemeral, bound to a
specific selection or single album, and holds no persistent member identity.

## Why this exists

Giving a close relative access to the gallery today requires one of two compromises.

Either they are given a shared household password that circulates and asks them to sign
in with a technical identifier, or an account is created manually in administration,
followed by an invitation flow that sends a six-digit code to type into a login form.
If the instance runs without an external mailer configured, the administration screen
refuses the invitation outright.

Once signed in, keeping them informed of family moments requires them to remember to
open the gallery, or to post a comment first before any notification can reach them.
The result is that parents and grandparents either forget their password or never see
the photographs added three weeks after their visit.

## Who it is for

- **The person running the instance**, who wants to invite a mother, cousin, or close
  friend in ten seconds: typing their email address, picking their albums, and letting
  the application handle the rest.
- **The invited relative**, who opens the invitation from their phone, taps a single
  button, and is immediately welcomed into their family albums without having to
  invent, remember, or type a password.
- **The subscriber**, who automatically receives a polite email digest when new
  photographs arrive in their albums, and is notified when someone replies to their
  comments.

## What it changes

### 1. One-click member invitation in administration

In administration, under the people section, creating a member access is reduced to
what the administrator actually knows: the person's **email address**, an optional
**name**, and the **albums** they may view.

The technical username is derived automatically. The account is created with no
password (`D260819b`), bound to the recipient's verified email upon acceptance.

**Two delivery modes, zero blocking**:

- If an outbound mail service is configured, the application sends the invitation
  email automatically.
- If no mail service is configured (a minimal, self-hosted, or local instance), the
  application generates the invitation link immediately on the screen with a "Copy
  invitation link" button. The owner can paste it directly into Signal, WhatsApp,
  or an SMS. The administration screen never throws an error simply because SMTP is absent.

### 2. Magic onboarding without friction

The recipient opens the invitation link. The application validates the cryptographic
token, establishes a long-lived authenticated member session (one year, renewed on
activity), and binds the account to the recipient's verified identity (`commenters`).

If no display name was provided by the administrator, a gentle prompt welcomes them:
_"How would you like your name to appear under photographs?"_.

They land immediately in their gallery, showing only the albums they were granted.
They never meet a password field.

### 3. Subsequent sign-ins

When an invited member returns from another device or after their session expires,
they enter their email address on the sign-in screen.

The application delivers a dual credential:

- A clickable sign-in link that restores their session in one click.
- A six-digit one-time code, allowing someone opening the email on their computer to
  remain in their active mobile or desktop browser without dealing with sandboxed
  in-app email webviews (`D260819b`).

A classic "Sign in with password" option remains available for administrators or
accounts configured with a legacy password.

### 4. Coherent and automatic notifications

Because the application now knows the verified email address of every invited member
from their very first visit:

- **New photographs digests**: The invited member is automatically subscribed
  (`state = 'auto'`) to photo update digests for every album they were granted access to.
  When new photographs are added, the existing hourly batch notifier (`AlbumNotifier`)
  includes them in the digest, respecting album visibility strictly (`users.albums`).
- **Comment discussions**: Replies to their comments or discussions in their albums
  reach their inbox seamlessly, with direct links back to the photograph.
- **Strict consent & one-click unsubscribe**: Every outgoing email contains the
  standard one-click unsubscribe link (`/unsubscribe?token=...`, `D41`), allowing a
  recipient to mute an album or silence all notifications without needing to log in.

### 5. Clear boundary with guest share links

This intent does not replace or modify shared links:

- **Shared links** (`/share/:token`, [Sharing without an account](./Sharing-without-an-account.md))
  remain public or semi-private, ephemeral, token-based doors for casual viewers who have
  no account and should not see the rest of the library or receive album updates.
- **Member invitations** (`/invite/:token`) grant a persistent member identity, a
  curated personal library of albums, and automated notifications.
